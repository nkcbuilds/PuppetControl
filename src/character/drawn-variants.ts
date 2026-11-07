/**
 * Guarded local artwork variant workflow for imported Rev2D avatars.
 *
 * The generated image itself is never sent to an AI provider by these calls.
 * A successful import mutates the model/textures, invalidates previous visual
 * approval, rebuilds review sheets, then refreshes exact asset fingerprints.
 */
import { open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { characterSchema } from "../scene/schemas.js";
import { shortFadeDrawnEyes } from "./eye-short-fade.js";
import {
  AvatarWorkflowError, checkedPath, parsePngSize, pinnedRev2D, runRev2D,
} from "./avatar.js";
import {
  createAvatarBuildRecord, revokeAvatarApprovalBeforeBuild,
  verifyAvatarBuildRecord, writeAvatarBuildRecord,
} from "./provenance.js";

export const DRAWN_VARIANT_IDS = [
  "eyes_closed", "eyes_half", "eyes_smile",
  "mouth_a", "mouth_a_half", "mouth_i", "mouth_u", "mouth_e", "mouth_o",
] as const;

const ALLOWED_VARIANTS = new Set<string>(DRAWN_VARIANT_IDS);
const DEFAULT_VARIANTS = ["eyes_closed", "mouth_a"];
const MAX_DRAWING_BYTES = 30 * 1024 * 1024;
const MAX_MODEL_BYTES = 20 * 1024 * 1024;

export function validateDrawnVariantIds(
  requested: readonly string[], requireExplicit = false,
): string[] {
  if (requireExplicit && requested.length === 0) {
    throw new AvatarWorkflowError(
      "VARIANT_IDS_REQUIRED",
      "Select the exact reviewed artwork IDs to import; bulk importing all drawings is not allowed.",
    );
  }
  if (requested.length > DRAWN_VARIANT_IDS.length) {
    throw new AvatarWorkflowError("VARIANT_IDS_INVALID", "Too many drawn variant IDs.");
  }
  const ids = requested.length ? requested : DEFAULT_VARIANTS;
  if (ids.some((id) => !ALLOWED_VARIANTS.has(id)) || new Set(ids).size !== ids.length) {
    throw new AvatarWorkflowError(
      "VARIANT_IDS_INVALID",
      "Unknown or duplicate variant ID. Supported: " + DRAWN_VARIANT_IDS.join(", "),
    );
  }
  return [...ids];
}

async function projectPaths(projectDir: string, root: string) {
  const project = await checkedPath(root, projectDir);
  if (!(await stat(project)).isDirectory()) {
    throw new AvatarWorkflowError("AVATAR_PROJECT_REQUIRED", "Expected a built avatar project directory.");
  }
  return {
    project,
    manifestPath: await checkedPath(root, join(project, "character.json")),
  };
}

async function verifiedImportedAvatar(projectDir: string, root: string) {
  const paths = await projectPaths(projectDir, root);
  const raw = await readFile(paths.manifestPath, "utf8");
  const manifest = characterSchema.parse(JSON.parse(raw) as unknown);
  if (!manifest.provenance || !manifest.render?.modelPath ||
      manifest.poseFamilies.length !== 1 ||
      manifest.poseFamilies[0]?.modelPath !== manifest.render.modelPath) {
    throw new AvatarWorkflowError(
      "AVATAR_VARIANTS_UNSUPPORTED",
      "Drawn variant import currently requires a single-pose character built with puppetctl character build.",
    );
  }
  const integrity = await verifyAvatarBuildRecord(paths.manifestPath, manifest.render.modelPath);
  if (!integrity.valid) {
    throw new AvatarWorkflowError(integrity.code,
      "Avatar source/rig assets are stale: " + integrity.message +
      ". Restore the verified build before modifying drawn variants.");
  }
  return { ...paths, manifest };
}

async function readDrawingSize(path: string): Promise<{ width: number; height: number }> {
  const stats = await stat(path);
  if (!stats.isFile() || stats.size < 24 || stats.size > MAX_DRAWING_BYTES) {
    throw new AvatarWorkflowError("VARIANT_DRAWING_INVALID", "Drawing must be a PNG file under 30 MB.");
  }
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(24);
    if ((await handle.read(buffer, 0, buffer.length, 0)).bytesRead !== buffer.length) {
      throw new AvatarWorkflowError("VARIANT_DRAWING_INVALID", "Incomplete PNG header.");
    }
    return parsePngSize(buffer);
  } finally {
    await handle.close();
  }
}

/** Prepare masks and prompts only; no generated texture or approval changes. */
export async function requestDrawnVariants(
  projectDir: string, requested: readonly string[] = [], root = process.cwd(),
) {
  const ids = validateDrawnVariantIds(requested);
  const { project } = await verifiedImportedAvatar(projectDir, root);
  const backend = await pinnedRev2D(root);
  const output: Record<string, unknown> = await runRev2D(backend, ["avatar", "variants", "request", project, ...ids]);
  return {
    valid: true, status: "artwork-required", projectDir: project, variants: ids,
    masks: ids.map((id) => join(project, "variant-requests", id + ".mask.png")),
    prompts: ids.map((id) => join(project, "variant-requests", id + ".prompt.txt")),
    backend: output,
    next: "Draw full-size copies of source.png, editing ONLY the mask's transparent region. Save to variants/<id>.png. Check image rights; these commands never upload artwork.",
  };
}

/** Report backend state, including rejected/stale variants, even during recovery. */
export async function statusDrawnVariants(projectDir: string, root = process.cwd()): Promise<Record<string, unknown>> {
  const { project } = await projectPaths(projectDir, root);
  const backend = await pinnedRev2D(root);
  return runRev2D(backend, ["avatar", "variants", "status", project]);
}

/**
 * Adjust only derived eye-opacity curves of a locally reviewed rig.
 * The calling import operation revokes visual approval before writing.
 * Validation and new fingerprints are required after this step.
 */
async function applyExperimentalShortFade(
  project: string, modelRelative: string, backend: string,
) {
  const modelPath = await checkedPath(project, join(project, modelRelative));
  const file = await stat(modelPath);
  if (!file.isFile() || file.size > MAX_MODEL_BYTES) {
    throw new AvatarWorkflowError("EYE_SHORT_FADE_UNSUPPORTED", "Invalid or oversized Rev2D model.");
  }
  const transformed = shortFadeDrawnEyes(JSON.parse(await readFile(modelPath, "utf8")) as unknown);
  const temporary = join(dirname(modelPath), ".puppetcontrol-shortfade-" + randomUUID() + ".r2d.json");
  try {
    await writeFile(temporary, JSON.stringify(transformed.model), { flag: "wx" });
    await runRev2D(backend, ["validate", temporary]);
    await rename(temporary, modelPath);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return { profile: "experimental-short-fade" as const, ...transformed.profile, changedBindings: transformed.changedBindings };
}
/** Import reviewed artwork, leave unapproved; preserve stale hashes on a partial failure. */
export async function importDrawnVariants(
  projectDir: string, requested: readonly string[], root = process.cwd(),
  options: { experimentalShortFade?: boolean } = {},
) {
  const ids = validateDrawnVariantIds(requested, true);
  const { project, manifestPath, manifest } = await verifiedImportedAvatar(projectDir, root);
  const source = await checkedPath(root, join(project, "source.png"));
  const size = await readDrawingSize(source);
  for (const id of ids) {
    const drawing = await checkedPath(root, join(project, "variants", id + ".png"));
    const drawnSize = await readDrawingSize(drawing);
    if (size.width !== drawnSize.width || size.height !== drawnSize.height) {
      throw new AvatarWorkflowError(
        "VARIANT_SIZE_MISMATCH",
        id + " must have exactly the source illustration's dimensions.",
      );
    }
  }

  const backend = await pinnedRev2D(root);
  // IMPORTANT: revoke before Rev2D can touch model, layers or texture files.
  await revokeAvatarApprovalBeforeBuild(manifestPath);
  let imported: unknown;
  let profile: Awaited<ReturnType<typeof applyExperimentalShortFade>> | undefined;
  try {
    imported = await runRev2D(backend, ["avatar", "variants", "import", project, ...ids], 240_000);
    if (options.experimentalShortFade) {
      profile = await applyExperimentalShortFade(project, manifest.render!.modelPath, backend);
    }
    await runRev2D(backend, ["avatar", "poses", project], 240_000);
    const record = await createAvatarBuildRecord(project, manifest.render!.modelPath);
    await writeAvatarBuildRecord(project, record);
  } catch (error) {
    throw new AvatarWorkflowError(
      "VARIANT_IMPORT_REVIEW_REQUIRED",
      (error instanceof Error ? error.message : String(error)) +
      "\nThe avatar remains unapproved. Rev2D may have partially imported artwork; " +
      "if fingerprints are now stale, rebuild with character build <project> --force before retrying.",
    );
  }
  return {
    valid: true, status: "review-required", approved: false, projectDir: project,
    variants: ids, backend: imported,
    ...(profile ? { eyeTransition: profile } : {}),
    review: {
      eyes: join(project, "review", "eyes.png"),
      mouth: join(project, "review", "mouth.png"),
      poses: join(project, "review", "poses.png"),
    },
    next: "Inspect the newly rendered review sheets for seams, color changes and facial jumps. Reapprove character.json explicitly only after visual QA.",
  };
}

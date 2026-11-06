/**
 * Immutable fingerprints for single-image Rev2D avatar builds.
 *
 * A model can be geometrically valid but stale relative to its source image
 * or landmark spec. This manifest ties the exact source/spec/model/texture
 * bytes together and is checked before a scene can use the actor.
 *
 * It is an integrity guard, NOT a cryptographic approval signature or a
 * substitute for human/agent inspection of the rendered pose sheets.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { checkedPath, PINNED_REV2D_SHA, AvatarWorkflowError } from "./avatar.js";
import { characterSchema, type Character } from "../scene/schemas.js";

export const AVATAR_BUILD_RECORD = "avatar-build.json";

const HASH = z.string().regex(/^[a-f0-9]{64}$/);
const fileHash = z.strictObject({ path: z.string().min(1).max(256), sha256: HASH });
export const avatarBuildRecordSchema = z.strictObject({
  version: z.literal(1),
  backend: z.literal("rev2d"),
  backendCommit: z.string().regex(/^[a-f0-9]{40}$/),
  source: fileHash,
  spec: fileHash,
  model: fileHash,
  textures: z.array(fileHash).min(1).max(1024),
});

export type AvatarBuildRecord = z.infer<typeof avatarBuildRecordSchema>;

/**
 * Current source-image build records cover exactly one generated Rev2D model.
 * Until pose-family fingerprints exist, do not pretend separately authored rigs
 * were covered by the original avatar's approval or integrity record.
 */
export function checkAvatarPoseCoverage(
  character: Character,
): { valid: true } | { valid: false; code: string; message: string } {
  if (!character.provenance) return { valid: true };
  const primary = character.render?.modelPath;
  if (!primary) {
    return { valid: false, code: "AVATAR_BUILD_RECORD_INVALID", message: "Imported actor is missing its primary model path" };
  }
  for (const pose of character.poseFamilies) {
    if (pose.modelPath && pose.modelPath !== primary) {
      return {
        valid: false, code: "AVATAR_POSE_PROVENANCE_MISSING",
        message: "Imported pose " + pose.name + " uses an untracked rig. Separate pose models require their own build fingerprints.",
      };
    }
  }
  return { valid: true };
}

async function fingerprint(dir: string, filename: string): Promise<{path:string; sha256:string}> {
  const full = await checkedPath(dir, join(dir, filename));
  // Stream generated textures instead of buffering every image in memory.
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(full)) hash.update(chunk as Buffer);
  return { path: filename.replaceAll("\\", "/"), sha256: hash.digest("hex") };
}

async function safeModelAndTextures(dir: string, modelFile: string) {
  const model = await fingerprint(dir, modelFile);
  const raw = JSON.parse(await readFile(join(dir, modelFile), "utf8")) as {
    textures?: Array<{ path?: unknown }>;
  };
  if (!Array.isArray(raw.textures) || !raw.textures.length || raw.textures.length > 1024) {
    throw new AvatarWorkflowError("AVATAR_TEXTURE_LIST_INVALID", "Generated model has no valid texture list");
  }
  const paths = raw.textures.map((t) => t.path);
  if (paths.some((path) => typeof path !== "string" || !path.trim())) {
    throw new AvatarWorkflowError("AVATAR_TEXTURE_LIST_INVALID", "Generated model has a missing texture path");
  }
  const unique = [...new Set(paths as string[])].sort();
  const textures: Array<{path: string; sha256: string}> = [];
  for (const path of unique) textures.push(await fingerprint(dir, path));
  return { model, textures };
}

/**
 * Compute a new record only AFTER the completed avatar build and pose review
 * generation. Never mark an actor approved as part of this operation.
 */
export async function createAvatarBuildRecord(dir: string, modelFile: string): Promise<AvatarBuildRecord> {
  const [source, spec, assets] = await Promise.all([
    fingerprint(dir, "source.png"),
    fingerprint(dir, "avatar.json"),
    safeModelAndTextures(dir, modelFile),
  ]);
  return avatarBuildRecordSchema.parse({
    version: 1,
    backend: "rev2d",
    backendCommit: PINNED_REV2D_SHA,
    source,
    spec,
    model: assets.model,
    textures: assets.textures,
  });
}

export async function writeAvatarBuildRecord(dir: string, record: AvatarBuildRecord): Promise<void> {
  const file = await checkedPath(dir, join(dir, AVATAR_BUILD_RECORD));
  const tmp = await checkedPath(dir, file + ".next-" + randomUUID());
  try {
    await writeFile(tmp, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
    await rename(tmp, file);
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/**
 * Fail closed on direct source edits, manual rig edits, incomplete build
 * swaps, or missing texture files. Records themselves are not signatures.
 */
export async function verifyAvatarBuildRecord(
  characterPath: string, expectedModelPath: string,
): Promise<{ valid: true } | { valid: false; code: string; message: string }> {
  const dir = dirname(characterPath);
  try {
    const path = await checkedPath(dir, join(dir, AVATAR_BUILD_RECORD));
    const raw = await readFile(path, "utf8");
    const record = avatarBuildRecordSchema.parse(JSON.parse(raw) as unknown);
    if (record.backendCommit !== PINNED_REV2D_SHA ||
        record.source.path !== "source.png" || record.spec.path !== "avatar.json" ||
        record.model.path !== expectedModelPath.replaceAll("\\", "/")) {
      return { valid: false, code: "AVATAR_BUILD_RECORD_INVALID", message: "Avatar build provenance paths do not match the model" };
    }
    const references = [record.source, record.spec, record.model, ...record.textures];
    // Do not trust the record to read arbitrary paths. All paths must be
    // workspace-contained, and texture paths must live under textures/.
    for (const reference of references) {
      if (reference.path.includes("\\") ||
          reference.path.startsWith("/") ||
          reference.path.includes(":") ||
          reference.path.split("/").some((segment) => segment === ".." || segment === ".")) {
        return { valid: false, code: "AVATAR_BUILD_RECORD_INVALID", message: "Invalid asset reference in provenance: " + reference.path };
      }
    }
    if (record.textures.some((texture) => !texture.path.startsWith("textures/"))) {
      return { valid: false, code: "AVATAR_BUILD_RECORD_INVALID", message: "Textures must remain inside the generated textures directory" };
    }
    // Verify the record lists exactly the model's current textures.
    const built = await createAvatarBuildRecord(dir, record.model.path);
    const a = JSON.stringify(record);
    const b = JSON.stringify(built);
    if (a !== b) {
      return { valid: false, code: "AVATAR_ASSETS_STALE", message: "Source PNG, landmarks, model or textures changed since this avatar was built" };
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, code: "AVATAR_BUILD_RECORD_MISSING_OR_INVALID", message: String(error) };
  }
}

/**
 * Critical order guarantee: approval is revoked before a potentially
 * destructive Rev2D rebuild touches model/texture/review output files.
 */
export async function revokeAvatarApprovalBeforeBuild(manifestPath: string): Promise<boolean> {
  let contents: string;
  try {
    contents = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  const manifest = characterSchema.parse(JSON.parse(contents) as unknown);
  if (!manifest.poseFamilies.some((p) => p.approved)) return false;
  for (const pose of manifest.poseFamilies) pose.approved = false;
  const tmp = manifestPath + ".next-" + randomUUID();
  try {
    await writeFile(tmp, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    await rename(tmp, manifestPath);
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
  return true;
}

/**
 * Non-destructive, approval-revoking publication of an experimental vector
 * eyelid rig. The previous rig and all user drawings stay intact; the new
 * derived model gets its own filename and fresh exact-byte provenance record.
 *
 * This is an ARTISTIC experiment, not automatic quality approval.
 */
import { randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { characterSchema } from "../scene/schemas.js";
import {
  AvatarWorkflowError, checkedPath, pinnedRev2D, runRev2D,
} from "./avatar.js";
import {
  createAvatarBuildRecord, revokeAvatarApprovalBeforeBuild,
  verifyAvatarBuildRecord, writeAvatarBuildRecord,
} from "./provenance.js";
import { createBlinkReview } from "./blink-review.js";
import { createEyeStressReview } from "./eye-stress.js";
import { publishVectorReviewProof } from "./vector-review-evidence.js";
import { vectorizeImportedEyelids } from "./eyelid-vector.js";

const MAX_MODEL = 20_000_000;
const MAX_LAYER_METADATA = 5_000_000;
const HEX = /^#[0-9a-f]{6}$/i;

async function readBoundedJson(filename: string, bytes: number): Promise<unknown> {
  const file = await stat(filename);
  if (!file.isFile() || file.size < 2 || file.size > bytes) {
    throw new AvatarWorkflowError("VECTOR_EYELIDS_INPUT_INVALID",
      "Missing/oversized Rev2D asset (limit " + bytes + " bytes): " + filename);
  }
  return JSON.parse(await readFile(filename, "utf8")) as unknown;
}
type ObjectLike = Record<string, unknown>;
function obj(value: unknown): ObjectLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectLike : null;
}

export function vectorEyeColorsFromLayers(value: unknown): { eyeR: string; eyeL: string } {
  const eyes = obj(obj(value)?.eyes);
  const left = obj(obj(eyes?.imageLeft)?.colors)?.lash;
  const right = obj(obj(eyes?.imageRight)?.colors)?.lash;
  if (typeof left !== "string" || !HEX.test(left) ||
      typeof right !== "string" || !HEX.test(right)) {
    throw new AvatarWorkflowError("VECTOR_EYELIDS_LASH_COLOR_MISSING",
      "Imported Rev2D eye layer metadata needs valid lash colors for both eyes");
  }
  return { eyeR: left, eyeL: right };
}

export async function createVectorEyelidRig(
  projectDir: string,
  root = process.cwd(),
): Promise<Record<string, unknown>> {
  const project = await checkedPath(root, resolve(root, projectDir));
  if (!(await stat(project)).isDirectory()) {
    throw new AvatarWorkflowError("VECTOR_EYELIDS_PROJECT_REQUIRED", "Expected imported avatar project");
  }
  const characterFile = await checkedPath(project, join(project, "character.json"));
  const manifest = characterSchema.parse(
    await readBoundedJson(characterFile, MAX_MODEL));
  if (!manifest.provenance || manifest.render?.backend !== "rev2d" ||
      !manifest.render.modelPath || manifest.poseFamilies.length !== 1 ||
      manifest.poseFamilies[0]?.modelPath !== manifest.render.modelPath) {
    throw new AvatarWorkflowError("VECTOR_EYELIDS_IMPORTED_RIG_REQUIRED",
      "Requires one imported, provenance-verified Rev2D avatar and one model");
  }
  const verified = await verifyAvatarBuildRecord(characterFile, manifest.render.modelPath);
  if (!verified.valid) throw new AvatarWorkflowError(verified.code, verified.message);
  const modelFile = await checkedPath(project, join(project, manifest.render.modelPath));
  const layersFile = await checkedPath(project, join(project, "textures", "layers.json"));
  const [model, layers] = await Promise.all([
    readBoundedJson(modelFile, MAX_MODEL),
    readBoundedJson(layersFile, MAX_LAYER_METADATA),
  ]);
  const colors = vectorEyeColorsFromLayers(layers);
  const transformed = vectorizeImportedEyelids(model, colors);
  const backend = await pinnedRev2D(root);
  const relModel = manifest.id + "-vector-eyelids-" + randomUUID() + ".r2d.json";
  const derivedFile = await checkedPath(project, join(project, relModel));
  const approved = manifest.poseFamilies.some(p => p.approved);
  // Critical ordering: revoke before creating/changing any model assets.
  await revokeAvatarApprovalBeforeBuild(characterFile);
  const derived = characterSchema.parse({
    ...manifest,
    poseFamilies: manifest.poseFamilies.map(p => ({ ...p, approved: false, modelPath: relModel })),
    render: { ...manifest.render, modelPath: relModel },
  });
  const tempManifest = characterFile + ".next-" + randomUUID();
  try {
    await writeFile(derivedFile, JSON.stringify(transformed.model), { flag: "wx" });
    const check = await runRev2D(backend, ["validate", derivedFile], 90_000) as unknown;
    if (!Array.isArray(check) || !check.length ||
        check.some(item => {
          const r = obj(item);
          return !r || r.ok !== true || typeof r.errors !== "number" || r.errors !== 0;
        })) {
      throw new AvatarWorkflowError("VECTOR_EYELIDS_REV2D_INVALID",
        "Pinned Rev2D did not validate the derived model with zero errors");
    }
    const record = await createAvatarBuildRecord(project, relModel);
    // The record and manifest switch are intentionally two atomic file
    // replacements, not a transaction. An interrupted switch fails closed.
    await writeAvatarBuildRecord(project, record);
    await writeFile(tempManifest, JSON.stringify(derived, null, 2) + "\n", { flag: "wx" });
    await rename(tempManifest, characterFile);
  } catch (cause) {
    throw new AvatarWorkflowError("VECTOR_EYELIDS_REVIEW_REQUIRED",
      (cause instanceof Error ? cause.message : String(cause)) +
      ". The avatar stays unapproved; original rig remains untouched. " +
      "A failed publication may leave fingerprints stale until you restore the prior model/record or rebuild.");
  } finally {
    await unlink(tempManifest).catch(() => undefined);
  }
  // Real engine renders are necessary to inspect the novel eyelid geometry.
  // Do not reverse the successful model/record switch merely because FFmpeg
  // or an optional contact-sheet renderer fails.
  let review: Record<string, unknown>;
  try {
    const rendered = await createBlinkReview(project, { root, timed: true });
    const stress = await createEyeStressReview(project, root);
    const proof = await publishVectorReviewProof(project, relModel,
      { ...rendered, stressSheet: stress.eyeSheet }, root);
    review = {
      video: proof.video,
      eyes: proof.eyes,
      full: proof.full,
      proofFile: proof.proofFile,
      stress: proof.stress,
      report: rendered.reportPath,
      stressReport: stress.reportPath,
    };
  } catch (cause) {
    review = {
      status: "manual-review-render-required",
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
  return {
    valid: true,
    status: "visual-review-required",
    approved: false,
    previousApprovalRevoked: approved,
    projectDir: project,
    previousModel: manifest.render.modelPath,
    newModel: relModel,
    newParts: transformed.newPartIds,
    hiddenParts: transformed.hiddenPartIds,
    restoredEyeOpacityBindings: transformed.changedOpacityBindings,
    review,
    next: "Inspect the 30fps full-blink video AND the exact EyeOpen sweep. Vector eyelids may simplify original line art. Approval is never automatic.",
  };
}

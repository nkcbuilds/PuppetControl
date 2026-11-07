/**
 * Model-bound review evidence for experimentally vectorized eyelids.
 *
 * Every derived vector rig changes the rendered eyelid geometry. The four
 * legacy review/ PNGs can predate that change; their mere existence must NOT
 * make the new model approvable. A proof here binds freshly rendered eye/full
 * contact sheets and a timed blink MP4 to the exact current model SHA-256.
 *
 * This proves byte continuity, NOT aesthetic approval or actual human consent.
 */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { AvatarWorkflowError, checkedPath } from "./avatar.js";
import {
  AVATAR_BUILD_RECORD, avatarBuildRecordSchema, verifyAvatarBuildRecord,
} from "./provenance.js";
import { createBlinkReview } from "./blink-review.js";
import { characterSchema } from "../scene/schemas.js";

const HASH = z.string().regex(/^[0-9a-f]{64}$/);
const evidenceFileSchema = z.strictObject({
  path: z.string().min(1).max(240),
  sha256: HASH,
});
const proofSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("vector-eyelids"),
  model: evidenceFileSchema,
  artifacts: z.strictObject({
    eyes: evidenceFileSchema,
    full: evidenceFileSchema,
    video: evidenceFileSchema,
  }),
});
type Proof = z.infer<typeof proofSchema>;
export const VECTOR_REVIEW_PROOF = "review/vector-eyelids-proof.json";

function error(message: string): never {
  throw new AvatarWorkflowError("VECTOR_REVIEW_PROOF_MISSING_OR_STALE", message);
}

function requireRelativeEvidencePath(path: string, prefix: string): void {
  if (!path.startsWith(prefix) || path.includes("\\") ||
      path.includes(":") || path.startsWith("/") ||
      path.split("/").some(part => part === ".." || part === "." || part === "")) {
    error("Review evidence path is outside the expected review package: " + path);
  }
}

async function checkedBytes(path: string, max: number, kind: "png" | "mp4"): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 24 || info.size > max) {
    error("Review evidence is missing, a symlink, truncated, or oversized");
  }
  const bytes = await readFile(path);
  if (kind === "png" &&
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    error("Review image is not a PNG");
  }
  if (kind === "mp4" && bytes.toString("ascii", 4, 8) !== "ftyp") {
    error("Timed eye review does not have an MP4 file header");
  }
  return bytes;
}
function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function currentModel(project: string, modelPath: string) {
  const integrity = await verifyAvatarBuildRecord(join(project, "character.json"), modelPath);
  if (!integrity.valid) error("Current avatar build is not verified: " + integrity.message);
  const recordPath = await checkedPath(project, join(project, AVATAR_BUILD_RECORD));
  const raw = await readFile(recordPath, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 512_000) error("Build record exceeds proof size limit");
  const record = avatarBuildRecordSchema.parse(JSON.parse(raw) as unknown);
  if (record.model.path !== modelPath) error("Build record is not bound to the active model");
  return record.model;
}

export function isVectorEyelidModelPath(modelPath: string): boolean {
  return /-vector-eyelids-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.r2d\.json$/i
    .test(modelPath);
}

/** Inspect actual Rev2D geometry: renaming a vector model cannot skip the review gate. */
export async function requiresVectorReviewProof(projectDir: string, modelPath: string): Promise<boolean> {
  const project = resolve(projectDir);
  const modelFile = await checkedPath(project, join(project, modelPath));
  const info = await lstat(modelFile);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 20_000_000 || info.size < 2) {
    error("Cannot inspect the current Rev2D model for vector eyelid review requirements");
  }
  const raw = JSON.parse(await readFile(modelFile, "utf8")) as { parts?: Array<{ id?: unknown }> };
  const ids = new Set(Array.isArray(raw.parts) ? raw.parts.map(p => p?.id) : []);
  const expected = [
    "eyeR_vector_upper", "eyeR_vector_lower", "eyeL_vector_upper", "eyeL_vector_lower",
  ];
  const found = expected.filter(id => ids.has(id)).length;
  if (found > 0 && found !== expected.length) {
    error("Incomplete or manually edited vector eyelid geometry cannot be approved");
  }
  return isVectorEyelidModelPath(modelPath) || found === expected.length;
}

/** Publishing a fresh package does not grant or imply approval. */
export async function publishVectorReviewProof(
  projectDir: string,
  modelRelative: string,
  rendered: { eyeSheet: string; fullSheet: string; timedVideo?: string | undefined },
  root = process.cwd(),
): Promise<{ proofFile: string; eyes: string; full: string; video: string }> {
  const project = await checkedPath(root, resolve(root, projectDir));
  if (!isVectorEyelidModelPath(modelRelative)) {
    error("Only an explicitly derived vector eyelid model can publish this review proof");
  }
  const model = await currentModel(project, modelRelative);
  if (!rendered.timedVideo) error("Timed 30 FPS video is required for vector eyelid approval evidence");

  const identity = randomUUID();
  const relativeDir = "review/vector-eyes-" + identity;
  const dir = await checkedPath(project, join(project, relativeDir));
  await mkdir(dir); // unique, never overwrite an earlier review package
  const names = {
    eyes: ["blink-eyes.png", rendered.eyeSheet, "png"],
    full: ["blink-full.png", rendered.fullSheet, "png"],
    video: ["blink-timed-30fps.mp4", rendered.timedVideo, "mp4"],
  } as const;
  const artifacts = {} as Proof["artifacts"];
  for (const key of ["eyes", "full", "video"] as const) {
    const [name, original, kind] = names[key];
    const source = await checkedPath(root, resolve(original));
    const input = await checkedBytes(source, kind === "mp4" ? 50_000_000 : 25_000_000, kind);
    const destination = await checkedPath(project, join(dir, name));
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    const output = await checkedBytes(destination, kind === "mp4" ? 50_000_000 : 25_000_000, kind);
    if (sha(input) !== sha(output)) error("Review bytes changed while copying " + name);
    artifacts[key] = { path: relativeDir + "/" + name, sha256: sha(output) };
  }

  const proof: Proof = proofSchema.parse({
    version: 1, kind: "vector-eyelids",
    model, artifacts,
  });
  const proofFile = await checkedPath(project, join(project, VECTOR_REVIEW_PROOF));
  const temporary = await checkedPath(project, proofFile + ".next-" + randomUUID());
  try {
    await writeFile(temporary, JSON.stringify(proof, null, 2) + "\n", { flag: "wx" });
    // Fail if the model or source assets changed during proof capture.
    const latest = await currentModel(project, modelRelative);
    if (latest.sha256 !== model.sha256) error("Rig changed while generating review proof");
    await rename(temporary, proofFile);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return {
    proofFile, eyes: join(project, artifacts.eyes.path),
    full: join(project, artifacts.full.path),
    video: join(project, artifacts.video.path),
  };
}

/**
 * The approval gate invokes this for derived vector models. It deliberately
 * rejects stale files instead of trusting old review/eyes.png from Rev2D.
 */
export async function verifyVectorReviewProof(
  projectDir: string,
  modelRelative: string,
): Promise<string[]> {
  const project = resolve(projectDir);
  let proof: Proof;
  try {
    const file = await checkedPath(project, join(project, VECTOR_REVIEW_PROOF));
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > 16_384) {
      error("Missing or oversized vector review proof");
    }
    proof = proofSchema.parse(JSON.parse(await readFile(file, "utf8")) as unknown);
  } catch (cause) {
    error("Model-specific vector eyelid review proof is missing or malformed: " + String(cause));
  }
  const current = await currentModel(project, modelRelative);
  if (proof.model.path !== modelRelative || proof.model.sha256 !== current.sha256) {
    error("Review evidence is for a different or older eyelid rig");
  }
  const paths: string[] = [];
  const packagePath = proof.artifacts.eyes.path;
  const match = /^review\/vector-eyes-([0-9a-f-]{36})\/blink-eyes\.png$/.exec(packagePath);
  if (!match) error("Invalid vector review package identity");
  const base = "review/vector-eyes-" + match[1] + "/";
  for (const [kind, filename] of [
    ["eyes", "blink-eyes.png"], ["full", "blink-full.png"],
    ["video", "blink-timed-30fps.mp4"],
  ] as const) {
    const reference = proof.artifacts[kind];
    requireRelativeEvidencePath(reference.path, base);
    if (reference.path !== base + filename) error("Review package filenames are inconsistent");
    const fullPath = await checkedPath(project, join(project, reference.path));
    const buffer = await checkedBytes(fullPath, kind === "video" ? 50_000_000 : 25_000_000,
      kind === "video" ? "mp4" : "png");
    if (sha(buffer) !== reference.sha256) error("Review " + kind + " bytes no longer match the recorded proof");
    paths.push(fullPath);
  }
  return paths;
}

/** Safely rerender/rebind the current vector rig after a failed or lost QA run. */
export async function refreshVectorReviewProof(
  projectDir: string, root = process.cwd(),
) {
  const project = await checkedPath(root, resolve(root, projectDir));
  const manifest = characterSchema.parse(
    JSON.parse(await readFile(join(project, "character.json"), "utf8")) as unknown);
  const model = manifest.render?.modelPath;
  if (!model || !isVectorEyelidModelPath(model)) {
    error("The current imported character does not reference a vector-eyelid derived rig");
  }
  await currentModel(project, model);
  const rendered = await createBlinkReview(project, { root, timed: true });
  const proof = await publishVectorReviewProof(project, model, rendered, root);
  return {
    status: "review-evidence-refreshed",
    approved: manifest.poseFamilies.some(pose => pose.approved),
    approvalUnchanged: true,
    model,
    ...proof,
    note: "Review the current-model video and contact sheets. Evidence is only a hash binding, not proof of human review.",
  };
}

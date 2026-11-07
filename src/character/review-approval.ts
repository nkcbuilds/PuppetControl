import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AvatarWorkflowError, checkedPath } from "./avatar.js";
import { checkAvatarPoseCoverage, verifyAvatarBuildRecord } from "./provenance.js";
import { characterSchema, type Character } from "../scene/schemas.js";
import { requiresVectorReviewProof, verifyVectorReviewProof } from "./vector-review-evidence.js";

const REVIEW_FILES = ["poses.png", "turn.png", "eyes.png", "mouth.png"] as const;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_REVIEW_BYTES = 100 * 1024 * 1024;
const MIN_REVIEW_DIMENSION = 64;
const MAX_REVIEW_DIMENSION = 32_768;
const MAX_REVIEW_PIXELS = 268_435_456;

export interface ImportedAvatarApprovalResult {
  valid: true;
  status: "approved" | "already-approved";
  approved: true;
  changed: boolean;
  characterPath: string;
  reviewArtifacts: string[];
  message: string;
}

function workflowError(code: string, message: string): never {
  throw new AvatarWorkflowError(code, message);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseManifest(contents: string): { raw: Record<string, unknown>; character: Character } {
  let raw: unknown;
  try {
    raw = JSON.parse(contents) as unknown;
  } catch (error) {
    workflowError("AVATAR_MANIFEST_INVALID", "character.json is not valid JSON: " + String(error));
  }
  const record = asRecord(raw);
  if (!record) workflowError("AVATAR_MANIFEST_INVALID", "character.json must contain one character object");
  const parsed = characterSchema.safeParse(record);
  if (!parsed.success) {
    workflowError(
      "AVATAR_MANIFEST_INVALID",
      "character.json does not match the character schema: " + parsed.error.message,
    );
  }
  return { raw: record, character: parsed.data };
}

function requireSupportedImportedAvatar(character: Character): void {
  if (!character.provenance) {
    workflowError(
      "AVATAR_PROVENANCE_REQUIRED",
      "Only provenance-tracked imported avatars can be approved by this workflow.",
    );
  }
  if (!character.render || character.render.backend !== "rev2d") {
    workflowError(
      "AVATAR_RENDER_UNSUPPORTED",
      "This approval workflow only supports already-built Rev2D imported avatars.",
    );
  }
  if (character.poseFamilies.length !== 1 ||
      character.poseFamilies[0]?.name !== character.defaultPose) {
    workflowError(
      "AVATAR_POSE_FAMILIES_UNSUPPORTED",
      "Imported-avatar approval currently supports exactly one built pose family. Additional pose families need separate provenance and review.",
    );
  }
  const coverage = checkAvatarPoseCoverage(character);
  if (!coverage.valid) workflowError(coverage.code, coverage.message);
  const family = character.poseFamilies[0]!;
  if ((family.modelPath ?? character.render.modelPath) !== character.render.modelPath) {
    workflowError(
      "AVATAR_POSE_FAMILIES_UNSUPPORTED",
      "The single imported pose must use the provenance-tracked primary Rev2D model.",
    );
  }
}

function parseReviewPngHeader(header: Buffer, filename: string): { width: number; height: number } {
  if (header.length < 24 || !header.subarray(0, 8).equals(PNG_SIGNATURE) ||
      header.readUInt32BE(8) !== 13 || header.toString("ascii", 12, 16) !== "IHDR") {
    workflowError(
      "AVATAR_REVIEW_ASSET_INVALID",
      filename + " is not a plausible PNG review artifact with a valid IHDR header.",
    );
  }
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  const pixels = width * height;
  if (width < MIN_REVIEW_DIMENSION || height < MIN_REVIEW_DIMENSION ||
      width > MAX_REVIEW_DIMENSION || height > MAX_REVIEW_DIMENSION ||
      !Number.isSafeInteger(pixels) || pixels > MAX_REVIEW_PIXELS) {
    workflowError(
      "AVATAR_REVIEW_ASSET_INVALID",
      filename + " has implausible review dimensions " + width + "x" + height + ".",
    );
  }
  return { width, height };
}

async function validateReviewArtifacts(project: string): Promise<string[]> {
  const paths: string[] = [];
  for (const filename of REVIEW_FILES) {
    const path = await checkedPath(project, join(project, "review", filename));
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        workflowError(
          "AVATAR_REVIEW_ASSET_MISSING",
          "Missing required review image " + filename + ". Rebuild the avatar and inspect all four review PNGs before approval.",
        );
      }
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size < 24 || info.size > MAX_REVIEW_BYTES) {
      workflowError(
        "AVATAR_REVIEW_ASSET_INVALID",
        filename + " must be a non-empty regular PNG review file of a plausible size.",
      );
    }
    const handle = await open(path, "r");
    try {
      const header = Buffer.alloc(24);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead !== header.length) {
        workflowError("AVATAR_REVIEW_ASSET_INVALID", filename + " is truncated.");
      }
      parseReviewPngHeader(header, filename);
    } finally {
      await handle.close();
    }
    paths.push(path);
  }
  return paths;
}

async function verifyCurrentBuild(characterPath: string, character: Character): Promise<void> {
  const modelPath = character.render?.modelPath;
  if (!modelPath) {
    workflowError("AVATAR_RENDER_UNSUPPORTED", "Imported avatar is missing its primary Rev2D model path.");
  }
  const integrity = await verifyAvatarBuildRecord(characterPath, modelPath);
  if (!integrity.valid) workflowError(integrity.code, integrity.message);
}

/**
 * Record explicit approval for one already-built, provenance-tracked imported avatar.
 *
 * reviewedFlag is only an acknowledgement supplied by the caller. Software cannot
 * prove that a human actually inspected the review PNGs or consented to approval.
 */
export async function approveImportedAvatar(
  projectDir: string,
  reviewedFlag: boolean,
  root = process.cwd(),
): Promise<ImportedAvatarApprovalResult> {
  if (reviewedFlag !== true) {
    workflowError(
      "AVATAR_REVIEW_REQUIRED",
      "Approval requires reviewed=true only after a human has actually inspected poses.png, turn.png, eyes.png and mouth.png. This acknowledgement cannot technically prove visual review or consent.",
    );
  }

  const project = await checkedPath(root, resolve(root, projectDir));
  const characterPath = await checkedPath(project, join(project, "character.json"));
  const manifestInfo = await lstat(characterPath).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      workflowError("AVATAR_MANIFEST_INVALID", "Missing character.json; build the imported avatar before approval.");
    }
    throw error;
  });
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() ||
      manifestInfo.size <= 0 || manifestInfo.size > MAX_MANIFEST_BYTES) {
    workflowError("AVATAR_MANIFEST_INVALID", "character.json must be a non-empty regular file smaller than 1 MB.");
  }

  const originalContents = await readFile(characterPath, "utf8");
  const { raw, character } = parseManifest(originalContents);
  requireSupportedImportedAvatar(character);
  await verifyCurrentBuild(characterPath, character);
  const reviewArtifacts = [
    ...await validateReviewArtifacts(project),
    ...(await requiresVectorReviewProof(project, character.render!.modelPath)
      ? await verifyVectorReviewProof(project, character.render!.modelPath) : []),
  ];

  if (character.poseFamilies[0]!.approved) {
    return {
      valid: true,
      status: "already-approved",
      approved: true,
      changed: false,
      characterPath,
      reviewArtifacts,
      message: "Avatar was already approved. Provenance and required review artifacts were rechecked; human review itself cannot be technically verified.",
    };
  }

  const rawPoses = raw.poseFamilies;
  if (!Array.isArray(rawPoses) || rawPoses.length !== 1 || !asRecord(rawPoses[0])) {
    workflowError("AVATAR_MANIFEST_INVALID", "character.json poseFamilies changed during approval validation.");
  }
  const rawPose = asRecord(rawPoses[0])!;
  rawPose.approved = true;
  const nextContents = JSON.stringify(raw, null, 2) + "\n";
  const tempPath = await checkedPath(project, characterPath + ".next-" + randomUUID());

  try {
    await writeFile(tempPath, nextContents, { encoding: "utf8", flag: "wx" });

    const currentContents = await readFile(characterPath, "utf8");
    if (currentContents !== originalContents) {
      workflowError(
        "AVATAR_MANIFEST_CHANGED",
        "character.json changed while approval was being prepared; no approval was written. Re-run after reviewing the current file.",
      );
    }

    // Recheck the exact build and review artifacts immediately before the atomic manifest swap.
    await verifyCurrentBuild(characterPath, character);
    await validateReviewArtifacts(project);
    if (await requiresVectorReviewProof(project, character.render!.modelPath)) {
      await verifyVectorReviewProof(project, character.render!.modelPath);
    }
    await rename(tempPath, characterPath);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }

  return {
    valid: true,
    status: "approved",
    approved: true,
    changed: true,
    characterPath,
    reviewArtifacts,
    message: "Approval recorded from an explicit reviewed=true acknowledgement. PuppetControl cannot technically verify human visual review or consent.",
  };
}

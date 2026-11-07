import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile, rename, unlink } from "node:fs/promises";
import { join, resolve, relative, sep } from "node:path";
import { characterSchema } from "../scene/schemas.js";
import { AvatarWorkflowError, checkedPath, pinnedRev2D, runRev2D, parsePngSize } from "./avatar.js";
import { assessAvatarGeometry } from "./geometry-quality.js";

const FORMAT = "puppetcontrol-landmarks-v1";
const SHA = /^[0-9a-f]{64}$/;
const GROUPS = new Set(["head", "face", "hair", "attachments", "body"]);

function digest(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
interface Project {
  dir: string;
  specFile: string;
  spec: Record<string, unknown>;
  specBytes: Buffer;
  sourceHash: string;
  specHash: string;
  width: number;
  height: number;
}

async function projectInfo(input: string, root: string): Promise<Project> {
  const dir = await checkedPath(root, input);
  const specFile = await checkedPath(root, join(dir, "avatar.json"));
  const source = await checkedPath(root, join(dir, "source.png"));
  const [specBytes, image] = await Promise.all([readFile(specFile), readFile(source)]);
  if (specBytes.length > 500_000 || image.length > 30 * 1024 * 1024) {
    throw new AvatarWorkflowError("AVATAR_TOO_LARGE", "Image or specification exceeds allowed size");
  }
  const spec: unknown = JSON.parse(specBytes.toString("utf8"));
  if (!record(spec) || spec.format !== "rev2d-avatar" || typeof spec.name !== "string" ||
      !record(spec.image) || spec.image.file !== "source.png") {
    throw new AvatarWorkflowError("AVATAR_SPEC_INVALID", "Expected a local Rev2D avatar project");
  }
  const { width, height } = parsePngSize(image);
  if (spec.image.width !== width || spec.image.height !== height) {
    throw new AvatarWorkflowError("IMAGE_DIMENSIONS_MISMATCH", "avatar.json dimensions differ from source.png");
  }
  return {
    dir, specFile, spec, specBytes, width, height,
    specHash: digest(specBytes), sourceHash: digest(image),
  };
}

/** Preserve protected actor metadata while applying the agent-proposed geometric groups. */
export function composeCandidate(
  sourceSpec: Record<string, unknown>, proposal: unknown, expectedHash: string,
): Record<string, unknown> {
  if (!record(proposal) || proposal.format !== FORMAT || typeof proposal.sourceSha256 !== "string" ||
      !SHA.test(proposal.sourceSha256) || proposal.sourceSha256 !== expectedHash) {
    throw new AvatarWorkflowError("PROPOSAL_SOURCE_MISMATCH", "Landmark proposal does not match source PNG SHA-256");
  }
  if (!record(proposal.landmarks) ||
      Object.keys(proposal.landmarks).some((key) => !GROUPS.has(key))) {
    throw new AvatarWorkflowError("PROPOSAL_INVALID", "Proposal may modify only landmark geometry groups");
  }
  if (Object.keys(proposal).some((key) =>
    !["format", "sourceSha256", "landmarks", "notes"].includes(key))) {
    throw new AvatarWorkflowError("PROPOSAL_INVALID", "Unexpected proposal property");
  }
  if (proposal.notes !== undefined &&
      (typeof proposal.notes !== "string" || proposal.notes.length > 2000)) {
    throw new AvatarWorkflowError("PROPOSAL_INVALID", "Notes must be a short string");
  }
  for (const key of ["head", "face", "body"]) {
    if (!record(proposal.landmarks[key])) {
      throw new AvatarWorkflowError("PROPOSAL_INCOMPLETE", "Missing required landmark group: " + key);
    }
  }
  // A proposal can never replace image/name, config, post-build operations or file paths.
  return {
    ...sourceSpec,
    head: proposal.landmarks.head,
    face: proposal.landmarks.face,
    body: proposal.landmarks.body,
    hair: proposal.landmarks.hair ?? sourceSpec.hair ?? { strands: [] },
    attachments: proposal.landmarks.attachments ?? sourceSpec.attachments ?? [],
  };
}

/**
 * Reject post-staging changes to non-landmark fields even if someone edits both
 * the staged JSON and its companion metadata. Image paths, post/build options,
 * and actor identity are always controlled by the existing project.
 */
export function verifyCandidateScope(
  original: Record<string, unknown>, candidate: unknown,
): void {
  if (!record(candidate)) {
    throw new AvatarWorkflowError("CANDIDATE_SCOPE_INVALID", "Staged avatar must be a JSON object");
  }
  for (const key of new Set([...Object.keys(original), ...Object.keys(candidate)])) {
    if (GROUPS.has(key)) continue;
    if (JSON.stringify(original[key]) !== JSON.stringify(candidate[key])) {
      throw new AvatarWorkflowError(
        "CANDIDATE_SCOPE_INVALID",
        "Staged avatar modified protected field: " + key,
      );
    }
  }
  for (const key of ["head", "face", "body"]) {
    if (!record(candidate[key])) {
      throw new AvatarWorkflowError("CANDIDATE_SCOPE_INVALID", "Staged landmark group missing: " + key);
    }
  }
}

async function createTaskIfMissing(path: string, content: string, hash?: string): Promise<boolean> {
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    if (hash) {
      let existing: unknown;
      try {
        existing = JSON.parse(await readFile(path, "utf8")) as unknown;
      } catch {
        throw new AvatarWorkflowError("LANDMARK_TASK_STALE", "Existing proposal template is not valid JSON");
      }
      if (!record(existing) || existing.sourceSha256 !== hash) {
        throw new AvatarWorkflowError("LANDMARK_TASK_STALE", "Existing proposal template belongs to another image; create a fresh import");
      }
    }
    return false;
  }
}

/** Create an idempotent, image-hash-bound visual annotation task for Claude/Codex. */
export async function prepareLandmarkTask(input: string, root = process.cwd()) {
  const project = await projectInfo(input, root);
  const instructions = await checkedPath(root, join(project.dir, "work", "landmark-agent-task.md"));
  const template = await checkedPath(root, join(project.dir, "work", "landmark-proposal.template.json"));
  const proposal = {
    format: FORMAT,
    sourceSha256: project.sourceHash,
    landmarks: {
      head: project.spec.head, face: project.spec.face, body: project.spec.body,
      hair: project.spec.hair ?? { strands: [] }, attachments: project.spec.attachments ?? [],
    },
    notes: "Inspect original artwork, replace null geometry with source pixel coordinates.",
  };
  const task = [
    "# PuppetControl — agent-assisted landmark proposal",
    "",
    "Do not declare the rig approved. This task requires actual visual inspection.",
    "Source image: " + join(project.dir, "source.png"),
    "Coordinate grid: " + join(project.dir, "work", "grid.png"),
    "Existing spec: " + project.specFile,
    "Original size: " + project.width + " x " + project.height,
    "Source SHA-256: " + project.sourceHash,
    "",
    "Open the image and coordinate grid with your image-viewing tool.",
    "Read .cache/rev2d/docs/AVATAR.md, section 4. Coordinates are original pixels (+x right, +y down).",
    "ImageLeft and ImageRight refer to sides of the IMAGE, not the character.",
    "Identify head/face ellipses, eye opening and region polygons, both iris centers, nose, mouth corners/area, chin, neck/pivot, and torso pivot/fade/chest.",
    "Avoid hair and eyelashes inside the eye-opening polygons; leave optional hair/accessories empty when unsure.",
    "Save a complete proposal using the provided landmark-proposal.template.json.",
    "Do not modify source.png or its path; do not invent occluded anatomy.",
    "",
    "Step 1: puppetctl character landmarks stage <project> --proposal <proposal.json>",
    "Step 2: inspect the staged overlay PNG and source image. A geometry validation pass is not visual approval.",
    "Step 3: puppetctl character landmarks accept <project> --candidate <returned-dir> --reviewed",
    "Step 4: puppetctl character build <project> --force; inspect eyes/mouth/turn/poses review sheets.",
    "The generated character remains unapproved even if the build succeeds.",
    "",
  ].join("\n");
  await mkdir(join(project.dir, "work"), { recursive: true });
  const instructionsCreated = await createTaskIfMissing(instructions, task);
  const templateCreated = await createTaskIfMissing(template, JSON.stringify(proposal, null, 2) + "\n", project.sourceHash);
  return {
    valid: true, status: "agent-landmarks-needed",
    instructions, proposalTemplate: template,
    grid: join(project.dir, "work", "grid.png"), sourceSha256: project.sourceHash,
    instructionsCreated, templateCreated, approved: false,
  };
}

interface CandidateMetadata {
  format: "puppetcontrol-candidate-v1";
  originalSpecHash: string;
  sourceHash: string;
  candidateHash: string;
}

/** Validate an untrusted proposal in an isolated folder and produce an overlay. */
export async function stageLandmarks(input: string, proposalFile: string, root = process.cwd()) {
  const project = await projectInfo(input, root);
  const proposalPath = await checkedPath(root, proposalFile);
  const proposalStat = await stat(proposalPath);
  if (!proposalStat.isFile() || proposalStat.size > 200_000) {
    throw new AvatarWorkflowError("PROPOSAL_TOO_LARGE", "Proposal must be a JSON file no larger than 200 KB");
  }
  const proposal: unknown = JSON.parse(await readFile(proposalPath, "utf8"));
  const candidate = composeCandidate(project.spec, proposal, project.sourceHash);
  const candidateText = JSON.stringify(candidate, null, 2) + "\n";
  const id = digest(candidateText).slice(0, 16);
  const parent = await checkedPath(root, join(project.dir, "work", "landmark-candidates"));
  await mkdir(parent, { recursive: true });
  const dir = await checkedPath(root, join(parent, id));
  try {
    await mkdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new AvatarWorkflowError("CANDIDATE_EXISTS", "The exact proposal has already been staged: " + dir);
    }
    throw error;
  }
  await copyFile(join(project.dir, "source.png"), join(dir, "source.png"));
  await writeFile(join(dir, "avatar.json"), candidateText, { encoding: "utf8", flag: "wx" });
  const upstream = await pinnedRev2D(root);
  // Validation reads the isolated candidate directory, never the live avatar spec.
  await runRev2D(upstream, ["avatar", "validate", dir]);
  await mkdir(join(dir, "work"));
  const overlay = join(dir, "work", "overlay.png");
  await runRev2D(upstream, ["avatar", "overlay", dir, "-o", overlay]);
  const metadata: CandidateMetadata = {
    format: "puppetcontrol-candidate-v1",
    originalSpecHash: project.specHash,
    sourceHash: project.sourceHash,
    candidateHash: digest(candidateText),
  };
  await writeFile(join(dir, "proposal-meta.json"), JSON.stringify(metadata, null, 2) + "\n", { flag: "wx" });
  return {
    valid: true, status: assessAvatarGeometry(candidate).length
      ? "overlay-review-required-with-warnings" : "overlay-review-required",
    candidateDir: dir, overlay,
    originalUnchanged: true, approved: false,
    geometryWarnings: assessAvatarGeometry(candidate),
    next: "Inspect the overlay, then explicitly accept it with --reviewed.",
  };
}

/** A pre-existing backup is reusable only if it matches the exact original bytes. */
export async function preserveAvatarBackup(path: string, source: Buffer): Promise<void> {
  try {
    await writeFile(path, source, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    const current = await readFile(path);
    if (!current.equals(source)) {
      throw new AvatarWorkflowError("BACKUP_CONFLICT", "Existing avatar backup differs from the current source specification");
    }
  }
}

/** Replace one JSON file using a unique same-directory temp path; stale temp files do not block retries. */
async function replaceJsonFile(path: string, content: string | Buffer): Promise<void> {
  const tmp = path + ".next-" + randomUUID();
  try {
    await writeFile(tmp, content, { flag: "wx" });
    await rename(tmp, path);
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/** Revalidate a reviewed candidate, back up the original, then revoke approval and accept. */
export async function acceptLandmarks(
  input: string, candidatePath: string, reviewed: boolean, root = process.cwd(),
) {
  if (!reviewed) throw new AvatarWorkflowError("VISUAL_REVIEW_REQUIRED", "Visual inspection must be acknowledged with --reviewed");
  const project = await projectInfo(input, root);
  const dir = await checkedPath(root, candidatePath);
  const parent = resolve(project.dir, "work", "landmark-candidates");
  const rel = relative(parent, dir);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || rel.includes(sep) || rel.startsWith(".")) {
    throw new AvatarWorkflowError("CANDIDATE_PATH_INVALID", "Not a staged candidate of this avatar");
  }
  const [metadataBytes, candidateBytes, stagedImage] = await Promise.all([
    readFile(await checkedPath(root, join(dir, "proposal-meta.json"))),
    readFile(await checkedPath(root, join(dir, "avatar.json"))),
    readFile(await checkedPath(root, join(dir, "source.png"))),
  ]);
  const metadata = JSON.parse(metadataBytes.toString("utf8")) as CandidateMetadata;
  if (metadata.format !== "puppetcontrol-candidate-v1" ||
      metadata.originalSpecHash !== project.specHash ||
      metadata.sourceHash !== project.sourceHash ||
      metadata.sourceHash !== digest(stagedImage) ||
      metadata.candidateHash !== digest(candidateBytes)) {
    throw new AvatarWorkflowError("CANDIDATE_STALE", "Source, original spec or staged proposal changed since validation");
  }
  const candidateSpec = JSON.parse(candidateBytes.toString("utf8")) as unknown;
  verifyCandidateScope(project.spec, candidateSpec);
  const overlay = await stat(await checkedPath(root, join(dir, "work", "overlay.png")));
  if (!overlay.isFile() || overlay.size < 100) {
    throw new AvatarWorkflowError("OVERLAY_MISSING", "Inspectable candidate overlay is required");
  }
  const upstream = await pinnedRev2D(root);
  await runRev2D(upstream, ["avatar", "validate", dir]);

  // Back up BEFORE invalidating the old rig. An incompatible existing backup
  // must fail without changing the character's current approval.
  const backup = await checkedPath(root, join(project.dir, "avatar.json.before-" + project.specHash.slice(0, 16) + ".bak"));
  await preserveAvatarBackup(backup, project.specBytes);

  // Revoke approval before changing the spec. Interrupted runs fail closed.
  const manifestPath = await checkedPath(root, join(project.dir, "character.json"));
  let approvalRevoked = false;
  try {
    const old = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    const manifest = characterSchema.parse(old);
    for (const pose of manifest.poseFamilies) pose.approved = false;
    await replaceJsonFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    approvalRevoked = true;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }

  await replaceJsonFile(project.specFile, candidateBytes);
  return {
    valid: true, status: "rebuild-required", approved: false,
    avatarSpecPath: project.specFile, backup, approvalRevoked,
    geometryWarnings: assessAvatarGeometry(candidateSpec),
    next: "Run character build --force, inspect all review sheets, then explicitly run character approve <projectDir> --reviewed only if the visual rig is genuinely acceptable.",
  };
}

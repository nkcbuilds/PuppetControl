import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, stat, lstat, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { characterSchema, sceneSchema, type Character, type Scene } from "../scene/schemas.js";

const execFileAsync = promisify(execFile);
export const PINNED_REV2D_SHA = "f144581cdf1f12d781379c4df90d262b8c2dfa3d";
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

export class AvatarWorkflowError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AvatarWorkflowError";
  }
}

function requireInside(root: string, target: string): string {
  const absolute = resolve(target);
  const rel = relative(root, absolute);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new AvatarWorkflowError("PATH_OUTSIDE_WORKSPACE", "Character imports must stay in the current project workspace");
  }
  return absolute;
}

/** Check symlink resolution for the nearest existing ancestor as well as lexical path confinement. */
export async function checkedPath(root: string, target: string): Promise<string> {
  const rootReal = await realpath(root);
  const absolute = requireInside(rootReal, target);
  let ancestor = absolute;
  while (true) {
    try {
      const real = await realpath(ancestor);
      requireInside(rootReal, real);
      break;
    } catch (error) {
      if (error instanceof AvatarWorkflowError) throw error;
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  return absolute;
}

export function parsePngSize(buffer: Uint8Array): { width: number; height: number } {
  const bytes = Buffer.from(buffer);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
      bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new AvatarWorkflowError("PNG_REQUIRED", "Supply a valid PNG illustration with an IHDR chunk");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 256 || height < 256 || width > 4096 || height > 4096) {
    throw new AvatarWorkflowError("IMAGE_SIZE_UNSUPPORTED", "Artwork must be 256–4096 pixels per dimension");
  }
  return { width, height };
}

export interface Rev2DModelParameters {
  meta?: { width: number; height: number };
  parameters: Array<{ id: string; default?: number; min: number; max: number }>;
}

function hasParameter(model: Rev2DModelParameters, id: string): boolean {
  return model.parameters.some((param) => param.id === id);
}

/** Only claim expressions for controls the built model actually declares. */
export function createImportedCharacter(id: string, model: Rev2DModelParameters): Character {
  if (!IDENTIFIER.test(id)) {
    throw new AvatarWorkflowError("INVALID_CHARACTER_ID", "Character ID must contain letters, digits, dashes or underscores");
  }
  if (!Array.isArray(model.parameters) || !hasParameter(model, "MouthOpen") ||
      !hasParameter(model, "MouthForm") || !hasParameter(model, "AngleX") ||
      !hasParameter(model, "AngleY") || !hasParameter(model, "EyeBallX") ||
      !hasParameter(model, "EyeBallY")) {
    throw new AvatarWorkflowError("AVATAR_CONTROLS_MISSING", "Built avatar needs mouth, gaze and head controls");
  }
  const expressionPresets: Record<string, Record<string, number>> = { neutral: {} };
  const happy: Record<string, number> = { MouthForm: 0.6 };
  if (hasParameter(model, "Cheek")) happy.Cheek = 0.3;
  expressionPresets.happy = happy;
  const confused: Record<string, number> = { MouthForm: -0.3 };
  if (hasParameter(model, "BrowLY")) confused.BrowLY = 0.4;
  if (hasParameter(model, "BrowRY")) confused.BrowRY = -0.2;
  expressionPresets.confused = confused;

  const manifest = {
    schemaVersion: 1,
    id,
    defaultPose: "neutral",
    poseFamilies: [{ name: "neutral", rigId: id + "-avatar", modelPath: id + ".r2d.json", head: "shared", approved: false }],
    expressions: Object.keys(expressionPresets),
    motions: [],
    transitions: [],
    render: { backend: "rev2d", modelPath: id + ".r2d.json", expressionPresets },
  };
  return characterSchema.parse(manifest);
}

/** Scene scaffold remains unrenderable until a real visual review approves the character manifest. */
export function createImportedPreviewScene(id: string, dimensions: { width: number; height: number }): Scene {
  return sceneSchema.parse({
    schemaVersion: 1,
    id: id + "-preview",
    durationMs: 4000,
    fps: 15,
    resolution: { width: dimensions.width, height: dimensions.height },
    actors: [{ id, characterPath: "character.json" }],
    audio: [],
    events: [
      { atMs: 600, actor: id, kind: "expression", name: "happy", intensity: 0.5 },
      { atMs: 1000, actor: id, kind: "look", x: 0.35, y: -0.2, durationMs: 450 },
      { atMs: 2400, actor: id, kind: "look", x: -0.35, y: 0.2, durationMs: 450 },
    ],
  });
}

interface CommandOutput {
  ok?: boolean;
  notes?: string[];
  warnings?: number;
  diagnostics?: unknown[];
  [key: string]: unknown;
}

export async function runRev2D(repo: string, args: string[], timeout = 120_000): Promise<CommandOutput> {
  const entry = join(repo, "bin", "rev2d.js");
  try {
    const { stdout } = await execFileAsync(process.execPath, [entry, ...args, "--json"], {
      shell: false, windowsHide: true, timeout, maxBuffer: 12 * 1024 * 1024,
      cwd: repo,
    });
    const parsed = JSON.parse(stdout) as CommandOutput;
    if (parsed.ok === false) throw new Error("Rev2D reported failure");
    return parsed;
  } catch (error) {
    const failure = error as Error & { stderr?: string; stdout?: string };
    // Return the upstream validator's precise diagnostics rather than hiding them.
    let output: CommandOutput = {};
    try { output = JSON.parse(failure.stdout ?? "{}") as CommandOutput; } catch { /* not JSON */ }
    const diagnosticText = output.diagnostics ? JSON.stringify(output.diagnostics).slice(0, 3500) : "";
    throw new AvatarWorkflowError(
      "REV2D_AVATAR_FAILED",
      [diagnosticText, failure.stderr, failure.message].filter(Boolean).join("\n").slice(0, 5000),
    );
  }
}

export async function pinnedRev2D(root: string): Promise<string> {
  const repo = await checkedPath(root, resolve(root, process.env.PUPPETCONTROL_REV2D_ROOT ?? ".cache/rev2d"));
  try {
    const { stdout } = await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"], {
      shell: false, windowsHide: true, timeout: 5000,
    });
    if (stdout.trim() !== PINNED_REV2D_SHA) {
      throw new AvatarWorkflowError("REV2D_PIN_MISMATCH", "Run npm run rig:setup; the active Rev2D checkout is not pinned");
    }
  } catch (error) {
    if (error instanceof AvatarWorkflowError) throw error;
    throw new AvatarWorkflowError("REV2D_NOT_READY", "Install the pinned Rev2D backend with npm run rig:setup");
  }
  return repo;
}

export async function importAvatar(inputFile: string, outputDir: string, id: string, root = process.cwd()) {
  if (!IDENTIFIER.test(id)) throw new AvatarWorkflowError("INVALID_CHARACTER_ID", "Use a simple alphanumeric character ID");
  const source = await checkedPath(root, inputFile);
  const project = await checkedPath(root, outputDir);
  if (!source.toLowerCase().endsWith(".png")) throw new AvatarWorkflowError("PNG_REQUIRED", "Image import currently accepts PNG files only");
  const sourceStat = await stat(source);
  if (!sourceStat.isFile() || sourceStat.size > MAX_SOURCE_BYTES) {
    throw new AvatarWorkflowError("IMAGE_TOO_LARGE", "Image must be a file smaller than 30 MB");
  }
  const data = await readFile(source);
  const dimensions = parsePngSize(data);
  try {
    await lstat(project);
    throw new AvatarWorkflowError("PROJECT_EXISTS", "Destination already exists; choose an empty project folder");
  } catch (error) {
    if (error instanceof AvatarWorkflowError) throw error;
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const repo = await pinnedRev2D(root);
  await mkdir(dirname(project), { recursive: true });
  const created = await runRev2D(repo, ["avatar", "new", source, project, "--name", id]);
  await runRev2D(repo, ["avatar", "grid", project, "-o", join(project, "work", "grid.png")]);
  return {
    valid: true, status: "landmarks-required", id, projectDir: project,
    sourcePath: join(project, "source.png"), landmarksPath: join(project, "avatar.json"),
    gridPath: join(project, "work", "grid.png"), dimensions,
    sourceSha256: createHash("sha256").update(data).digest("hex"),
    notes: created.notes ?? [], approved: false,
    next: "Edit avatar.json landmarks, then run puppetctl character build <projectDir>. The generated rig must be visually reviewed.",
  };
}

export async function buildAvatar(projectDir: string, overwrite = false, root = process.cwd()) {
  const project = await checkedPath(root, projectDir);
  const specPath = await checkedPath(root, join(project, "avatar.json"));
  const spec = JSON.parse(await readFile(specPath, "utf8")) as {
    format?: unknown; name?: unknown; image?: { file?: unknown };
  };
  if (spec.format !== "rev2d-avatar" || typeof spec.name !== "string" || !IDENTIFIER.test(spec.name) ||
    spec.image?.file !== "source.png") {
    throw new AvatarWorkflowError("AVATAR_SPEC_INVALID", "Invalid Rev2D avatar.json; run character import first");
  }
  const name = spec.name;
  const manifestPath = await checkedPath(root, join(project, "character.json"));
  const previewPath = await checkedPath(root, join(project, "preview-scene.json"));
  if (!overwrite) {
    try {
      await lstat(manifestPath);
      throw new AvatarWorkflowError("MANIFEST_EXISTS", "character.json exists; use --force only if you want to reset approval and existing manifest edits");
    } catch (error) {
      if (error instanceof AvatarWorkflowError) throw error;
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  const repo = await pinnedRev2D(root);
  await runRev2D(repo, ["avatar", "validate", project]);
  const built = await runRev2D(repo, ["avatar", "build", project], 240_000);
  await runRev2D(repo, ["avatar", "poses", project], 240_000);
  const modelPath = await checkedPath(root, join(project, name + ".r2d.json"));
  const rigStat = await stat(modelPath);
  if (!rigStat.isFile() || rigStat.size > 20_000_000) {
    throw new AvatarWorkflowError("REV2D_MODEL_INVALID", "Generated avatar model was not found or is too large");
  }
  const model = JSON.parse(await readFile(modelPath, "utf8")) as Rev2DModelParameters;
  const character = createImportedCharacter(name, model);
  if (!model.meta) throw new AvatarWorkflowError("AVATAR_MODEL_METADATA_MISSING", "Built model has no native dimensions");
  const previewScene = createImportedPreviewScene(name, model.meta);
  const content = JSON.stringify(character, null, 2) + "\n";
  const previewContent = JSON.stringify(previewScene, null, 2) + "\n";
  if (overwrite) {
    const temp = manifestPath + ".tmp-" + process.pid;
    await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
    await rename(temp, manifestPath);
    await writeFile(previewPath, previewContent, { encoding: "utf8" });
  } else {
    await writeFile(previewPath, previewContent, { encoding: "utf8", flag: "wx" });
    await writeFile(manifestPath, content, { encoding: "utf8", flag: "wx" });
  }
  return {
    valid: true, status: "review-required", approved: false, characterId: name,
    characterPath: manifestPath, modelPath, previewScenePath: previewPath,
    review: {
      poses: join(project, "review", "poses.png"),
      turn: join(project, "review", "turn.png"),
      eyes: join(project, "review", "eyes.png"),
      mouth: join(project, "review", "mouth.png"),
      summary: join(project, "review", "summary.json"),
    },
    notes: built.notes ?? [],
    next: "Inspect every review image, repair avatar.json if needed, rebuild with --force, and only then set poseFamilies[0].approved=true in character.json.",
  };
}

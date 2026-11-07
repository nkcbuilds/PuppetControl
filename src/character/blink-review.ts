/**
 * Generate a visual blink inspection package from one VERIFIED, unapproved or
 * approved imported Rev2D avatar. This is not a rig fix or an approval gate.
 *
 * Closely sample both sprite transitions; generic 4-column Rev2D review
 * sheets can otherwise miss double outlines at EyeOpen=0.19 and 0.69.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { characterSchema } from "../scene/schemas.js";
import { AvatarWorkflowError, checkedPath, pinnedRev2D, runRev2D } from "./avatar.js";
import { verifyAvatarBuildRecord, checkAvatarPoseCoverage } from "./provenance.js";
import { comparePngSequence } from "./frame-sequence-qa.js";
import { parsePixelRegionArgument, type PixelRegion } from "./pixel-qa.js";

const execFileAsync = promisify(execFile);
const MAX_MODEL_BYTES = 20_000_000;
export const BLINK_CLOSING_VALUES = [
  1, 0.83, 0.71, 0.70, 0.69, 0.68, 0.50,
  0.21, 0.20, 0.19, 0.18, 0.17, 0,
] as const;
/** 25 evenly-timed frame slots sampled from 13 explicitly rendered rig states. */
export const BLINK_REVIEW_VALUES: number[] = [
  ...BLINK_CLOSING_VALUES,
  ...BLINK_CLOSING_VALUES.slice(0, -1).reverse(),
];

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue : null;
}

function openingBounds(value: unknown): { left: number; right: number; top: number; bottom: number } | null {
  if (!Array.isArray(value) || value.length < 8 || value.length % 2) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < value.length; i += 2) {
    const x = value[i]; const y = value[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    xs.push(x as number); ys.push(y as number);
  }
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** Eyes ROI is a starting crop for human inspection, not an accuracy rating. */
export function eyeRegionFromAvatarSpec(
  spec: unknown, width: number, height: number,
): PixelRegion {
  const face = record(record(spec)?.face);
  const eyes = record(face?.eyes);
  const bounds = ["imageLeft", "imageRight"]
    .map((side) => openingBounds(record(eyes?.[side])?.opening));
  if (bounds.some((item) => item === null) || !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) || width < 256 || height < 256) {
    throw new AvatarWorkflowError("BLINK_EYE_REGION_REQUIRED",
      "Cannot infer both eye openings from avatar.json. Provide --region x,y,width,height.");
  }
  const both = bounds as NonNullable<typeof bounds[0]>[];
  const left = Math.max(0, Math.floor(Math.min(...both.map((b) => b.left)) - 26));
  const top = Math.max(0, Math.floor(Math.min(...both.map((b) => b.top)) - 24));
  const right = Math.min(width, Math.ceil(Math.max(...both.map((b) => b.right)) + 26));
  const bottom = Math.min(height, Math.ceil(Math.max(...both.map((b) => b.bottom)) + 24));
  if (right <= left || bottom <= top) {
    throw new AvatarWorkflowError("BLINK_EYE_REGION_REQUIRED", "Invalid eye-opening crop.");
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

async function contactSheet(
  framesDirectory: string, outputFile: string,
  crop?: PixelRegion,
): Promise<void> {
  const cropStage = crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` : "";
  const scaleStage = crop ? "scale=490:-2:flags=lanczos" : "scale=256:-2:flags=lanczos";
  try {
    await execFileAsync("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-framerate", "30", "-i", join(framesDirectory, "frame-%03d.png"),
      "-vf", cropStage + scaleStage + ",tile=5x5", "-frames:v", "1", outputFile,
    ], { windowsHide: true, shell: false, timeout: 90_000, maxBuffer: 4_000_000 });
  } catch (cause) {
    throw new AvatarWorkflowError("BLINK_CONTACT_FAILED",
      "Cannot create blink contact sheet with FFmpeg: " + String(cause));
  }
}

export async function createBlinkReview(
  projectDir: string, options: { region?: PixelRegion; root?: string } = {},
) {
  const root = resolve(options.root ?? process.cwd());
  const project = await checkedPath(root, resolve(root, projectDir));
  const characterFile = await checkedPath(project, join(project, "character.json"));
  const manifest = characterSchema.parse(JSON.parse(await readFile(characterFile, "utf8")) as unknown);
  if (!manifest.provenance || !manifest.render ||
      manifest.poseFamilies.length !== 1) {
    throw new AvatarWorkflowError("BLINK_REVIEW_IMPORTED_AVATAR_REQUIRED",
      "Blink review requires one provenance-tracked imported Rev2D actor, with or without approval.");
  }
  const coverage = checkAvatarPoseCoverage(manifest);
  if (!coverage.valid) throw new AvatarWorkflowError(coverage.code, coverage.message);
  const provenance = await verifyAvatarBuildRecord(characterFile, manifest.render.modelPath);
  if (!provenance.valid) throw new AvatarWorkflowError(provenance.code, provenance.message);
  const modelPath = await checkedPath(project, resolve(project, manifest.render.modelPath));
  const stats = await stat(modelPath);
  if (!stats.isFile() || stats.size > MAX_MODEL_BYTES) {
    throw new AvatarWorkflowError("BLINK_REVIEW_MODEL_INVALID", "Missing/oversized rig model.");
  }
  const model = JSON.parse(await readFile(modelPath, "utf8")) as {
    meta?: { width: number; height: number };
    parameters?: { id: string; min: number; max: number }[];
  };
  const width = model.meta?.width;
  const height = model.meta?.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width! < 256 || height! < 256 || width! > 4096 || height! > 4096 ||
      !["EyeLOpen", "EyeROpen"].every((name) =>
        model.parameters?.some((parameter) =>
          parameter.id === name && parameter.min <= 0 && parameter.max >= 1))) {
    throw new AvatarWorkflowError("BLINK_REVIEW_EYE_CONTROLS_MISSING",
      "Rig requires EyeLOpen and EyeROpen parameters accepting 0–1.");
  }
  const spec = JSON.parse(await readFile(join(project, "avatar.json"), "utf8")) as unknown;
  const region = options.region ?? eyeRegionFromAvatarSpec(spec, width!, height!);
  // Reuse canonical region validation in the bounded PNG comparator.
  parsePixelRegionArgument(`${region.x},${region.y},${region.width},${region.height}`);
  if (region.x + region.width > width! || region.y + region.height > height!) {
    throw new AvatarWorkflowError("BLINK_EYE_REGION_REQUIRED", "Eye region exceeds the rig canvas.");
  }
  const backend = await pinnedRev2D(root);
  const runRoot = await checkedPath(root, join(root, "outputs", "qa", "blink-review", randomUUID()));
  const framesDir = join(runRoot, "frames");
  await mkdir(framesDir, { recursive: true });

  const frames: string[] = [];
  for (let index = 0; index < BLINK_CLOSING_VALUES.length; index++) {
    const value = BLINK_CLOSING_VALUES[index]!;
    const path = join(framesDir, `frame-${String(index).padStart(3, "0")}.png`);
    await runRev2D(backend, [
      "render", modelPath, "-o", path, "--param", `EyeLOpen=${value}`,
      "--param", `EyeROpen=${value}`, "--bg", "#f0eaf4", "--ss", "1",
    ], 60_000);
    frames.push(path);
  }
  for (let index = BLINK_CLOSING_VALUES.length; index < BLINK_REVIEW_VALUES.length; index++) {
    const sourceIndex = BLINK_REVIEW_VALUES.length - 1 - index;
    const path = join(framesDir, `frame-${String(index).padStart(3, "0")}.png`);
    await copyFile(frames[sourceIndex]!, path);
    frames.push(path);
  }
  const report = await comparePngSequence(frames, {
    region, controlValues: BLINK_REVIEW_VALUES,
  }, root);
  const fullSheet = join(runRoot, "blink-full.png");
  const eyeSheet = join(runRoot, "blink-eyes.png");
  await contactSheet(framesDir, fullSheet);
  await contactSheet(framesDir, eyeSheet, region);
  const reportPath = join(runRoot, "blink-review.json");
  const evidence = {
    version: 1,
    status: "visual-review-required",
    approvedByThisCommand: false,
    projectDir: project,
    values: BLINK_REVIEW_VALUES,
    closingFramesRendered: BLINK_CLOSING_VALUES.length,
    openingFramesReused: BLINK_REVIEW_VALUES.length - BLINK_CLOSING_VALUES.length,
    fpsForContactOrdering: 30,
    region, report,
    fullSheet, eyeSheet, framesDirectory: framesDir,
    notes: [
      "Static eye sprites can plateau despite control changes; inspect every contact panel, particularly EyeOpen=0.19/0.69.",
      "Numbers cannot assess lash seams, iris clipping, head turns or whether eyelids look natural.",
      "This command never changes the rig or its approval state. A human must still approve intentionally.",
    ],
  };
  await writeFile(reportPath, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  return { valid: true, ...evidence, reportPath };
}

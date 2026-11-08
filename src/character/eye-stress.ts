/**
 * Deterministic opt-in 4x4 eye/expression/head/gaze stress review.
 *
 * Unlike a neutral blink, these exact 16 combinations expose whether an
 * imported rig retains eyelid/iris occlusion when head or facial controls
 * move. This command produces QA evidence, NOT an artistic approval gate.
 */
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { characterSchema } from "../scene/schemas.js";
import { AvatarWorkflowError, checkedPath, pinnedRev2D, runRev2D } from "./avatar.js";
import { verifyAvatarBuildRecord } from "./provenance.js";
import { eyeRegionFromAvatarSpec } from "./blink-review.js";

const execFileAsync = promisify(execFile);
const CONTROLS = [
  "EyeLOpen", "EyeROpen", "EyeBallX", "EyeBallY",
  "AngleX", "AngleY", "MouthOpen", "MouthForm",
] as const;
type Control = typeof CONTROLS[number];
export type EyeStressCase = { id: string; params: Record<Control, number> };
export type ParameterLimit = { id: string; min: number; max: number; default?: number };
const BASE: Record<Control, number> = {
  EyeLOpen: 1, EyeROpen: 1, EyeBallX: 0, EyeBallY: 0,
  AngleX: 0, AngleY: 0, MouthOpen: 0, MouthForm: 0,
};
const CASES: Array<[string, Partial<Record<Control, number>>]> = [
  ["open-neutral", {}],
  ["half-neutral", { EyeLOpen: 0.45, EyeROpen: 0.45 }],
  ["nearly-closed", { EyeLOpen: 0.08, EyeROpen: 0.08 }],
  ["closed-neutral", { EyeLOpen: 0, EyeROpen: 0 }],
  ["gaze-left-half", { EyeLOpen: 0.35, EyeROpen: 0.35, EyeBallX: -0.2 }],
  ["gaze-right-half", { EyeLOpen: 0.35, EyeROpen: 0.35, EyeBallX: 0.2 }],
  ["gaze-up-half", { EyeLOpen: 0.35, EyeROpen: 0.35, EyeBallY: 0.2 }],
  ["gaze-down-half", { EyeLOpen: 0.35, EyeROpen: 0.35, EyeBallY: -0.2 }],
  ["yaw-left-quarter", { EyeLOpen: 0.25, EyeROpen: 0.25, AngleX: -8 }],
  ["yaw-right-quarter", { EyeLOpen: 0.25, EyeROpen: 0.25, AngleX: 8 }],
  ["pitch-up-half", { EyeLOpen: 0.4, EyeROpen: 0.4, AngleY: 5 }],
  ["pitch-down-half", { EyeLOpen: 0.4, EyeROpen: 0.4, AngleY: -5 }],
  ["happy-speaking", { MouthForm: 0.6, MouthOpen: 0.65 }],
  ["happy-look-right", { EyeLOpen: 0.4, EyeROpen: 0.4,
    AngleX: 8, EyeBallX: 0.2, MouthForm: 0.6, MouthOpen: 0.4 }],
  ["confused-look-left", { EyeLOpen: 0.35, EyeROpen: 0.35,
    AngleX: -8, EyeBallX: -0.2, MouthForm: -0.3 }],
  ["wink-and-talk", { EyeLOpen: 0, EyeROpen: 1,
    MouthOpen: 0.7, MouthForm: 0.2, AngleY: 5 }],
];

export function eyeStressCases(parameters: readonly ParameterLimit[]): EyeStressCase[] {
  if (!Array.isArray(parameters)) {
    throw new AvatarWorkflowError("EYE_STRESS_CONTROLS_UNSUPPORTED", "Rev2D parameter metadata is missing");
  }
  const known = new Map(parameters.map(p => [p.id, p]));
  if (known.size !== parameters.length) {
    throw new AvatarWorkflowError("EYE_STRESS_CONTROLS_UNSUPPORTED", "Duplicate Rev2D parameter IDs");
  }
  return CASES.map(([id, values]) => {
    const params = { ...BASE, ...values };
    for (const name of CONTROLS) {
      const limit = known.get(name);
      const value = params[name];
      if (!limit || !Number.isFinite(limit.min) || !Number.isFinite(limit.max) ||
          limit.min > value || limit.max < value) {
        throw new AvatarWorkflowError("EYE_STRESS_CONTROLS_UNSUPPORTED",
          "Missing/incompatible Rev2D control " + name + " for sample " + id);
      }
    }
    return { id, params };
  });
}

async function sheet(frames: string, output: string, crop?: string) {
  const filters = [
    ...(crop ? [crop] : []),
    crop ? "scale=400:-2:flags=lanczos" : "scale=256:-2:flags=lanczos",
    "tile=4x4",
  ].join(",");
  await execFileAsync("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
    "-framerate", "1", "-i", frames, "-vf", filters,
    "-frames:v", "1", output,
  ], { shell: false, windowsHide: true, timeout: 90_000, maxBuffer: 4_000_000 });
}

export async function createEyeStressReview(projectDir: string, root = process.cwd()) {
  const rootPath = resolve(root);
  const project = await checkedPath(rootPath, resolve(rootPath, projectDir));
  const characterPath = await checkedPath(project, join(project, "character.json"));
  const manifest = characterSchema.parse(JSON.parse(await readFile(characterPath, "utf8")) as unknown);
  if (!manifest.provenance || !manifest.render || manifest.render.backend !== "rev2d" ||
      manifest.poseFamilies.length !== 1) {
    throw new AvatarWorkflowError("EYE_STRESS_IMPORTED_RIG_REQUIRED",
      "Stress review requires one provenance-verified imported Rev2D character");
  }
  const integrity = await verifyAvatarBuildRecord(characterPath, manifest.render.modelPath);
  if (!integrity.valid) throw new AvatarWorkflowError(integrity.code, integrity.message);
  const modelPath = await checkedPath(project, join(project, manifest.render.modelPath));
  const info = await stat(modelPath);
  if (!info.isFile() || info.size <= 1 || info.size > 20_000_000) {
    throw new AvatarWorkflowError("EYE_STRESS_MODEL_INVALID", "Rev2D model absent or oversized");
  }
  const modelBytes = await readFile(modelPath);
  const model = JSON.parse(modelBytes.toString("utf8")) as {
    meta?: { width: number; height: number };
    parameters?: ParameterLimit[];
  };
  const cases = eyeStressCases(model.parameters ?? []);
  const width = model.meta?.width, height = model.meta?.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width! < 256 || height! < 256 || width! > 4096 || height! > 4096) {
    throw new AvatarWorkflowError("EYE_STRESS_MODEL_INVALID", "Unsupported model dimensions");
  }
  const specPath = await checkedPath(project, join(project, "avatar.json"));
  const spec = JSON.parse(await readFile(specPath, "utf8")) as unknown;
  const region = eyeRegionFromAvatarSpec(spec, width!, height!);
  const backend = await pinnedRev2D(rootPath);
  const destination = await checkedPath(rootPath,
    join(rootPath, "outputs", "qa", "eye-stress", randomUUID()));
  const framesDirectory = join(destination, "frames");
  await mkdir(framesDirectory, { recursive: true });
  for (const [i, item] of cases.entries()) {
    const file = join(framesDirectory, "frame-" + String(i).padStart(3, "0") + ".png");
    const params = CONTROLS.flatMap(name => ["--param", name + "=" + item.params[name]]);
    await runRev2D(backend, [
      "render", modelPath, "-o", file, ...params, "--bg", "#f0eaf4", "--ss", "1",
    ], 60_000);
  }
  const input = join(framesDirectory, "frame-%03d.png");
  const fullSheet = join(destination, "expression-full.png");
  const eyeSheet = join(destination, "expression-eyes.png");
  await sheet(input, fullSheet);
  await sheet(input, eyeSheet,
    `crop=${region.width}:${region.height}:${region.x}:${region.y}`);
  const reportPath = join(destination, "eye-stress.json");
  const result = {
    valid: true, approvedByThisCommand: false, status: "visual-review-required",
    profile: "combined-eye-gaze-head-expression",
    characterId: manifest.id,
    modelPath: manifest.render.modelPath,
    modelSha256: createHash("sha256").update(modelBytes).digest("hex"),
    cases, region, framesDirectory, fullSheet, eyeSheet, reportPath,
    notes: [
      "All 16 frames come from actual pinned Rev2D renders; inspect both full and eye crops.",
      "This checks combined controls at bounded points. It does not prove quality across continuous motion or other illustration styles.",
      "Character approval is never changed or implied.",
    ],
  };
  await writeFile(reportPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  return result;
}

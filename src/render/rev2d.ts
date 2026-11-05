import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, readFile, stat, writeFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Character, Scene } from "../scene/schemas.js";
import { compilePerformance, PreviewUnsupportedError } from "./scene-plan.js";
import { parseRhubarbMouthCuesJson } from "../audio/rhubarb.js";
import { buildFfmpegArgs, type FfmpegAudioInput } from "../audio/ffmpeg.js";
import type { VideoOutput } from "../video/output.js";
import { planPoseTimeline, PoseTimelineError } from "../animation/pose-timeline.js";

const execFileAsync = promisify(execFile);

interface Rev2DParameter {
  id: string;
  default?: number;
  min: number;
  max: number;
}
interface Rev2DModel {
  meta: { width: number; height: number; name: string };
  textures?: { id: string; path: string }[];
  parameters: Rev2DParameter[];
  animations: unknown[];
}

export interface FrameResult {
  framesDir: string;
  count: number;
  fps: number;
  width: number;
  height: number;
  manifestPath: string;
  characterId: string;
  poseFamilies: string[];
  audio?: FfmpegAudioInput;
  presentation?: VideoOutput;
}

function insideRoot(path: string, root = process.cwd()): string {
  const absolute = resolve(path);
  const diff = relative(resolve(root), absolute);
  if (diff === ".." || diff.startsWith(".." + sep) || isAbsolute(diff)) {
    throw new PreviewUnsupportedError("PATH_OUTSIDE_WORKSPACE", "Path must be inside the project directory: " + absolute);
  }
  return absolute;
}

async function execute(binary: string, args: string[], cwd: string, timeout: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(binary, args, {
      cwd, shell: false, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const err = error as Error & { stderr?: string; stdout?: string };
    throw new PreviewUnsupportedError(
      "DEPENDENCY_EXECUTION_FAILED",
      [err.message, err.stderr, err.stdout].filter(Boolean).join("\n").slice(0, 3500),
    );
  }
}

async function readRig(modelPath: string, scene: Scene): Promise<Rev2DModel> {
  let raw: Rev2DModel;
  try {
    const { size } = await stat(modelPath);
    if (size > 20_000_000) throw new Error("Rev2D rig JSON exceeds 20 MB limit");
    raw = JSON.parse(await readFile(modelPath, "utf8")) as Rev2DModel;
  } catch (error) {
    throw new PreviewUnsupportedError(
      "REV2D_MODEL_MISSING",
      "Cannot read Rev2D rig at " + modelPath + ": " + String(error),
    );
  }
  if (!raw.meta || !Array.isArray(raw.parameters) || !Array.isArray(raw.animations)) {
    throw new PreviewUnsupportedError("REV2D_MODEL_INVALID", "Model is missing required Rev2D data.");
  }
  if (scene.resolution.width !== raw.meta.width || scene.resolution.height !== raw.meta.height) {
    throw new PreviewUnsupportedError(
      "RESOLUTION_UNSUPPORTED",
      "Current render requires native rig resolution " + raw.meta.width + "x" + raw.meta.height + ".",
    );
  }
  return raw;
}

async function loadSpeech(
  scene: Scene,
  sceneFilePath: string,
): Promise<{
  speech?: { cues: ReturnType<typeof parseRhubarbMouthCuesJson>; startMs: number };
  audio?: FfmpegAudioInput;
}> {
  const entry = scene.audio[0];
  if (!entry) return {};
  if (!entry.cuesPath) {
    throw new PreviewUnsupportedError("LIP_CUES_REQUIRED", "Audio entry needs Rhubarb cuesPath JSON.");
  }
  const directory = dirname(resolve(sceneFilePath));
  const source = insideRoot(resolve(directory, entry.path));
  const cuesFile = insideRoot(resolve(directory, entry.cuesPath));

  try {
    const file = await stat(source);
    if (!file.isFile() || file.size < 1) throw new Error("Speech file must be a nonempty file");
    const cues = parseRhubarbMouthCuesJson(await readFile(cuesFile, "utf8"));
    return {
      speech: { cues, startMs: entry.startMs },
      audio: { path: source, startMs: entry.startMs },
    };
  } catch (error) {
    throw new PreviewUnsupportedError("AUDIO_OR_CUES_UNREADABLE", "Audio or cues invalid: " + String(error));
  }
}

function verifyRigTracks(
  model: Rev2DModel,
  tracks: ReturnType<typeof compilePerformance>["tracks"],
): void {
  for (const track of tracks) {
    const parameterId = track.target.slice("param:".length);
    const parameter = model.parameters.find((item) => item.id === parameterId);
    if (!parameter) {
      throw new PreviewUnsupportedError("RIG_PARAMETER_MISSING", "Rig parameter missing: " + parameterId);
    }
    if (track.keys.some((key) => key.v < parameter.min || key.v > parameter.max)) {
      throw new PreviewUnsupportedError(
        "RIG_PARAMETER_OUT_OF_RANGE",
        "Timeline exceeds rig parameter limits for " + parameterId,
      );
    }
  }
}

async function renderRigSegment(input: {
  model: Rev2DModel;
  modelPath: string;
  scene: Scene;
  character: Character;
  actorId: string;
  speech?: { cues: ReturnType<typeof parseRhubarbMouthCuesJson>; startMs: number };
  startFrame: number;
  endFrame: number;
  outputDir: string;
  rev2dRoot: string;
}): Promise<string[]> {
  const { model, modelPath, scene, character, actorId, speech, startFrame, endFrame, outputDir, rev2dRoot } = input;

  // Pose switching is already checked by the frame-accurate timeline planner.
  // Reject non-cut camera effects and captions rather than silently ignoring them.
  const performanceScene: Scene = {
    ...scene,
    events: scene.events.filter((event) =>
      event.kind !== "pose" && !(event.kind === "camera" && event.name === "cut"),
    ),
  };
  const defaults = new Map(model.parameters.map((item) => [item.id, item.default ?? 0]));
  const performance = compilePerformance(performanceScene, character, actorId, defaults, speech);
  verifyRigTracks(model, performance.tracks);

  if (model.animations.some((animation) => (
    !!animation && typeof animation === "object" && "id" in animation && animation.id === performance.id
  ))) {
    throw new PreviewUnsupportedError("RIG_ANIMATION_ID_CONFLICT", "Temporary performance animation conflicts with rig animation ID.");
  }

  const tempModel = join(dirname(modelPath), "puppetcontrol-" + randomUUID() + ".r2d.json");
  const modelWithTimeline = { ...model, animations: [...model.animations, performance] };
  const baseIdle = model.animations.some((item) =>
    !!item && typeof item === "object" && "id" in item && item.id === "idle",
  );

  await mkdir(outputDir, { recursive: true });
  try {
    // The temporary model sits beside the original: relative texture paths stay valid.
    await writeFile(tempModel, JSON.stringify(modelWithTimeline), { encoding: "utf8", flag: "wx" });
    const frameTimes = Array.from({ length: endFrame - startFrame }, (_, i) =>
      Number(((i + startFrame) / scene.fps).toFixed(6)).toString(),
    );
    const args = [
      join(rev2dRoot, "bin", "rev2d.js"),
      "frames",
      tempModel,
      "-o", outputDir,
      "--anim", baseIdle ? "idle" : performance.id,
    ];
    if (baseIdle) args.push("--anim", performance.id);
    args.push("--times", frameTimes.join(","), "--ss", "1", "--json");
    const stdout = await execute(process.execPath, args, rev2dRoot, 240_000);
    const response = JSON.parse(stdout) as { files?: string[]; width?: number; height?: number };
    if (!Array.isArray(response.files) || response.files.length !== frameTimes.length) {
      throw new PreviewUnsupportedError("RENDER_FRAME_COUNT_MISMATCH", "Rig segment rendered wrong number of frames.");
    }
    if (response.width !== scene.resolution.width || response.height !== scene.resolution.height) {
      throw new PreviewUnsupportedError("RENDER_SIZE_MISMATCH", "Rig segment output size does not match scene.");
    }
    return response.files;
  } finally {
    await unlink(tempModel).catch(() => undefined);
  }
}

/**
 * M4 experimental backend:
 * - continuous Rev2D motion inside each pose family;
 * - hard cuts at explicit camera cut boundaries for incompatible poses;
 * - NEVER pretends it has a functional mesh bridge or pose morph.
 * The models must share canvas size and should share visual head identity.
 */
export async function renderRev2DFrames(
  scene: Scene,
  character: Character,
  characterPath: string,
  actorId: string,
  outputDirectory: string,
  sceneFilePath: string,
): Promise<FrameResult> {
  if (!character.render) {
    throw new PreviewUnsupportedError("RIG_REQUIRED", "Character has no rig render configuration.");
  }
  if (scene.actors.length !== 1) {
    throw new PreviewUnsupportedError("MULTI_ACTOR_UNSUPPORTED", "Renderer currently supports one actor.");
  }

  let plan: ReturnType<typeof planPoseTimeline>;
  try {
    plan = planPoseTimeline(scene, character, actorId);
  } catch (error) {
    if (error instanceof PoseTimelineError) {
      throw new PreviewUnsupportedError(error.code, error.message);
    }
    throw error;
  }
  const transitionsNeedingRealAnimation = plan.segments.filter((segment) => segment.kind === "transition");
  if (transitionsNeedingRealAnimation.length) {
    throw new PreviewUnsupportedError(
      "BRIDGE_RENDER_NOT_IMPLEMENTED",
      "A requested pose interpolation/bridge needs a real transition rig or authored clip. Only explicit hard cuts work currently.",
    );
  }
  if (plan.frameCount > 2000) {
    throw new PreviewUnsupportedError("FRAME_LIMIT", "Current renderer supports at most 2000 frames per scene.");
  }

  const rev2dRoot = insideRoot(process.env.PUPPETCONTROL_REV2D_ROOT ?? ".cache/rev2d");
  const framesDir = insideRoot(outputDirectory);
  const { speech, audio } = await loadSpeech(scene, sceneFilePath);
  const familyNames: string[] = [];

  await mkdir(framesDir, { recursive: true });
  let totalCopied = 0;
  for (const [segmentIndex, segment] of plan.segments.entries()) {
    if (segment.kind !== "pose") {
      throw new PreviewUnsupportedError("INTERNAL_POSE_PLAN_ERROR", "Unexpected transition segment.");
    }
    const family = character.poseFamilies.find((pose) => pose.name === segment.pose);
    if (!family || !family.approved) {
      throw new PreviewUnsupportedError("POSE_NOT_APPROVED", "Missing approved pose family: " + segment.pose);
    }
    // Different artwork must use separately declared rig assets; sharing rigId
    // alone does not create a visual pose change.
    const rigFile = family.modelPath ?? character.render.modelPath;
    const modelPath = insideRoot(resolve(dirname(characterPath), rigFile));
    const model = await readRig(modelPath, scene);
    const segmentDir = join(framesDir, "segment_" + String(segmentIndex).padStart(3, "0"));
    const files = await renderRigSegment({
      model, modelPath, scene, character, actorId,
      ...(speech ? { speech } : {}),
      startFrame: segment.startFrame,
      endFrame: segment.endFrame,
      outputDir: segmentDir,
      rev2dRoot,
    });
    for (let local = 0; local < files.length; local++) {
      const source = join(segmentDir, files[local]!);
      const target = join(framesDir, "frame_" + String(segment.startFrame + local).padStart(4, "0") + ".png");
      await copyFile(source, target);
      totalCopied++;
    }
    if (!familyNames.includes(segment.pose)) familyNames.push(segment.pose);
  }

  if (totalCopied !== plan.frameCount) {
    throw new PreviewUnsupportedError("RENDER_FRAME_COUNT_MISMATCH", "Final frame sequence is incomplete.");
  }

  const manifestPath = join(framesDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({
    scene: scene.id,
    character: character.id,
    fps: scene.fps,
    width: scene.resolution.width,
    height: scene.resolution.height,
    frameCount: plan.frameCount,
    poseFamilies: familyNames,
    hardCuts: plan.transitions.filter((item) => item.decision.mode === "cut").map((item) => ({
      frame: item.frame, from: item.decision.from, to: item.decision.to,
    })),
  }, null, 2) + "\n");

  return {
    framesDir,
    count: plan.frameCount,
    fps: scene.fps,
    width: scene.resolution.width,
    height: scene.resolution.height,
    manifestPath,
    characterId: character.id,
    poseFamilies: familyNames,
    ...(audio ? { audio } : {}),
    ...(scene.output ? { presentation: scene.output } : {}),
  };
}

export async function encodeFrames(
  frames: FrameResult,
  out: string,
): Promise<string> {
  const outputFile = insideRoot(out);
  await mkdir(dirname(outputFile), { recursive: true });
  const args = buildFfmpegArgs({
    framesPattern: join(frames.framesDir, "frame_%04d.png"),
    outputPath: outputFile,
    fps: frames.fps,
    frameCount: frames.count,
    ...(frames.audio ? { audio: frames.audio } : {}),
    ...(frames.presentation ? { output: frames.presentation } : {}),
  });
  await execute("ffmpeg", args, process.cwd(), 240_000);
  return outputFile;
}

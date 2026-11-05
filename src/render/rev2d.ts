import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Character, Scene } from "../scene/schemas.js";
import { compilePerformance, PreviewUnsupportedError } from "./scene-plan.js";
import { parseRhubarbMouthCuesJson } from "../audio/rhubarb.js";
import { buildFfmpegArgs, type FfmpegAudioInput } from "../audio/ffmpeg.js";

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
  audio?: FfmpegAudioInput;
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
      cwd, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
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

/**
 * A deliberate M1 implementation:
 * single actor, single pose family, Rev2D animation tracks, no audio/camera
 * composition yet. It is NOT the future multi-pose/video renderer.
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
  const rev2dRoot = insideRoot(process.env.PUPPETCONTROL_REV2D_ROOT ?? ".cache/rev2d");
  const cliFile = join(rev2dRoot, "bin", "rev2d.js");
  const modelPath = insideRoot(resolve(dirname(characterPath), character.render.modelPath));
  const framesDir = insideRoot(outputDirectory);
  let raw: Rev2DModel;

  try {
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
      "M1 preview requires the rig's native resolution " + raw.meta.width + "x" + raw.meta.height + ".",
    );
  }

  const count = Math.ceil(scene.durationMs * scene.fps / 1000);
  if (count > 2000) {
    throw new PreviewUnsupportedError("FRAME_LIMIT", "Rev2D supports at most 2000 frames per batch.");
  }

  const defaults = new Map(raw.parameters.map((item) => [item.id, item.default ?? 0]));
  const audioEntry = scene.audio[0];
  let speech: { cues: ReturnType<typeof parseRhubarbMouthCuesJson>; startMs: number } | undefined;
  let audioInput: FfmpegAudioInput | undefined;
  if (audioEntry) {
    if (!audioEntry.cuesPath) {
      throw new PreviewUnsupportedError("LIP_CUES_REQUIRED", "Audio entry needs a Rhubarb cuesPath (JSON).");
    }
    const sceneDir = dirname(resolve(sceneFilePath));
    const source = insideRoot(resolve(sceneDir, audioEntry.path));
    const cuesFile = insideRoot(resolve(sceneDir, audioEntry.cuesPath));
    try {
      await readFile(source);
      speech = {
        cues: parseRhubarbMouthCuesJson(await readFile(cuesFile, "utf8")),
        startMs: audioEntry.startMs,
      };
      audioInput = { path: source, startMs: audioEntry.startMs };
    } catch (error) {
      throw new PreviewUnsupportedError("AUDIO_OR_CUES_UNREADABLE", "Audio or cues invalid: " + String(error));
    }
  }
  const animation = compilePerformance(scene, character, actorId, defaults, speech);
  for (const track of animation.tracks) {
    const name = track.target.slice("param:".length);
    const parameter = raw.parameters.find((item) => item.id === name);
    if (!parameter) {
      throw new PreviewUnsupportedError("RIG_PARAMETER_MISSING", "Rig parameter missing: " + name);
    }
    if (track.keys.some((key) => key.v < parameter.min || key.v > parameter.max)) {
      throw new PreviewUnsupportedError(
        "RIG_PARAMETER_OUT_OF_RANGE",
        "Timeline would exceed the rig's limits for " + name,
      );
    }
  }

  const unique = "puppetcontrol-" + randomUUID();
  const tempModel = join(dirname(modelPath), unique + ".r2d.json");

  // Keep this file next to the original rig so relative texture paths remain valid.
  // Never modify the source model itself; always clean our unique temporary file.
  const model = { ...raw, animations: [...raw.animations, animation] };
  await mkdir(framesDir, { recursive: true });
  try {
    await writeFile(tempModel, JSON.stringify(model), { encoding: "utf8", flag: "wx" });
    const times = Array.from({ length: count }, (_, frame) => {
      const t = frame / scene.fps;
      return Number(t.toFixed(6)).toString();
    }).join(",");
    const baseIdle = raw.animations.some((item) =>
      !!item && typeof item === "object" && "id" in item && item.id === "idle",
    );

    const args = [
      cliFile, "frames", tempModel, "-o", framesDir,
      "--anim", baseIdle ? "idle" : animation.id,
    ];
    if (baseIdle) args.push("--anim", animation.id);
    args.push("--times", times, "--ss", "1", "--json");

    const stdout = await execute(process.execPath, args, rev2dRoot, 240_000);
    const response = JSON.parse(stdout) as { files?: string[]; width?: number; height?: number };
    if (!Array.isArray(response.files) || response.files.length !== count) {
      throw new PreviewUnsupportedError("RENDER_FRAME_COUNT_MISMATCH", "Expected " + count + " frames.");
    }

    return {
      framesDir,
      count,
      fps: scene.fps,
      width: response.width ?? raw.meta.width,
      height: response.height ?? raw.meta.height,
      manifestPath: join(framesDir, "manifest.json"),
      characterId: character.id,
      ...(audioInput ? { audio: audioInput } : {}),
    };
  } finally {
    await unlink(tempModel).catch(() => undefined);
  }
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
  });
  await execute("ffmpeg", args, process.cwd(), 240_000);
  return outputFile;
}

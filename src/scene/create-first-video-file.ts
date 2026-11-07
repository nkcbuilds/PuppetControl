/**
 * Filesystem boundary for a first video scene: an already-reviewed reusable
 * avatar plus an editable JSON scene. No implicit rig approval or TTS.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { characterSchema } from "./schemas.js";
import { createFirstVideoScene } from "./first-video.js";
import { checkedPath, AvatarWorkflowError } from "../character/avatar.js";
import { checkAvatarPoseCoverage, verifyAvatarBuildRecord } from "../character/provenance.js";
import { parseRhubarbMouthCuesJson } from "../audio/rhubarb.js";

export interface CreateFirstVideoFileOptions {
  outputSceneFile: string;
  characterFile: string;
  id?: string;
  seconds?: number;
  fps?: number;
  voiceFile?: string;
  cuesFile?: string;
  outputSize?: { width: number; height: number };
}

async function nonemptyFile(path: string, label: string, max = 30 * 1024 * 1024) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > max) {
    throw new AvatarWorkflowError("FIRST_VIDEO_INPUT_INVALID", label + " must be a nonempty file under " + max + " bytes.");
  }
}

function relativeForScene(sceneDir: string, target: string): string {
  const value = relative(sceneDir, target).replaceAll("\\", "/");
  return value.startsWith(".") ? value : "./" + value;
}

export async function createFirstVideoFile(
  options: CreateFirstVideoFileOptions, root = process.cwd(),
) {
  const project = resolve(root);
  const outputFile = await checkedPath(project, resolve(project, options.outputSceneFile));
  const characterFile = await checkedPath(project, resolve(project, options.characterFile));
  await nonemptyFile(characterFile, "Character manifest", 2 * 1024 * 1024);
  const character = characterSchema.parse(JSON.parse(await readFile(characterFile, "utf8")) as unknown);
  if (!character.render || character.render.backend !== "rev2d") {
    throw new AvatarWorkflowError("FIRST_VIDEO_RIG_REQUIRED", "Use a real Rev2D character with a configured rig.");
  }
  const defaultPose = character.poseFamilies.find((pose) => pose.name === character.defaultPose);
  if (!defaultPose?.approved) {
    throw new AvatarWorkflowError("FIRST_VIDEO_NOT_REVIEWED",
      "This actor is not approved. Inspect review/poses.png, turn.png, eyes.png and mouth.png; explicitly approve the rig only after actual visual review.");
  }
  const coverage = checkAvatarPoseCoverage(character);
  if (!coverage.valid) throw new AvatarWorkflowError(coverage.code, coverage.message);
  if (character.provenance) {
    const integrity = await verifyAvatarBuildRecord(characterFile, character.render.modelPath);
    if (!integrity.valid) throw new AvatarWorkflowError(integrity.code, integrity.message);
  }
  const characterDir = dirname(characterFile);
  const modelPath = await checkedPath(character.provenance ? characterDir : project,
    resolve(characterDir, character.render.modelPath));
  await nonemptyFile(modelPath, "Rig model", 20 * 1024 * 1024);
  const model = JSON.parse(await readFile(modelPath, "utf8")) as {
    meta?: { width?: number; height?: number };
  };
  const width = model.meta?.width;
  const height = model.meta?.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width! < 160 || height! < 160 || width! > 4096 || height! > 4096) {
    throw new AvatarWorkflowError("FIRST_VIDEO_RIG_INVALID", "Rig metadata needs valid native canvas dimensions.");
  }
  const durationMs = Math.round((options.seconds ?? 12) * 1000);
  const fps = options.fps ?? 24;
  if (!Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 60_000 ||
      !Number.isSafeInteger(fps) || fps < 1 || fps > 60) {
    throw new AvatarWorkflowError("FIRST_VIDEO_TIMING_INVALID",
      "Use a scene duration of 1–60 seconds and an integer FPS of 1–60.");
  }
  const outputDir = dirname(outputFile);
  let audio: { path: string; cuesPath: string; startMs: number } | undefined;
  if (Boolean(options.voiceFile) !== Boolean(options.cuesFile)) {
    throw new AvatarWorkflowError("FIRST_VIDEO_VOICE_CUES_REQUIRED",
      "Voice requires a Rhubarb cues JSON file; generate it first with puppetctl audio align. No simulated lip sync.");
  }
  if (options.voiceFile && options.cuesFile) {
    const wav = await checkedPath(project, resolve(project, options.voiceFile));
    const cues = await checkedPath(project, resolve(project, options.cuesFile));
    await Promise.all([nonemptyFile(wav, "Voice audio", 200 * 1024 * 1024),
      nonemptyFile(cues, "Rhubarb cues", 5 * 1024 * 1024)]);
    try {
      parseRhubarbMouthCuesJson(await readFile(cues, "utf8"));
    } catch (error) {
      throw new AvatarWorkflowError("FIRST_VIDEO_LIP_CUES_INVALID",
        "Rhubarb cue file is invalid: " + (error instanceof Error ? error.message : String(error)));
    }
    audio = { path: relativeForScene(outputDir, wav), cuesPath: relativeForScene(outputDir, cues), startMs: 0 };
  }
  const scene = createFirstVideoScene(character, {
    id: options.id ?? basename(outputFile, extname(outputFile)).replace(/[^A-Za-z0-9_-]/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 100),
    actorId: character.id,
    characterPath: relativeForScene(outputDir, characterFile),
    durationMs,
    fps,
    resolution: { width: width!, height: height! },
    ...(options.outputSize ? {
      output: { ...options.outputSize, background: "#f0eaf4" },
    } : {}),
    ...(audio ? { audio } : {}),
  });
  await mkdir(outputDir, { recursive: true });
  // Never overwrite previous edits or a prior scene, even on a retry.
  await writeFile(outputFile, JSON.stringify(scene, null, 2) + "\n", { flag: "wx" });
  return {
    valid: true, status: "editable-scene-created", scene: scene.id, outputFile,
    character: character.id, rig: modelPath, reusedExistingRig: true,
    hasVoice: Boolean(audio), durationMs: scene.durationMs, fps: scene.fps,
    next: "Edit the scene's supported events, then run scene validate and scene render. The existing approved character and its art are reused unchanged.",
  };
}

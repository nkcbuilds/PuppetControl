/**
 * A small, honest scene composer for one existing reviewed character rig.
 * It never infers landmarks, draws missing poses, synthesizes speech or
 * approves artwork. Output remains an editable, strict scene JSON document.
 */
import {
  characterSchema, sceneSchema, type Character, type Scene, type SceneEvent,
} from "./schemas.js";
import { validateSceneCapabilities } from "./validate.js";

export interface FirstVideoOptions {
  id: string;
  actorId: string;
  characterPath: string;
  durationMs: number;
  fps: number;
  resolution: { width: number; height: number };
  output?: { width: number; height: number; background: string };
  audio?: { path: string; cuesPath: string; bindingPath?: string; startMs: number };
  /** Supported semantic events in millisecond timestamps. */
  events?: SceneEvent[];
}

export class FirstVideoSceneError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "FirstVideoSceneError";
  }
}

/** Choose only capabilities that the current character genuinely declares. */
function gentleDefaultEvents(character: Character, actor: string, ms: number): SceneEvent[] {
  const expression = character.expressions.find(
    (name) => name !== "neutral" && character.render?.expressionPresets[name] !== undefined,
  );
  const result: SceneEvent[] = [{
    atMs: 0, actor, kind: "pose", name: character.defaultPose, transition: "auto",
  }];
  if (ms >= 2_000) {
    result.push({
      atMs: Math.min(ms - 1, Math.round(ms * 0.17)),
      actor, kind: "look", x: 0.22, y: -0.08, durationMs: 450,
    });
  }
  if (expression && ms >= 3_000) {
    result.push({
      atMs: Math.min(ms - 1, Math.round(ms * 0.34)),
      actor, kind: "expression", name: expression, intensity: 0.65,
    });
  }
  if (ms >= 4_000) {
    result.push({
      atMs: Math.min(ms - 1, Math.round(ms * 0.61)),
      actor, kind: "look", x: -0.2, y: 0.06, durationMs: 500,
    });
  }
  if (expression && character.expressions.includes("neutral") &&
      character.render?.expressionPresets.neutral !== undefined && ms >= 5_000) {
    result.push({
      atMs: Math.min(ms - 1, Math.round(ms * 0.82)),
      actor, kind: "expression", name: "neutral", intensity: 1,
    });
  }
  return result;
}

/** Validates both scene schema and semantic capabilities before returning. */
export function createFirstVideoScene(characterInput: Character, options: FirstVideoOptions): Scene {
  const validCharacter = characterSchema.safeParse(characterInput);
  if (!validCharacter.success) {
    throw new FirstVideoSceneError("FIRST_VIDEO_CHARACTER_INVALID",
      "Supply a valid character manifest with real declared rig capabilities.");
  }
  const character = validCharacter.data;
  if (!character.render || character.render.backend !== "rev2d") {
    throw new FirstVideoSceneError("FIRST_VIDEO_RIG_REQUIRED", "The character must have a real Rev2D rig.");
  }
  if (!character.poseFamilies.find((p) => p.name === character.defaultPose)?.approved) {
    throw new FirstVideoSceneError("FIRST_VIDEO_NOT_REVIEWED",
      "Review the actual character pose sheets and explicitly approve its default pose first.");
  }
  if (!Number.isSafeInteger(options.durationMs) || options.durationMs < 1_000 ||
      options.durationMs > 60_000 || !Number.isSafeInteger(options.fps) ||
      options.fps < 1 || options.fps > 60) {
    throw new FirstVideoSceneError("FIRST_VIDEO_TIMING_INVALID",
      "Use a duration from 1 to 60 seconds and an integer FPS between 1 and 60.");
  }
  const events = options.events ?? gentleDefaultEvents(character, options.actorId, options.durationMs);
  // A first-video MVP cannot claim captions, animated motions or bridge clips
  // that its current renderer does not implement.
  if (events.some((event) => event.kind === "caption" || event.kind === "motion" ||
      event.kind === "camera" || (event.kind === "pose" &&
        (event.name !== character.defaultPose || event.transition === "bridge")))) {
    throw new FirstVideoSceneError("FIRST_VIDEO_EVENT_UNSUPPORTED",
      "First-video scenes support only the reviewed neutral pose, gaze and supported expressions. Other poses, camera edits and captions require separate explicit authoring.");
  }
  const parsed = sceneSchema.safeParse({
    schemaVersion: 1, id: options.id, durationMs: options.durationMs,
    fps: options.fps, resolution: options.resolution,
    ...(options.output ? { output: options.output } : {}),
    actors: [{ id: options.actorId, characterPath: options.characterPath }],
    audio: options.audio
      ? [{ ...options.audio, actor: options.actorId }]
      : [],
    allowCameraCuts: false, events,
  });
  if (!parsed.success) {
    throw new FirstVideoSceneError("FIRST_VIDEO_SCENE_INVALID",
      "Scene is invalid: " + parsed.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message).join("; "));
  }
  const validated = validateSceneCapabilities(parsed.data, new Map([[options.actorId, character]]));
  if (!validated.valid) {
    throw new FirstVideoSceneError("FIRST_VIDEO_CAPABILITY_MISMATCH",
      validated.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.code + ": " + diagnostic.message).join("; "));
  }
  if (options.audio && !options.audio.cuesPath) {
    throw new FirstVideoSceneError("FIRST_VIDEO_VOICE_CUES_REQUIRED",
      "Precomputed Rhubarb audio cues are required before attaching speech.");
  }
  return parsed.data;
}

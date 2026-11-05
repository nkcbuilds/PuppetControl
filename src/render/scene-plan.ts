import type { Character, Scene, SceneEvent } from "../scene/schemas.js";
import type { RhubarbMouthCue } from "../audio/rhubarb.js";
import { mapRhubarbCuesToRev2DVisemes } from "../audio/visemes.js";

export interface AnimationKey {
  t: number;
  v: number;
  ease?: "inOutSine";
}

export interface AnimationTrack {
  target: string;
  keys: AnimationKey[];
}

export interface PerformanceAnimation {
  id: string;
  duration: number;
  loop: false;
  tracks: AnimationTrack[];
}

export class PreviewUnsupportedError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PreviewUnsupportedError";
  }
}

type ExpressionEvent = Extract<SceneEvent, { kind: "expression" }>;
type LookEvent = Extract<SceneEvent, { kind: "look" }>;

const HEAD_YAW_LIMIT = 22;
const HEAD_PITCH_LIMIT = 12;

/** Piecewise linear evaluation is only used when selecting a new animation endpoint. */
function valueAt(keys: AnimationKey[], timestamp: number): number {
  const first = keys[0];
  if (!first) return 0;
  if (timestamp <= first.t) return first.v;
  for (let index = 1; index < keys.length; index++) {
    const end = keys[index];
    const start = keys[index - 1];
    if (!start || !end) break;
    if (timestamp <= end.t) {
      const delta = end.t - start.t;
      if (delta === 0) return end.v;
      return start.v + ((timestamp - start.t) / delta) * (end.v - start.v);
    }
  }
  return keys[keys.length - 1]?.v ?? 0;
}

/** All incoming events are time ordered and each channel is eased, not snapped. */
function insertEase(
  tracks: Map<string, AnimationKey[]>,
  parameter: string,
  beginSeconds: number,
  endSeconds: number,
  goal: number,
  defaultValue = 0,
): void {
  const prior = tracks.get(parameter) ?? [{ t: 0, v: defaultValue }];
  const current = valueAt(prior, beginSeconds);
  // The next command supersedes a pending transition on this same channel.
  const keys = prior.filter((key) => key.t < beginSeconds);
  keys.push({ t: beginSeconds, v: current, ease: "inOutSine" });
  if (endSeconds > beginSeconds) keys.push({ t: endSeconds, v: goal });
  else keys[keys.length - 1] = { t: beginSeconds, v: goal };
  tracks.set(parameter, keys);
}

/**
 * Compile one already-rigged actor into a renderable Rev2D animation.
 * This deliberately rejects multi-pose and editing features that our renderer
 * cannot visually perform yet, even if scene capability metadata validates.
 */
export function compilePerformance(
  scene: Scene,
  character: Character,
  actorId: string,
  rigDefaults: ReadonlyMap<string, number>,
  speech?: { cues: readonly RhubarbMouthCue[]; startMs: number },
  options: { allowExternalPoseFamilies?: boolean; currentModelPath?: string } = {},
): PerformanceAnimation {
  if (!character.render || character.render.backend !== "rev2d") {
    throw new PreviewUnsupportedError("RIG_REQUIRED", "Character has no configured Rev2D rig.");
  }
  if (scene.actors.length !== 1) {
    throw new PreviewUnsupportedError("MULTI_ACTOR_UNSUPPORTED", "Preview currently supports one actor.");
  }
  if (scene.audio.length > 0 && !speech) {
    throw new PreviewUnsupportedError("LIP_CUES_REQUIRED", "Audio needs validated Rhubarb mouth cues before rendering.");
  }
  const tracks = new Map<string, AnimationKey[]>();
  const durationSeconds = scene.durationMs / 1000;

  const events = scene.events.map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.atMs - b.event.atMs || a.index - b.index);

  for (const { event } of events) {
    if (event.kind === "pose") {
      const family = character.poseFamilies.find((pose) => pose.name === event.name);
      const familyModel = family?.modelPath ?? character.render.modelPath;
      if (options.allowExternalPoseFamilies && options.currentModelPath && familyModel !== options.currentModelPath) {
        continue;
      }
      const poses = character.render.posePresets;
      const mapping = poses?.[event.name];
      if (mapping) {
        const start = event.atMs / 1000;
        // Same-rig transitions are 300ms in the validated pose resolver.
        const duration = event.transition === "cut" ? 0 : 300;
        const end = Math.min(durationSeconds, (event.atMs + duration) / 1000);
        for (const [parameter, goal] of Object.entries(mapping)) {
          if (!rigDefaults.has(parameter)) {
            throw new PreviewUnsupportedError("RIG_PARAMETER_MISSING", "Pose control not in rig: " + parameter);
          }
          insertEase(tracks, parameter, start, end, goal, rigDefaults.get(parameter));
        }
      } else if (!options.allowExternalPoseFamilies && event.name !== character.defaultPose) {
        throw new PreviewUnsupportedError(
          "POSE_RENDER_NOT_IMPLEMENTED",
          "Pose '" + event.name + "' requires a validated rig/transition renderer; not supported in this rig.",
        );
      }
      continue;
    }
    if (event.kind === "camera") {
      // Camera is composed by the video exporter, not by the character rig.
      continue;
    }
    if (event.kind === "caption") {
      throw new PreviewUnsupportedError(
        "COMPOSITION_NOT_IMPLEMENTED",
        "Caption rendering is not implemented yet.",
      );
    }
    if (event.actor !== actorId) continue;

    if (event.kind === "expression") {
      const presets = character.render.expressionPresets;
      const base = presets.neutral ?? {};
      const requested = presets[event.name];
      if (!requested) {
        throw new PreviewUnsupportedError(
          "EXPRESSION_PRESET_NOT_DEFINED",
          "The rig has no parameter mapping for expression '" + event.name + "'.",
        );
      }
      const names = new Set([...Object.keys(base), ...Object.keys(requested)]);
      for (const parameter of names) {
        if (!rigDefaults.has(parameter)) {
          throw new PreviewUnsupportedError("RIG_PARAMETER_MISSING", "Unknown rig parameter: " + parameter);
        }
        const neutral = base[parameter] ?? rigDefaults.get(parameter) ?? 0;
        const expressive = requested[parameter] ?? neutral;
        const goal = neutral + (expressive - neutral) * (event.intensity ?? 1);
        const start = event.atMs / 1000;
        const end = Math.min(durationSeconds, (event.atMs + 280) / 1000);
        insertEase(tracks, parameter, start, end, goal, rigDefaults.get(parameter));
      }
      continue;
    }

    if (event.kind === "look") {
      const start = event.atMs / 1000;
      const end = Math.min(durationSeconds, (event.atMs + event.durationMs) / 1000);
      const mappings = {
        AngleX: event.x * HEAD_YAW_LIMIT,
        AngleY: -event.y * HEAD_PITCH_LIMIT,
        EyeBallX: event.x * 0.5,
        EyeBallY: event.y * 0.5,
      };
      for (const [parameter, goal] of Object.entries(mappings)) {
        if (!rigDefaults.has(parameter)) {
          throw new PreviewUnsupportedError("RIG_PARAMETER_MISSING", "Unknown rig parameter: " + parameter);
        }
        insertEase(tracks, parameter, start, end, goal, rigDefaults.get(parameter));
      }
      continue;
    }

    if (event.kind === "motion") {
      // We cannot truthfully promise a physical nod/gesture without first
      // compiling a semantic motion to a supported engine clip.
      throw new PreviewUnsupportedError("MOTION_NOT_IMPLEMENTED", "Rig motion events are not yet mapped.");
    }
  }

  if (speech) {
    if (scene.audio.length !== 1) {
      throw new PreviewUnsupportedError("AUDIO_TRACK_INVALID", "Only one audio track is supported.");
    }
    const audio = scene.audio[0];
    if (audio?.actor && audio.actor !== actorId) {
      throw new PreviewUnsupportedError("AUDIO_ACTOR_MISMATCH", "Audio is assigned to a different actor.");
    }
    const shifted = speech.cues.map((cue) => ({
      ...cue,
      start: cue.start + speech.startMs / 1000,
      end: cue.end + speech.startMs / 1000,
    }));
    const curves = mapRhubarbCuesToRev2DVisemes(shifted, durationSeconds);
    // Speech owns the animated mouth; brows/cheeks from expression remain intact.
    for (const track of curves.tracks) {
      const id = track.target.slice("param:".length);
      if (!rigDefaults.has(id)) {
        throw new PreviewUnsupportedError("RIG_PARAMETER_MISSING", "Rig lacks required mouth control: " + id);
      }
      tracks.set(id, track.keys);
    }
  }

  for (const keys of tracks.values()) {
    if (!keys.length) throw new Error("Performance track unexpectedly empty");
    // Rev2D holds the final value for the remainder of the scene.
    const last = keys[keys.length - 1];
    if (last && last.t < durationSeconds) keys.push({ t: durationSeconds, v: last.v });
  }

  return {
    id: "puppetcontrol_performance",
    duration: durationSeconds,
    loop: false,
    tracks: [...tracks].map(([parameter, keys]) => ({ target: "param:" + parameter, keys })),
  };
}

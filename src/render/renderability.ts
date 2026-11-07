/**
 * Renderability preflight is deliberately separate from the wider scene
 * capability validator: a scene may be a legal planning document but still
 * request features the current MP4 renderer does not implement.
 */
import { planPoseTimeline, PoseTimelineError } from "../animation/pose-timeline.js";
import type { Character, Scene } from "../scene/schemas.js";

export interface RenderabilityIssue {
  severity: "error";
  code: string;
  path: string;
  message: string;
}

export function checkSceneRenderability(
  scene: Scene,
  characters: ReadonlyMap<string, Character>,
): { valid: boolean; diagnostics: RenderabilityIssue[] } {
  const diagnostics: RenderabilityIssue[] = [];
  const error = (code: string, path: string, message: string) =>
    diagnostics.push({ severity: "error", code, path, message });

  if (scene.actors.length !== 1) {
    error("MULTI_ACTOR_UNSUPPORTED", "actors",
      "MP4 rendering currently supports exactly one actor; multi-actor scenes can be planned but not rendered.");
  }
  for (const [index, audio] of scene.audio.entries()) {
    if (!audio.cuesPath) {
      error("LIP_CUES_REQUIRED", "audio." + index + ".cuesPath",
        "Voice rendering requires validated Rhubarb cues. Generate them with audio align before rendering.");
    }
  }
  for (const [index, event] of scene.events.entries()) {
    if (event.kind === "caption") {
      error("COMPOSITION_NOT_IMPLEMENTED", "events." + index,
        "Caption composition is not implemented in the MP4 renderer.");
    } else if (event.kind === "motion") {
      error("MOTION_NOT_IMPLEMENTED", "events." + index,
        "Semantic motion events cannot be rendered yet; use a supported rig pose control instead.");
    }
  }
  if (scene.actors.length === 1) {
    const actor = scene.actors[0]!;
    const character = characters.get(actor.id);
    if (!character) {
      error("ACTOR_NOT_LOADED", "actors.0", "Actor manifest has not been loaded.");
    } else {
      try {
        const timeline = planPoseTimeline(scene, character, actor.id);
        for (const [index, segment] of timeline.segments.entries()) {
          if (segment.kind === "transition" && segment.mode === "bridge") {
            error("BRIDGE_RENDER_NOT_IMPLEMENTED", "timeline.segments." + index,
              "A planned authored between-rig bridge has no render implementation. Use a supported rig interpolation or explicit camera cut.");
          }
        }
      } catch (cause) {
        error(cause instanceof PoseTimelineError ? cause.code : "POSE_PLAN_UNSUPPORTED",
          "events", cause instanceof Error ? cause.message : String(cause));
      }
    }
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

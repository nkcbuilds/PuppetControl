import type { Character, Scene } from "./schemas.js";
import { resolveTransition } from "../animation/transitions.js";

export interface Diagnostic {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface SceneValidation {
  valid: boolean;
  diagnostics: Diagnostic[];
  transitions: ReturnType<typeof resolveTransition>[];
}

export function validateSceneCapabilities(
  scene: Scene,
  characters: ReadonlyMap<string, Character>,
): SceneValidation {
  const diagnostics: Diagnostic[] = [];
  const transitions: ReturnType<typeof resolveTransition>[] = [];
  const actorIds = new Set(scene.actors.map((actor) => actor.id));
  const poseByActor = new Map<string, string>();

  for (const entry of scene.actors) {
    const character = characters.get(entry.id);
    if (!character) {
      diagnostics.push({
        severity: "error", code: "ACTOR_NOT_LOADED", path: "actors." + entry.id,
        message: "Character manifest not loaded for actor " + entry.id,
      });
    } else {
      poseByActor.set(entry.id, character.defaultPose);
      const def = character.poseFamilies.find((pose) => pose.name === character.defaultPose);
      if (!def?.approved) {
        diagnostics.push({
          severity: "error", code: "DEFAULT_POSE_NOT_APPROVED", path: "actors." + entry.id,
          message: "Default pose is not approved for use",
        });
      }
    }
  }

  const chronological = scene.events.map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.atMs - b.event.atMs || a.index - b.index);

  for (const { event, index } of chronological) {
    const path = "events." + index;
    if (event.kind === "camera" || event.kind === "caption") continue;

    if (!actorIds.has(event.actor)) {
      diagnostics.push({
        severity: "error", code: "UNKNOWN_ACTOR", path,
        message: "Event refers to unknown actor " + event.actor,
      });
      continue;
    }

    const character = characters.get(event.actor);
    if (!character) continue;

    if (event.kind === "pose") {
      const next = character.poseFamilies.find((pose) => pose.name === event.name);
      if (!next) {
        diagnostics.push({
          severity: "error", code: "UNSUPPORTED_POSE", path,
          message: "Pose " + event.name + " is not supported by " + character.id,
        });
        continue;
      }
      if (!next.approved) {
        diagnostics.push({
          severity: "error", code: "POSE_NOT_APPROVED", path,
          message: "Pose " + event.name + " is not approved for rendering",
        });
        continue;
      }

      const previous = poseByActor.get(event.actor) ?? character.defaultPose;
      const cutAtBoundary = scene.allowCameraCuts && scene.events.some((candidate) =>
        candidate.kind === "camera" && candidate.name === "cut" && candidate.atMs === event.atMs
      );
      const decision = resolveTransition(character, previous, event.name, {
        requested: event.transition,
        allowCameraCut: cutAtBoundary,
      });
      transitions.push(decision);

      if (decision.mode === "unsupported") {
        diagnostics.push({
          severity: "error", code: "TRANSITION_UNSUPPORTED", path,
          message: previous + " -> " + event.name + ": " + decision.reason,
        });
        continue;
      }
      if (decision.mode === "interpolate" && previous !== event.name && character.render) {
        const prior = character.poseFamilies.find((pose) => pose.name === previous);
        const previousModel = prior?.modelPath ?? character.render.modelPath;
        const nextModel = next.modelPath ?? character.render.modelPath;
        if (prior?.rigId === next.rigId && previousModel === nextModel &&
          (!character.render.posePresets?.[previous] || !character.render.posePresets?.[event.name])) {
          diagnostics.push({
            severity: "error", code: "POSE_PRESET_MISSING", path,
            message: "Compatible pose interpolation requires numeric presets for both " + previous + " and " + event.name,
          });
          continue;
        }
      }
      if (decision.mode === "cut") {
        diagnostics.push({
          severity: "warning", code: "CUT_REQUIRED", path,
          message: "An intentional shot cut is required between " + previous + " and " + event.name,
        });
      }
      poseByActor.set(event.actor, event.name);
    } else if (event.kind === "expression" && !character.expressions.includes(event.name)) {
      diagnostics.push({
        severity: "error", code: "UNSUPPORTED_EXPRESSION", path,
        message: "Expression " + event.name + " is not supported by " + character.id,
      });
    } else if (event.kind === "motion" && !character.motions.includes(event.name)) {
      diagnostics.push({
        severity: "error", code: "UNSUPPORTED_MOTION", path,
        message: "Motion " + event.name + " is not supported by " + character.id,
      });
    }
  }

  return {
    valid: !diagnostics.some((item) => item.severity === "error"),
    diagnostics,
    transitions,
  };
}

import type { Character } from "../scene/schemas.js";

export type TransitionMode = "interpolate" | "bridge" | "cut" | "unsupported";

export interface TransitionDecision {
  mode: TransitionMode;
  from: string;
  to: string;
  durationMs: number;
  clip?: string;
  reason: string;
}

export interface TransitionOptions {
  allowCameraCut?: boolean;
  requested?: "auto" | "interpolate" | "bridge" | "cut";
}

/**
 * Pure policy function. Never morph unrelated topologies or fake compatibility
 * with an alpha crossfade. A "cut" is explicitly marked for camera handling.
 */
export function resolveTransition(
  character: Character,
  from: string,
  to: string,
  options: TransitionOptions = {},
): TransitionDecision {
  const unsupported = (reason: string): TransitionDecision => ({
    mode: "unsupported", from, to, durationMs: 0, reason,
  });

  const initial = character.poseFamilies.find((pose) => pose.name === from);
  const target = character.poseFamilies.find((pose) => pose.name === to);
  if (!initial || !target) return unsupported("Pose family not found");
  if (!initial.approved || !target.approved) return unsupported("Pose family not approved");

  if (from === to) {
    return { mode: "interpolate", from, to, durationMs: 0, reason: "Same pose family" };
  }

  const requested = options.requested ?? "auto";
  const sameRig = initial.rigId === target.rigId && initial.head === target.head;
  if (sameRig && (requested === "auto" || requested === "interpolate")) {
    return { mode: "interpolate", from, to, durationMs: 300, reason: "Compatible rig" };
  }

  const authored = character.transitions.find((item) => item.from === from && item.to === to);
  if (authored?.kind === "bridge" && (requested === "auto" || requested === "bridge")) {
    return {
      mode: "bridge", from, to, durationMs: authored.durationMs,
      clip: authored.clip, reason: "Authored transition clip",
    };
  }

  // Declaring a cut transition isn't enough: the scene must have a real cut at this timestamp.
  if (options.allowCameraCut === true && (requested === "auto" || requested === "cut")) {
    return { mode: "cut", from, to, durationMs: 0, reason: "Intentional camera cut required" };
  }

  return unsupported("Incompatible poses without an authored bridge or permitted camera cut");
}

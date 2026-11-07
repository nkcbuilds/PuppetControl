/**
 * Optional ANIME-STYLE STEPPED transition for an imported Rev2D avatar whose
 * half/closed eye sprites were separately drawn and visually reviewed.
 *
 * Root cause: fading complete eye pictures over the open-eye mesh creates
 * visible double lashes and translucent irises when their contours differ.
 * This profile selects exactly one of open mesh / half sprite / closed sprite
 * at each normal sampled EyeOpen state. It sacrifices continuous blending:
 * transitions can visibly pop. This is an experimental mitigation, not a
 * claim of seamless or universally good blinking.
 *
 * The caller must revoke prior pose approval, regenerate review sheets, and
 * record fresh source/rig/texture fingerprints before any reuse.
 */
import { shortFadeDrawnEyes } from "./eye-short-fade.js";

type Key = { at: number[]; value: number };
type Binding = {
  id: string;
  target: string;
  params: string[];
  keys: Key[];
};

export const STEPPED_EYE_PROFILE = {
  closedToHalf: 0.195,
  halfToMesh: 0.69,
  /** Tiny finite transition required by Rev2D (duplicate key positions unsupported). */
  stepWidth: 0.0001,
  note: "One state visible per sampled control value; sharp switching may pop.",
} as const;

const keys = (values: readonly (readonly [number, number])[]): Key[] =>
  values.map(([at, value]) => ({ at: [at], value }));

function switchOn(threshold: number, width: number): Key[] {
  return keys([[0, 0], [threshold - width, 0], [threshold, 1], [1, 1]]);
}

function switchOff(threshold: number, width: number): Key[] {
  return keys([[0, 1], [threshold - width, 1], [threshold, 0], [1, 0]]);
}

/**
 * Pure full-model transform. Reuses all of the short-fade topology checks,
 * including both sides, correct param mapping and hide controls. No artwork
 * or non-eye binding changes.
 */
export function steppedDrawnEyes(input: unknown): {
  model: Record<string, unknown>;
  changedBindings: string[];
  profile: typeof STEPPED_EYE_PROFILE;
} {
  // Validation of supported geometry/topology, not a visual acceptance.
  const validated = shortFadeDrawnEyes(input);
  const model = validated.model;
  const bindings = model.bindings as Binding[];
  const { closedToHalf: c, halfToMesh: h, stepWidth: w } = STEPPED_EYE_PROFILE;
  const changed: string[] = [];

  for (const binding of bindings) {
    const id = binding.id;
    if (id.startsWith("sprite_eyes_closed_") && id.endsWith("Show")) {
      binding.keys = switchOff(c, w);
    } else if (id.startsWith("sprite_eyes_half_") && id.endsWith("Show")) {
      binding.keys = keys([[0, 0], [c - w, 0], [c, 1], [h - w, 1], [h, 0], [1, 0]]);
    } else if (validated.changedBindings.includes(id) && id.endsWith("UnderSprite")) {
      binding.keys = switchOn(h, w);
    } else {
      continue;
    }
    changed.push(id);
  }
  if (changed.length !== validated.changedBindings.length) {
    // The topology validator currently checks these. Keep this additional
    // fail-closed check should the pinned Rev2D schema ever change.
    throw new Error("Eye sprite topology changed; not all opacity bindings were transformed.");
  }
  return { model, changedBindings: changed, profile: STEPPED_EYE_PROFILE };
}

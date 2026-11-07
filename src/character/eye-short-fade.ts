/**
 * Experimental short-fade profile for Rev2D's *drawn* half/closed eye sprites.
 *
 * The upstream engine linearly dissolves two complete eye illustrations across
 * EyeOpen 0.12–0.2 and 0.6–0.7. Double lash lines become visible when their
 * geometry differs. Narrowing the opacity windows reduces how long both drawings
 * overlap, but deliberately trades smoothness for crispness.
 *
 * Never apply to a source or approved model in place. Callers must revoke visual
 * approval, validate the derived model and regenerate review images and hashes.
 */
import { AvatarWorkflowError } from "./avatar.js";

type JsonRecord = Record<string, unknown>;
type Rev2DBinding = {
  id: string;
  target: string;
  params: string[];
  keys: Array<{ at: number[]; value: number }>;
};

export const SHORT_FADE_EYE_PROFILE = {
  /** Fade from closed to half across this EyeOpen range. */
  closedToHalf: [0.18, 0.20],
  /** Fade from half to mesh across this EyeOpen range. */
  halfToMesh: [0.68, 0.70],
} as const;

export interface ShortFadeResult {
  /** A NEW model object. Caller owns its publication and renewed review. */
  model: JsonRecord;
  changedBindings: string[];
  profile: typeof SHORT_FADE_EYE_PROFILE;
}

function unsupported(why: string): never {
  throw new AvatarWorkflowError(
    "EYE_SHORT_FADE_UNSUPPORTED",
    "Cannot safely apply the optional short-fade policy: " + why +
      ". Leave the upstream rig unchanged and inspect its review sheets.",
  );
}

function isBinding(input: unknown): input is Rev2DBinding {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const b = input as Partial<Rev2DBinding>;
  return typeof b.id === "string" &&
    typeof b.target === "string" &&
    Array.isArray(b.params) && b.params.every((p) => typeof p === "string") &&
    Array.isArray(b.keys) && b.keys.length >= 2 && b.keys.every(
      (key) => key && Array.isArray(key.at) && key.at.length === 1 &&
        typeof key.at[0] === "number" && Number.isFinite(key.at[0]) &&
        typeof key.value === "number" && Number.isFinite(key.value),
    );
}

function points(entries: Array<readonly [number, number]>): Rev2DBinding["keys"] {
  return entries.map(([at, value]) => ({ at: [at], value }));
}

const expectedSprites = [
  ["sprite_eyes_closed_imageLeftShow", "EyeROpen"],
  ["sprite_eyes_closed_imageRightShow", "EyeLOpen"],
  ["sprite_eyes_half_imageLeftShow", "EyeROpen"],
  ["sprite_eyes_half_imageRightShow", "EyeLOpen"],
] as const;

function expectedParam(id: string): string | null {
  if (id.includes("imageLeft") || id.startsWith("eyeR_")) return "EyeROpen";
  if (id.includes("imageRight") || id.startsWith("eyeL_")) return "EyeLOpen";
  return null;
}

/** Pure transform, only on the known, fully supported two-eye sprite topology. */
export function shortFadeDrawnEyes(input: unknown): ShortFadeResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) unsupported("invalid model JSON");
  const candidate = structuredClone(input) as JsonRecord;
  const bindings = candidate.bindings;
  if (!Array.isArray(bindings)) unsupported("missing bindings");
  // Other Rev2D bindings may control multi-parameter warps and structured
  // vertex offsets rather than scalar opacity; preserve them untouched.
  const eyeBindings: Rev2DBinding[] = [];
  const byId = new Map<string, Rev2DBinding>();
  for (const value of bindings) {
    if (!value || typeof value !== "object") continue;
    const id = (value as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    if (byId.has(id)) unsupported("duplicate binding " + id);
    if (!isBinding(value)) {
      if (id.startsWith("sprite_eyes_") || id.endsWith("UnderSprite")) unsupported("unsupported eye binding " + id);
      continue;
    }
    byId.set(id, value);
    eyeBindings.push(value);
  }
  if ([...byId.keys()].some((id) => id.startsWith("sprite_eyes_smile_"))) {
    unsupported("the separate eyes_smile layering has not been checked with this profile");
  }
  for (const [id, param] of expectedSprites) {
    const binding = byId.get(id);
    const partId = id.slice(0, -"Show".length);
    if (!binding || binding.target !== "part:" + partId + ".opacity" ||
        binding.params.length !== 1 || binding.params[0] !== param) {
      unsupported("missing or incompatible " + id + "; both reviewed half/closed variants are required");
    }
  }
  const underneath = eyeBindings.filter((b) =>
    /^eye[LR]_(?:white|ball|lower|upper|lowerRim|crease|upperRim)UnderSprite$/.test(b.id));
  for (const side of ["eyeL_", "eyeR_"]) {
    if (underneath.filter((b) => b.id.startsWith(side)).length < 4) {
      unsupported("incomplete eye-mesh hide controls for " + side);
    }
  }
  for (const b of underneath) {
    const param = expectedParam(b.id);
    if (!param || b.params.length !== 1 || b.params[0] !== param ||
        b.target !== "part:" + b.id.slice(0, -"UnderSprite".length) + ".opacity") {
      unsupported("incompatible eye mesh opacity control " + b.id);
    }
    const hidden = b.keys[0]!.value;
    const visible = b.keys[b.keys.length - 1]!.value;
    if (Math.abs(hidden) > 1e-5 || Math.abs(visible - 1) > 1e-5) {
      unsupported("nonstandard eye mesh opacity limits for " + b.id);
    }
  }

  const [closedStart, closedEnd] = SHORT_FADE_EYE_PROFILE.closedToHalf;
  const [openStart, openEnd] = SHORT_FADE_EYE_PROFILE.halfToMesh;
  const changed: string[] = [];
  for (const b of eyeBindings) {
    if (b.id.startsWith("sprite_eyes_closed_") && b.id.endsWith("Show")) {
      b.keys = points([[0, 1], [closedStart, 1], [closedEnd, 0], [1, 0]]);
    } else if (b.id.startsWith("sprite_eyes_half_") && b.id.endsWith("Show")) {
      b.keys = points([[0, 0], [closedStart, 0], [closedEnd, 1],
        [openStart, 1], [openEnd, 0], [1, 0]]);
    } else if (underneath.includes(b)) {
      b.keys = points([[0, 0], [openStart, 0], [openEnd, 1], [1, 1]]);
    } else {
      continue;
    }
    changed.push(b.id);
  }
  // Fail closed if an upgraded Rev2D adds a different sprite curve not covered.
  if (changed.filter((id) => id.endsWith("Show")).length !== expectedSprites.length) {
    unsupported("not every known eye sprite can be transformed");
  }
  return { model: candidate, changedBindings: changed, profile: SHORT_FADE_EYE_PROFILE };
}

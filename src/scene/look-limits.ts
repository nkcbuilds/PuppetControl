/**
 * Semantic look controls -> Rev2D rig parameters.
 *
 * These are *amplitude limits*, not an assessment that an illustration looks
 * good at any particular pose. Every imported flat PNG needs actual visual
 * review of iris clipping and head/neck distortion.
 */
export interface LookLimits {
  headYawDegrees: number;
  headPitchDegrees: number;
  eyeX: number;
  eyeY: number;
}

export const DEFAULT_LOOK_LIMITS: Readonly<LookLimits> = Object.freeze({
  headYawDegrees: 22,
  headPitchDegrees: 12,
  eyeX: 0.5,
  eyeY: 0.5,
});

/**
 * Conservative initial envelope for imported single-layer illustrations.
 *
 * Not artist-approved. This is deliberately smaller than the engine's
 * supported parameter bounds and should be changed only after reviewing
 * actual parameter sweeps for the specific character.
 */
export const IMPORTED_INITIAL_LOOK_LIMITS: Readonly<LookLimits> = Object.freeze({
  headYawDegrees: 8,
  headPitchDegrees: 5,
  eyeX: 0.2,
  eyeY: 0.2,
});

/**
 * Deterministic 1.2-second natural-*timing* diagnostic for a 30 fps blink.
 *
 * This is a sampling schedule, NOT a guarantee the underlying eyelid art is
 * natural or the rig physically plausible. Closing = 140 ms, hold = 65 ms,
 * opening = 240 ms. Frame n samples exactly n * 1000/30 milliseconds.
 */
export const TIMED_BLINK = Object.freeze({
  fps: 30,
  durationMs: 1200,
  closeStartMs: 250,
  closeEndMs: 390,
  holdEndMs: 455,
  openEndMs: 695,
});

function smoothstep(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  return t * t * (3 - 2 * t);
}

export function sampledBlinkAtMs(timeMs: number): number {
  if (!Number.isFinite(timeMs) || timeMs < 0) {
    throw new RangeError("Blink sample time must be a finite, nonnegative number");
  }
  if (timeMs <= TIMED_BLINK.closeStartMs) return 1;
  if (timeMs < TIMED_BLINK.closeEndMs) {
    return 1 - smoothstep(
      (timeMs - TIMED_BLINK.closeStartMs) /
        (TIMED_BLINK.closeEndMs - TIMED_BLINK.closeStartMs),
    );
  }
  if (timeMs <= TIMED_BLINK.holdEndMs) return 0;
  if (timeMs < TIMED_BLINK.openEndMs) {
    return smoothstep(
      (timeMs - TIMED_BLINK.holdEndMs) /
        (TIMED_BLINK.openEndMs - TIMED_BLINK.holdEndMs),
    );
  }
  return 1;
}

export function timedBlinkValues(): number[] {
  const frames = (TIMED_BLINK.durationMs / 1000) * TIMED_BLINK.fps;
  if (!Number.isInteger(frames) || frames < 2 || frames > 60) {
    throw new RangeError("Unsupported timed blink diagnostic frame count");
  }
  return Array.from({ length: frames }, (_, index) =>
    Number(sampledBlinkAtMs((index * 1000) / TIMED_BLINK.fps).toFixed(6)));
}

export const RHUBARB_MOUTH_SHAPES = [
  "A", "B", "C", "D", "E", "F", "G", "H", "X",
] as const;

export type RhubarbMouthShape = (typeof RHUBARB_MOUTH_SHAPES)[number];
export type RhubarbClosedMouthShape = Extract<RhubarbMouthShape, "A" | "X">;

export interface RhubarbMouthCue {
  start: number;
  end: number;
  value: RhubarbMouthShape;
}

export interface RhubarbSampleOptions {
  /**
   * Scene-time delay before the Rhubarb track starts. Positive values move
   * speech later in the scene. Defaults to zero.
   */
  offsetMs?: number;
  /**
   * Explicit closed-mouth fallback. When omitted, X is used if the parsed
   * track contains X; otherwise A is used so six-shape Rhubarb tracks work.
   */
  closedMouth?: RhubarbClosedMouthShape;
}

const mouthShapes = new Set<string>(RHUBARB_MOUTH_SHAPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCue(value: unknown, index: number): RhubarbMouthCue {
  if (!isRecord(value)) {
    throw new Error(`Rhubarb mouth cue ${index} must be an object`);
  }

  const { start, end, value: shape } = value;
  if (typeof start !== "number" || !Number.isFinite(start) || start < 0) {
    throw new Error(`Rhubarb mouth cue ${index} start must be a finite non-negative number`);
  }
  if (typeof end !== "number" || !Number.isFinite(end) || end <= start) {
    throw new Error(`Rhubarb mouth cue ${index} end must be a finite number greater than start`);
  }
  if (typeof shape !== "string" || !mouthShapes.has(shape)) {
    throw new Error(
      `Rhubarb mouth cue ${index} value must be one of ${RHUBARB_MOUTH_SHAPES.join(", ")}`,
    );
  }

  return { start, end, value: shape as RhubarbMouthShape };
}

/**
 * Parse the official Rhubarb JSON shape and return its validated mouth cues.
 *
 * Metadata and other top-level Rhubarb fields are intentionally ignored. Cue
 * intervals are half-open: [start, end). Gaps are valid and are sampled as a
 * closed mouth.
 */
export function parseRhubarbMouthCuesJson(json: string): RhubarbMouthCue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid Rhubarb JSON");
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.mouthCues)) {
    throw new Error("Rhubarb JSON must contain a mouthCues array");
  }

  const cues = parsed.mouthCues.map(parseCue);
  for (let index = 1; index < cues.length; index += 1) {
    const previous = cues[index - 1];
    const current = cues[index];
    if (!previous || !current) continue;

    if (current.start < previous.start) {
      throw new Error(`Rhubarb mouth cues must be ordered by start time (index ${index})`);
    }
    if (current.start < previous.end) {
      throw new Error(`Rhubarb mouth cues must not overlap (index ${index})`);
    }
  }

  return cues;
}

function resolveClosedMouth(
  cues: readonly RhubarbMouthCue[],
  requested?: RhubarbClosedMouthShape,
): RhubarbClosedMouthShape {
  if (requested) return requested;
  return cues.some((cue) => cue.value === "X") ? "X" : "A";
}

/**
 * Look up the mouth shape at a Rhubarb-local time in seconds.
 *
 * Exact cue ends are outside that cue. A contiguous next cue therefore wins
 * at the shared boundary; otherwise the result is the closed-mouth fallback.
 */
export function lookupRhubarbMouthShape(
  cues: readonly RhubarbMouthCue[],
  timeSeconds: number,
  closedMouth?: RhubarbClosedMouthShape,
): RhubarbMouthShape {
  if (!Number.isFinite(timeSeconds)) {
    throw new Error("Rhubarb sample time must be finite");
  }

  const fallback = resolveClosedMouth(cues, closedMouth);
  if (timeSeconds < 0 || cues.length === 0) return fallback;

  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const cue = cues[middle];
    if (!cue) break;

    if (timeSeconds < cue.start) {
      high = middle - 1;
    } else if (timeSeconds >= cue.end) {
      low = middle + 1;
    } else {
      return cue.value;
    }
  }

  return fallback;
}

/**
 * Sample a frame by its center timestamp, without accumulating frame deltas.
 *
 * frame 0 at 30 fps is sampled at 1/60 s. offsetMs defaults to 0; a positive
 * offset delays the Rhubarb track relative to scene time.
 */
export function sampleRhubarbMouthAtFrame(
  cues: readonly RhubarbMouthCue[],
  frameIndex: number,
  fps: number,
  options: RhubarbSampleOptions = {},
): RhubarbMouthShape {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new Error("Frame index must be a non-negative integer");
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("FPS must be a finite positive number");
  }

  const offsetMs = options.offsetMs ?? 0;
  if (!Number.isFinite(offsetMs)) {
    throw new Error("Rhubarb offsetMs must be finite");
  }

  const frameCenterSeconds = (frameIndex + 0.5) / fps;
  const localTimeSeconds = frameCenterSeconds - offsetMs / 1000;
  return lookupRhubarbMouthShape(cues, localTimeSeconds, options.closedMouth);
}

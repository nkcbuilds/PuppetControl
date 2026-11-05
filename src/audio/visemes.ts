import {
  RHUBARB_MOUTH_SHAPES,
  type RhubarbMouthCue,
  type RhubarbMouthShape,
} from "./rhubarb.js";

export type Rev2DMouthParameter = "MouthOpen" | "MouthForm";
export type Rev2DMouthTrackTarget = `param:${Rev2DMouthParameter}`;

export interface Rev2DMouthKey {
  t: number;
  v: number;
  ease?: "inOutSine";
}

export interface Rev2DMouthTrack {
  target: Rev2DMouthTrackTarget;
  keys: Rev2DMouthKey[];
}

export interface Rev2DVisemeCurves {
  duration: number;
  tracks: [Rev2DMouthTrack, Rev2DMouthTrack];
}

export interface Rev2DMouthPose {
  MouthOpen: number;
  MouthForm: number;
}

/**
 * A deliberately small two-parameter approximation for the current Rev2D
 * Hana-style mouth rig. MouthOpen is 0..1; MouthForm is -1..1, where negative
 * values produce a rounder/pouted shape and positive values a wider shape.
 */
export const RHUBARB_TO_REV2D_MOUTH: Readonly<Record<RhubarbMouthShape, Rev2DMouthPose>> = {
  A: { MouthOpen: 0, MouthForm: 0 },
  B: { MouthOpen: 0.16, MouthForm: 0.15 },
  C: { MouthOpen: 0.46, MouthForm: 0.35 },
  D: { MouthOpen: 0.8, MouthForm: 0.1 },
  E: { MouthOpen: 0.56, MouthForm: -0.45 },
  F: { MouthOpen: 0.3, MouthForm: -0.85 },
  G: { MouthOpen: 0.12, MouthForm: 0.15 },
  H: { MouthOpen: 0.38, MouthForm: 0.05 },
  X: { MouthOpen: 0, MouthForm: 0 },
};

const CLOSED_POSE = RHUBARB_TO_REV2D_MOUTH.X;
const TRANSITION_SECONDS = 0.04;
const HALF_TRANSITION_SECONDS = TRANSITION_SECONDS / 2;
const validShapes = new Set<string>(RHUBARB_MOUTH_SHAPES);

interface MouthSegment {
  start: number;
  end: number;
  pose: Rev2DMouthPose;
}

function samePose(left: Rev2DMouthPose, right: Rev2DMouthPose): boolean {
  return left.MouthOpen === right.MouthOpen && left.MouthForm === right.MouthForm;
}

function validateCue(cue: RhubarbMouthCue, index: number, previous?: RhubarbMouthCue): void {
  if (!Number.isFinite(cue.start) || cue.start < 0) {
    throw new Error(`Rhubarb mouth cue ${index} start must be finite and non-negative`);
  }
  if (!Number.isFinite(cue.end) || cue.end <= cue.start) {
    throw new Error(`Rhubarb mouth cue ${index} end must be finite and greater than start`);
  }
  if (!validShapes.has(cue.value)) {
    throw new Error(`Rhubarb mouth cue ${index} has unsupported mouth shape`);
  }
  if (previous) {
    if (cue.start < previous.start) {
      throw new Error(`Rhubarb mouth cues must be ordered by start time (index ${index})`);
    }
    if (cue.start < previous.end) {
      throw new Error(`Rhubarb mouth cues must not overlap (index ${index})`);
    }
  }
}

function appendSegment(segments: MouthSegment[], segment: MouthSegment): void {
  if (!(segment.end > segment.start)) return;

  const previous = segments[segments.length - 1];
  if (previous && previous.end === segment.start && samePose(previous.pose, segment.pose)) {
    previous.end = segment.end;
    return;
  }
  segments.push(segment);
}

function buildSegments(
  cues: readonly RhubarbMouthCue[],
  durationSeconds: number,
): MouthSegment[] {
  let cursor = 0;
  const segments: MouthSegment[] = [];

  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (!cue) continue;
    validateCue(cue, index, cues[index - 1]);
    if (cue.start >= durationSeconds) continue;

    const start = Math.min(durationSeconds, cue.start);
    const end = Math.min(durationSeconds, cue.end);
    if (start > cursor) {
      appendSegment(segments, { start: cursor, end: start, pose: CLOSED_POSE });
    }
    appendSegment(segments, {
      start,
      end,
      pose: RHUBARB_TO_REV2D_MOUTH[cue.value],
    });
    cursor = Math.max(cursor, end);
  }

  if (cursor < durationSeconds) {
    appendSegment(segments, { start: cursor, end: durationSeconds, pose: CLOSED_POSE });
  }
  if (segments.length === 0) {
    segments.push({ start: 0, end: durationSeconds, pose: CLOSED_POSE });
  }

  return segments;
}

function normalizeTime(timeSeconds: number): number {
  // Rhubarb timestamps are decimal seconds and Rev2D consumes decimal seconds.
  // Quantizing only emitted timestamps avoids binary floating-point artifacts
  // such as 0.18000000000000002 while retaining sub-frame precision.
  return Number(timeSeconds.toFixed(6));
}

function addKey(keys: Rev2DMouthKey[], key: Rev2DMouthKey): void {
  const normalized = { ...key, t: normalizeTime(key.t) };
  if (!Number.isFinite(normalized.t) || !Number.isFinite(normalized.v)) {
    throw new Error("Viseme curve produced a non-finite key");
  }

  const previous = keys[keys.length - 1];
  if (previous && previous.t === normalized.t) {
    if (previous.v === normalized.v) {
      if (normalized.ease) previous.ease = normalized.ease;
      return;
    }
    // This can only occur when a very short segment collapses two transition
    // endpoints to the same instant. Keep the later state deterministically.
    keys[keys.length - 1] = normalized;
    return;
  }
  keys.push(normalized);
}

function makeTrack(
  segments: readonly MouthSegment[],
  durationSeconds: number,
  parameter: Rev2DMouthParameter,
): Rev2DMouthTrack {
  const first = segments[0];
  if (!first) throw new Error("Viseme curve requires at least one segment");

  const keys: Rev2DMouthKey[] = [];
  addKey(keys, { t: 0, v: first.pose[parameter] });

  for (let index = 1; index < segments.length; index += 1) {
    const left = segments[index - 1];
    const right = segments[index];
    if (!left || !right || samePose(left.pose, right.pose)) continue;

    const boundary = right.start;
    const halfWindow = Math.min(
      HALF_TRANSITION_SECONDS,
      (left.end - left.start) / 2,
      (right.end - right.start) / 2,
    );
    const fromTime = Math.max(0, boundary - halfWindow);
    const toTime = Math.min(durationSeconds, boundary + halfWindow);

    addKey(keys, {
      t: fromTime,
      v: left.pose[parameter],
      ease: "inOutSine",
    });
    addKey(keys, { t: toTime, v: right.pose[parameter] });
  }

  const last = segments[segments.length - 1];
  if (!last) throw new Error("Viseme curve requires a final segment");
  addKey(keys, { t: durationSeconds, v: last.pose[parameter] });

  return { target: `param:${parameter}`, keys };
}

/**
 * Convert validated Rhubarb cues into Rev2D-compatible MouthOpen/MouthForm
 * tracks. Rhubarb cue intervals remain half-open; uncovered time is a closed
 * mouth target. Each change gets at most a 40 ms eased transition, shortened
 * further when neighbouring states are brief so transition windows never
 * overlap or escape the requested duration.
 */
export function mapRhubarbCuesToRev2DVisemes(
  cues: readonly RhubarbMouthCue[],
  durationSeconds: number,
): Rev2DVisemeCurves {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Viseme duration must be a finite positive number of seconds");
  }

  const segments = buildSegments(cues, durationSeconds);
  const open = makeTrack(segments, durationSeconds, "MouthOpen");
  const form = makeTrack(segments, durationSeconds, "MouthForm");

  return {
    duration: durationSeconds,
    tracks: [open, form],
  };
}

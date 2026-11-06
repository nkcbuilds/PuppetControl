/**
 * Time-ordered PNG motion triage.
 *
 * Adjacent-frame pixel deltas reveal candidates for *manual* jump inspection.
 * A legitimate fast blink, mouth accent, camera cut or hard pose edit can yield
 * a high score; the report never certifies or rejects animation quality.
 */
import { AvatarWorkflowError } from "./avatar.js";
import { comparePngFiles, type PixelComparison, type PixelRegion } from "./pixel-qa.js";

export const MAX_SEQUENCE_FRAMES = 60;

export interface SequenceOptions {
  region?: PixelRegion;
  /** Transition i→i+1 is editorially intentional and not a surprise-jump candidate. */
  cutAfter?: readonly number[];
  /** Optional expected control sampled at each frame; used only for motion-stall triage. */
  controlValues?: readonly number[];
}

export interface SequencePair {
  from: number;
  to: number;
  intentionalCut: boolean;
  rgbMeanAbsoluteError: number;
  changedFraction: number;
  unexpectedTransparentBorderPixels: number;
  controlDelta: number | null;
  /** Triage only. Do not treat false as proof that an animation is smooth. */
  abruptChangeCandidate: boolean;
  motionStallCandidate: boolean;
}

export interface SequenceQaReport {
  frameCount: number;
  pairCount: number;
  region: PixelRegion;
  medianPairError: number;
  medianAbsoluteDeviation: number;
  reviewThreshold: number;
  pairs: SequencePair[];
  possibleAbruptChanges: number[];
  possibleMotionStalls: number[];
  controlValuesProvided: boolean;
  firstToLast: {
    rgbMeanAbsoluteError: number;
    changedFraction: number;
    unexpectedTransparentBorderPixels: number;
  };
  note: string;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function finiteMetric(comparison: PixelComparison): void {
  if (!Number.isFinite(comparison.rgbMeanAbsoluteError) ||
    !Number.isFinite(comparison.changedFraction) ||
    comparison.rgbMeanAbsoluteError < 0 || comparison.rgbMeanAbsoluteError > 255 ||
    comparison.changedFraction < 0 || comparison.changedFraction > 1) {
    throw new AvatarWorkflowError("SEQUENCE_QA_METRIC_INVALID", "Pixel comparisons must return bounded numeric metrics.");
  }
}

function checkSequenceOptions(frameCount: number, options: SequenceOptions): Set<number> {
  if (frameCount < 2 || frameCount > MAX_SEQUENCE_FRAMES || !Number.isSafeInteger(frameCount)) {
    throw new AvatarWorkflowError("SEQUENCE_QA_LENGTH_INVALID", "Supply 2–60 ordered frames.");
  }
  const cuts = options.cutAfter ?? [];
  if (options.controlValues && (options.controlValues.length !== frameCount ||
    options.controlValues.some((value) => !Number.isFinite(value) || Math.abs(value) > 1_000_000))) {
    throw new AvatarWorkflowError("SEQUENCE_QA_CONTROL_VALUES_INVALID",
      "Control samples must contain one finite value for each frame.");
  }
  if (cuts.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= frameCount - 1) ||
      new Set(cuts).size !== cuts.length) {
    throw new AvatarWorkflowError("SEQUENCE_QA_CUTS_INVALID",
      "Each intentional cut must be a unique zero-based frame index before the last frame.");
  }
  return new Set(cuts);
}

function compactMetric(comparison: PixelComparison) {
  return {
    rgbMeanAbsoluteError: comparison.rgbMeanAbsoluteError,
    changedFraction: comparison.changedFraction,
    unexpectedTransparentBorderPixels: comparison.unexpectedTransparentBorderPixels,
  };
}

/**
 * Summarize fixed-size image comparisons. Exclude *declared* editorial cuts
 * from baseline statistics; don't mislabel them as unexpected pops.
 * In a sequence without at least 3 comparable non-cut pairs, classify no
 * abrupt-change candidates (the evidence is too sparse).
 */
export function analyzeSequenceComparisons(
  pairs: readonly PixelComparison[], firstToLast: PixelComparison,
  options: SequenceOptions = {},
): SequenceQaReport {
  const cuts = checkSequenceOptions(pairs.length + 1, options);
  for (const comparison of [...pairs, firstToLast]) finiteMetric(comparison);
  const dims = pairs[0]!;
  const width = dims.width;
  const height = dims.height;
  const region = dims.region;
  const sameRegion = (a: PixelRegion, b: PixelRegion) =>
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  if ([...pairs, firstToLast].some((comparison) =>
      comparison.width !== width || comparison.height !== height || !sameRegion(comparison.region, region))) {
    throw new AvatarWorkflowError("SEQUENCE_QA_DIMENSIONS_MISMATCH",
      "Comparisons must share the same exact frame dimensions and selected region.");
  }

  const comparable = pairs
    .map((comparison, i) => ({ i, score: comparison.rgbMeanAbsoluteError }))
    .filter(({ i }) => !cuts.has(i)).map(({ score }) => score);
  const center = comparable.length ? median(comparable) : 0;
  const mad = comparable.length ? median(comparable.map((score) => Math.abs(score - center))) : 0;

  // Avoid zero-noise score jumps and render compression artifacts.
  // Stronger than typical adjacent variation, not a quality certification.
  const threshold = Number(Math.min(255, Math.max(8, center * 2.5, center + 6 * mad)).toFixed(4));
  const pairReports: SequencePair[] = pairs.map((comparison, from) => ({
    from, to: from + 1, intentionalCut: cuts.has(from),
    ...compactMetric(comparison),
    controlDelta: options.controlValues
      ? Number(Math.abs(options.controlValues[from + 1]! - options.controlValues[from]!).toFixed(6))
      : null,
    motionStallCandidate: !!options.controlValues &&
      Math.abs(options.controlValues[from + 1]! - options.controlValues[from]!) > 0.000001 &&
      comparison.rgbMeanAbsoluteError <= 0.05 && comparison.changedFraction <= 0.001,
    abruptChangeCandidate: comparable.length >= 3 && !cuts.has(from) &&
      comparison.rgbMeanAbsoluteError > threshold,
  }));
  return {
    frameCount: pairs.length + 1,
    pairCount: pairs.length,
    region,
    medianPairError: Number(center.toFixed(4)),
    medianAbsoluteDeviation: Number(mad.toFixed(4)),
    reviewThreshold: threshold,
    pairs: pairReports,
    possibleAbruptChanges: pairReports.filter((p) => p.abruptChangeCandidate).map((p) => p.from),
    possibleMotionStalls: pairReports.filter((p) => p.motionStallCandidate).map((p) => p.from),
    controlValuesProvided: !!options.controlValues,
    firstToLast: compactMetric(firstToLast),
    note: "Jump and changed-control motion-stall candidates are triage, not proof of defects. Inspect frames, rig clamping, artwork visibility, timing and declared cuts before judging smoothness.",
  };
}

/** File-by-file scan bounds memory usage; all files must stay inside the current workspace. */
export async function comparePngSequence(
  files: readonly string[], options: SequenceOptions = {}, root = process.cwd(),
): Promise<SequenceQaReport> {
  checkSequenceOptions(files.length, options);
  if (files.some((file) => typeof file !== "string" || !file.toLowerCase().endsWith(".png"))) {
    throw new AvatarWorkflowError("SEQUENCE_QA_PNG_REQUIRED", "Every explicitly ordered frame must be a PNG.");
  }
  const pairs: PixelComparison[] = [];
  for (let i = 0; i < files.length - 1; i++) {
    pairs.push(await comparePngFiles(files[i]!, files[i + 1]!, options.region, root));
  }
  const last = await comparePngFiles(files[0]!, files[files.length - 1]!, options.region, root);
  return analyzeSequenceComparisons(pairs, last, options);
}

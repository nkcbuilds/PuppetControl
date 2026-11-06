import { describe, expect, it } from "vitest";
import { analyzeSequenceComparisons, comparePngSequence, MAX_SEQUENCE_FRAMES } from "../src/character/frame-sequence-qa.js";
import type { PixelComparison } from "../src/character/pixel-qa.js";

const region = { x: 0, y: 0, width: 256, height: 256 };
function metric(error: number, changedFraction = error / 255): PixelComparison {
  return {
    width: 256, height: 256, region, comparedPixels: 65_536,
    ignoredTransparentPixels: 0, rgbMeanAbsoluteError: error,
    changedPixels: Math.round(65_536 * changedFraction), changedFraction,
    unexpectedTransparentBorderPixels: 0, note: "manual review only",
  };
}

describe("time-ordered visual motion QA", () => {
  it("reports a single anomalous pair without claiming artistic failure", () => {
    const report = analyzeSequenceComparisons(
      [metric(3), metric(3), metric(35), metric(3), metric(3)], metric(0),
    );
    expect(report.frameCount).toBe(6);
    expect(report.medianPairError).toBe(3);
    expect(report.possibleAbruptChanges).toEqual([2]);
    expect(report.pairs[2]).toMatchObject({
      from: 2, to: 3, abruptChangeCandidate: true, intentionalCut: false,
    });
    expect(report.firstToLast.rgbMeanAbsoluteError).toBe(0);
    expect(report.possibleMotionStalls).toEqual([]);
    expect(report.controlValuesProvided).toBe(false);
    expect(report.note).toMatch(/triage/i);
  });

  it("does not flag an explicitly authored editorial cut or poison baseline with its high score", () => {
    const report = analyzeSequenceComparisons(
      [metric(2), metric(2), metric(175), metric(2), metric(2)], metric(170), { cutAfter: [2] },
    );
    expect(report.medianPairError).toBe(2);
    expect(report.possibleAbruptChanges).toEqual([]);
    expect(report.pairs[2]).toMatchObject({
      abruptChangeCandidate: false, intentionalCut: true,
    });
  });

  it("refuses to classify a two/three-frame sample as a proven jump", () => {
    const small = analyzeSequenceComparisons([metric(210)], metric(210));
    expect(small.possibleAbruptChanges).toEqual([]);
    const next = analyzeSequenceComparisons([metric(210), metric(1)], metric(0));
    expect(next.possibleAbruptChanges).toEqual([]);
  });

  it("tolerates smooth regular steps and zero movement", () => {
    const regular = analyzeSequenceComparisons(
      [metric(11), metric(10), metric(12), metric(11), metric(10)], metric(1),
    );
    expect(regular.possibleAbruptChanges).toEqual([]);
    const frozen = analyzeSequenceComparisons(
      [metric(0), metric(0), metric(0)], metric(0),
    );
    expect(frozen.possibleAbruptChanges).toEqual([]);
    expect(frozen.firstToLast.changedFraction).toBe(0);
  });

  it("flags unchanged frames when an explicitly sampled control moved", () => {
    const report = analyzeSequenceComparisons(
      [metric(5), metric(0), metric(5), metric(0)], metric(0),
      { controlValues: [1, 0.8, 0.6, 0.4, 0.2] },
    );
    expect(report.controlValuesProvided).toBe(true);
    expect(report.possibleMotionStalls).toEqual([1, 3]);
    expect(report.pairs[1]).toMatchObject({
      from: 1, to: 2, motionStallCandidate: true, controlDelta: 0.2,
    });
    const noChangeExpected = analyzeSequenceComparisons(
      [metric(0), metric(0), metric(0)], metric(0),
      { controlValues: [1, 1, 1, 1] },
    );
    expect(noChangeExpected.possibleMotionStalls).toEqual([]);
  });

  it("refuses short, non-finite or unrelated control arrays", () => {
    expect(() => analyzeSequenceComparisons([metric(0), metric(0)], metric(0),
      { controlValues: [1, 0.8] })).toThrow(/one finite value/);
    expect(() => analyzeSequenceComparisons([metric(0), metric(0)], metric(0),
      { controlValues: [1, NaN, 0] })).toThrow(/one finite value/);
    expect(() => analyzeSequenceComparisons([metric(0), metric(0)], metric(0),
      { controlValues: [1, Infinity, 0] })).toThrow(/one finite value/);
  });

  it("rejects malformed and duplicate cut indexes, excessive sequences and inconsistent regions", () => {
    expect(MAX_SEQUENCE_FRAMES).toBe(60);
    for (const cuts of [[2, 2], [-1], [4], [1.5], [NaN]]) {
      expect(() => analyzeSequenceComparisons([metric(0),metric(0),metric(0)], metric(0), { cutAfter: cuts }))
        .toThrow(/cut/i);
    }
    expect(() => analyzeSequenceComparisons([], metric(0))).toThrow(/2–60/);
    expect(() => analyzeSequenceComparisons(Array.from({ length: 60 }, () => metric(0)), metric(0)))
      .toThrow(/2–60/);
    const other = { ...metric(4), region: { x: 1, y: 0, width: 255, height: 256 } };
    expect(() => analyzeSequenceComparisons([metric(1), other, metric(1)], metric(0)))
      .toThrow(/same exact/);
  });

  it("refuses out-of-bounds and nonfinite comparison metrics", () => {
    for (const bad of [NaN, Infinity, -1, 256]) {
      expect(() => analyzeSequenceComparisons([metric(0), metric(bad), metric(0)], metric(0)))
        .toThrow(/bounded numeric metrics/);
    }
    expect(() => analyzeSequenceComparisons([metric(0, 1.1)], metric(0)))
      .toThrow(/bounded numeric metrics/);
  });

  it("requires explicitly ordered PNG filenames before starting external decoding", async () => {
    await expect(comparePngSequence(["a.jpg", "b.png"]))
      .rejects.toMatchObject({ code: "SEQUENCE_QA_PNG_REQUIRED" });
    await expect(comparePngSequence(["a.png"]))
      .rejects.toMatchObject({ code: "SEQUENCE_QA_LENGTH_INVALID" });
  });
});

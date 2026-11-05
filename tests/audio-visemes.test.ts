import { describe, expect, it } from "vitest";
import type { RhubarbMouthCue } from "../src/audio/rhubarb.js";
import {
  mapRhubarbCuesToRev2DVisemes,
  RHUBARB_TO_REV2D_MOUTH,
  type Rev2DMouthKey,
} from "../src/audio/visemes.js";

function track(
  cues: readonly RhubarbMouthCue[],
  duration: number,
  target: "param:MouthOpen" | "param:MouthForm",
): Rev2DMouthKey[] {
  const result = mapRhubarbCuesToRev2DVisemes(cues, duration);
  const found = result.tracks.find((item) => item.target === target);
  if (!found) throw new Error("missing track " + target);
  return found.keys;
}

describe("Rhubarb to Rev2D viseme curves", () => {
  it("maps the six basic and optional G/H/X shapes into bounded Rev2D mouth poses", () => {
    const shapes: RhubarbMouthCue["value"][] = ["A", "B", "C", "D", "E", "F", "G", "H", "X"];
    for (const shape of shapes) {
      const result = mapRhubarbCuesToRev2DVisemes([
        { start: 0, end: 0.2, value: shape },
      ], 0.2);

      expect(result.tracks[0].target).toBe("param:MouthOpen");
      expect(result.tracks[1].target).toBe("param:MouthForm");
      expect(result.tracks[0].keys[0]?.v).toBe(RHUBARB_TO_REV2D_MOUTH[shape].MouthOpen);
      expect(result.tracks[1].keys[0]?.v).toBe(RHUBARB_TO_REV2D_MOUTH[shape].MouthForm);
      expect(result.tracks[0].keys[0]?.v).toBeGreaterThanOrEqual(0);
      expect(result.tracks[0].keys[0]?.v).toBeLessThanOrEqual(1);
      expect(result.tracks[1].keys[0]?.v).toBeGreaterThanOrEqual(-1);
      expect(result.tracks[1].keys[0]?.v).toBeLessThanOrEqual(1);
    }
  });

  it("treats gaps, pre-roll and the final uncovered interval as closed mouth", () => {
    const cues: RhubarbMouthCue[] = [
      { start: 0.1, end: 0.2, value: "D" },
      { start: 0.3, end: 0.4, value: "F" },
    ];
    const open = track(cues, 0.5, "param:MouthOpen");
    const form = track(cues, 0.5, "param:MouthForm");

    expect(open[0]).toEqual({ t: 0, v: 0 });
    expect(form[0]).toEqual({ t: 0, v: 0 });

    // The 100 ms gap between cues reaches the exact closed state after the
    // first transition and holds it before the next transition.
    expect(open).toContainEqual({ t: 0.22, v: 0 });
    expect(open).toContainEqual({ t: 0.28, v: 0, ease: "inOutSine" });
    expect(form).toContainEqual({ t: 0.22, v: 0 });
    expect(form).toContainEqual({ t: 0.28, v: 0, ease: "inOutSine" });

    expect(open.at(-1)).toEqual({ t: 0.5, v: 0 });
    expect(form.at(-1)).toEqual({ t: 0.5, v: 0 });
  });

  it("uses deterministic eased transitions no wider than 40 ms", () => {
    const cues: RhubarbMouthCue[] = [
      { start: 0, end: 0.2, value: "B" },
      { start: 0.2, end: 0.4, value: "D" },
    ];
    const open = track(cues, 0.4, "param:MouthOpen");

    expect(open).toEqual([
      { t: 0, v: RHUBARB_TO_REV2D_MOUTH.B.MouthOpen },
      { t: 0.18, v: RHUBARB_TO_REV2D_MOUTH.B.MouthOpen, ease: "inOutSine" },
      { t: 0.22, v: RHUBARB_TO_REV2D_MOUTH.D.MouthOpen },
      { t: 0.4, v: RHUBARB_TO_REV2D_MOUTH.D.MouthOpen },
    ]);
  });

  it("shrinks interpolation windows for very short cues instead of crossing neighbours", () => {
    const cues: RhubarbMouthCue[] = [
      { start: 0, end: 0.01, value: "B" },
      { start: 0.01, end: 0.02, value: "D" },
      { start: 0.02, end: 0.03, value: "F" },
    ];
    const open = track(cues, 0.03, "param:MouthOpen");
    const times = open.map((key) => key.t);

    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times.every((time) => time >= 0 && time <= 0.03)).toBe(true);
    expect(open).toContainEqual({
      t: 0.005,
      v: RHUBARB_TO_REV2D_MOUTH.B.MouthOpen,
      ease: "inOutSine",
    });
    expect(open).toContainEqual({
      t: 0.015,
      v: RHUBARB_TO_REV2D_MOUTH.D.MouthOpen,
      ease: "inOutSine",
    });
  });

  it("emits sorted finite keys within duration bounds for both tracks", () => {
    const cues: RhubarbMouthCue[] = [
      { start: 0.05, end: 0.15, value: "C" },
      { start: 0.15, end: 0.35, value: "E" },
      { start: 0.6, end: 2, value: "H" },
    ];
    const result = mapRhubarbCuesToRev2DVisemes(cues, 0.8);

    expect(result.duration).toBe(0.8);
    for (const item of result.tracks) {
      expect(item.keys.length).toBeGreaterThan(1);
      expect(item.keys[0]?.t).toBe(0);
      expect(item.keys.at(-1)?.t).toBe(0.8);
      for (let index = 0; index < item.keys.length; index += 1) {
        const key = item.keys[index];
        if (!key) continue;
        expect(Number.isFinite(key.t)).toBe(true);
        expect(Number.isFinite(key.v)).toBe(true);
        expect(key.t).toBeGreaterThanOrEqual(0);
        expect(key.t).toBeLessThanOrEqual(0.8);
        if (index > 0) expect(key.t).toBeGreaterThanOrEqual(item.keys[index - 1]?.t ?? -1);
      }
    }
  });

  it("returns a closed-mouth hold for an empty cue list", () => {
    const result = mapRhubarbCuesToRev2DVisemes([], 1);
    expect(result.tracks[0].keys).toEqual([{ t: 0, v: 0 }, { t: 1, v: 0 }]);
    expect(result.tracks[1].keys).toEqual([{ t: 0, v: 0 }, { t: 1, v: 0 }]);
  });

  it("rejects invalid durations and malformed runtime cues", () => {
    expect(() => mapRhubarbCuesToRev2DVisemes([], 0)).toThrow("finite positive");
    expect(() => mapRhubarbCuesToRev2DVisemes([], Number.NaN)).toThrow("finite positive");

    expect(() => mapRhubarbCuesToRev2DVisemes([
      { start: 0.2, end: 0.4, value: "B" },
      { start: 0.1, end: 0.15, value: "C" },
    ], 1)).toThrow("ordered");

    expect(() => mapRhubarbCuesToRev2DVisemes([
      { start: 0, end: 0.3, value: "B" },
      { start: 0.2, end: 0.4, value: "C" },
    ], 1)).toThrow("overlap");

    expect(() => mapRhubarbCuesToRev2DVisemes([
      { start: 0, end: 0.1, value: "Q" as RhubarbMouthCue["value"] },
    ], 1)).toThrow("unsupported");
  });
});

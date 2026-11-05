import { describe, expect, it } from "vitest";
import {
  lookupRhubarbMouthShape,
  parseRhubarbMouthCuesJson,
  sampleRhubarbMouthAtFrame,
} from "../src/audio/rhubarb.js";

function rhubarbJson(mouthCues: unknown[]): string {
  return JSON.stringify({
    metadata: { soundFile: "voice.wav", duration: 1.5 },
    mouthCues,
  });
}

describe("Rhubarb mouth cue parsing", () => {
  it("accepts the six standard and three optional mouth shapes", () => {
    const values = ["A", "B", "C", "D", "E", "F", "G", "H", "X"];
    const cues = parseRhubarbMouthCuesJson(rhubarbJson(
      values.map((value, index) => ({
        start: index / 10,
        end: (index + 1) / 10,
        value,
      })),
    ));

    expect(cues.map((cue) => cue.value)).toEqual(values);
  });

  it("rejects malformed input, invalid intervals and unsupported shapes", () => {
    expect(() => parseRhubarbMouthCuesJson("{")).toThrow("Invalid Rhubarb JSON");
    expect(() => parseRhubarbMouthCuesJson(JSON.stringify({ metadata: {} })))
      .toThrow("mouthCues array");
    expect(() => parseRhubarbMouthCuesJson(rhubarbJson([
      { start: -0.1, end: 0.1, value: "A" },
    ]))).toThrow("non-negative");
    expect(() => parseRhubarbMouthCuesJson(rhubarbJson([
      { start: 0.2, end: 0.2, value: "A" },
    ]))).toThrow("greater than start");
    expect(() => parseRhubarbMouthCuesJson(rhubarbJson([
      { start: 0, end: 0.1, value: "I" },
    ]))).toThrow("one of");
  });

  it("rejects out-of-order and overlapping cues while allowing gaps", () => {
    expect(() => parseRhubarbMouthCuesJson(rhubarbJson([
      { start: 0.4, end: 0.5, value: "A" },
      { start: 0.2, end: 0.3, value: "B" },
    ]))).toThrow("ordered");

    expect(() => parseRhubarbMouthCuesJson(rhubarbJson([
      { start: 0.0, end: 0.3, value: "A" },
      { start: 0.2, end: 0.4, value: "B" },
    ]))).toThrow("overlap");

    expect(parseRhubarbMouthCuesJson(rhubarbJson([
      { start: 0.0, end: 0.1, value: "A" },
      { start: 0.2, end: 0.3, value: "B" },
    ]))).toHaveLength(2);
  });
});

describe("Rhubarb mouth cue lookup", () => {
  it("uses half-open intervals and maps gaps and the track end to closed mouth", () => {
    const cues = parseRhubarbMouthCuesJson(rhubarbJson([
      { start: 0.0, end: 0.1, value: "B" },
      { start: 0.1, end: 0.2, value: "C" },
      { start: 0.3, end: 0.4, value: "D" },
    ]));

    expect(lookupRhubarbMouthShape(cues, 0.099)).toBe("B");
    expect(lookupRhubarbMouthShape(cues, 0.1)).toBe("C");
    expect(lookupRhubarbMouthShape(cues, 0.25)).toBe("A");
    expect(lookupRhubarbMouthShape(cues, 0.4)).toBe("A");
  });

  it("uses X as the closed-mouth fallback when the track includes X", () => {
    const cues = parseRhubarbMouthCuesJson(rhubarbJson([
      { start: 0.0, end: 0.1, value: "B" },
      { start: 0.2, end: 0.3, value: "X" },
    ]));

    expect(lookupRhubarbMouthShape(cues, -0.1)).toBe("X");
    expect(lookupRhubarbMouthShape(cues, 0.15)).toBe("X");
    expect(lookupRhubarbMouthShape(cues, 1)).toBe("X");
  });

  it("allows an explicit closed-mouth override", () => {
    const cues = parseRhubarbMouthCuesJson(rhubarbJson([
      { start: 0.1, end: 0.2, value: "B" },
    ]));

    expect(lookupRhubarbMouthShape(cues, 0, "X")).toBe("X");
  });
});

describe("deterministic frame-center sampling", () => {
  it("samples at the center of each frame instead of its leading edge", () => {
    const cues = parseRhubarbMouthCuesJson(rhubarbJson([
      { start: 0.0, end: 0.01, value: "B" },
      { start: 0.01, end: 0.04, value: "C" },
    ]));

    // Frame 0 at 30 fps is centered at 16.666... ms, so C must win.
    expect(sampleRhubarbMouthAtFrame(cues, 0, 30)).toBe("C");
    expect(sampleRhubarbMouthAtFrame(cues, 0, 30, { offsetMs: 0 })).toBe("C");
  });

  it("applies a positive offset by delaying the cue track in scene time", () => {
    const cues = parseRhubarbMouthCuesJson(rhubarbJson([
      { start: 0.0, end: 0.05, value: "B" },
    ]));

    expect(sampleRhubarbMouthAtFrame(cues, 0, 30, { offsetMs: 20 })).toBe("A");
    expect(sampleRhubarbMouthAtFrame(cues, 1, 30, { offsetMs: 20 })).toBe("B");
  });

  it("rejects invalid frame sampling parameters", () => {
    const cues = parseRhubarbMouthCuesJson(rhubarbJson([]));
    expect(() => sampleRhubarbMouthAtFrame(cues, -1, 30)).toThrow("Frame index");
    expect(() => sampleRhubarbMouthAtFrame(cues, 0, 0)).toThrow("FPS");
    expect(() => sampleRhubarbMouthAtFrame(cues, 0, 30, { offsetMs: Number.NaN }))
      .toThrow("offsetMs");
  });
});

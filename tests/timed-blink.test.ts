import { describe, expect, it } from "vitest";
import { TIMED_BLINK, sampledBlinkAtMs, timedBlinkValues } from "../src/character/timed-blink.js";

describe("30 fps time-domain blink diagnostic", () => {
  it("samples frame n at n/30 s for exactly 1.2 seconds without endpoint duplication", () => {
    const values = timedBlinkValues();
    expect(values).toHaveLength(36);
    expect(values[0]).toBe(1);
    expect(values.at(-1)).toBe(1);
    for (let i = 0; i < values.length; i++) {
      expect(values[i]).toBeCloseTo(
        Number(sampledBlinkAtMs(i * 1000 / TIMED_BLINK.fps).toFixed(6)), 7);
    }
  });
  it("has open lead-in, one closed hold, and open tail; bounds every frame", () => {
    const values = timedBlinkValues();
    expect(values.slice(0, 8)).toEqual(Array(8).fill(1));
    expect(values.some((x) => x === 0)).toBe(true);
    expect(values.slice(22)).toEqual(Array(14).fill(1));
    expect(values.every((x) => x >= 0 && x <= 1 && Number.isFinite(x))).toBe(true);
    expect(values.filter((x) => x === 0).length).toBeGreaterThanOrEqual(2);
  });
  it("keeps the closing segment monotonically decreasing and opening increasing", () => {
    const values = timedBlinkValues();
    for (let i = 9; i <= 11; i++) expect(values[i]).toBeLessThanOrEqual(values[i - 1]!);
    for (let i = 15; i <= 20; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]!);
    expect(values[11]).toBeLessThan(0.08);
    expect(values[18]).toBeGreaterThan(0.5);
  });
  it("rejects invalid sample times rather than using bogus frame values", () => {
    for (const x of [NaN, -1, Infinity, -Infinity]) {
      expect(() => sampledBlinkAtMs(x)).toThrow(RangeError);
    }
  });
});

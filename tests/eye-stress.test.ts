import { describe, expect, it } from "vitest";
import { eyeStressCases } from "../src/character/eye-stress.js";

const controls = [
  ["EyeLOpen", 0, 1], ["EyeROpen", 0, 1], ["EyeBallX", -1, 1],
  ["EyeBallY", -1, 1], ["AngleX", -30, 30], ["AngleY", -30, 30],
  ["MouthOpen", 0, 1], ["MouthForm", -1, 1],
].map(([id, min, max]) => ({ id: id as string, min: min as number, max: max as number }));

describe("combined eye, gaze, face and head diagnostic plan", () => {
  it("exposes exactly 16 named, distinct combinations and preserves input", () => {
    const original = structuredClone(controls);
    const cases = eyeStressCases(controls);
    expect(controls).toEqual(original);
    expect(cases).toHaveLength(16);
    expect(new Set(cases.map(c => c.id)).size).toBe(16);
    expect(new Set(cases.map(c => JSON.stringify(c.params))).size).toBe(16);
    expect(cases[0]!.id).toBe("open-neutral");
    expect(cases[3]!.params.EyeLOpen).toBe(0);
    expect(cases[3]!.params.EyeROpen).toBe(0);
    expect(cases.at(-1)!.params.EyeLOpen).toBe(0);
    expect(cases.at(-1)!.params.EyeROpen).toBe(1);
    expect(cases.some(c => c.params.AngleX !== 0 && c.params.EyeBallX !== 0 &&
      c.params.EyeLOpen < 1 && c.params.MouthOpen > 0)).toBe(true);
  });

  it("never produces a parameter outside the model's declared ranges", () => {
    const cases = eyeStressCases(controls);
    const map = new Map(controls.map(p => [p.id, p]));
    for (const c of cases) for (const [name, value] of Object.entries(c.params)) {
      expect(value).toBeGreaterThanOrEqual(map.get(name)!.min);
      expect(value).toBeLessThanOrEqual(map.get(name)!.max);
    }
  });

  it("rejects missing, duplicate or restricted controls rather than silently clamping", () => {
    const missing = controls.filter(p => p.id !== "EyeBallX");
    expect(() => eyeStressCases(missing)).toThrow(/EyeBallX/);
    expect(() => eyeStressCases([...controls, controls[0]!])).toThrow(/Duplicate/);
    expect(() => eyeStressCases(controls.map(p => p.id === "AngleX" ?
      { ...p, min: -4, max: 4 } : p))).toThrow(/AngleX/);
    expect(() => eyeStressCases(controls.map(p => p.id === "EyeLOpen" ?
      { ...p, min: 0.2, max: 1 } : p))).toThrow(/EyeLOpen/);
    expect(() => eyeStressCases([])).toThrow(/missing|Missing/i);
  });
});

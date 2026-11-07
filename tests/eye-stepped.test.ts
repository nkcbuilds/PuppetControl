import { describe, expect, it } from "vitest";
import { steppedDrawnEyes, STEPPED_EYE_PROFILE } from "../src/character/eye-stepped.js";

type Key = { at: number[]; value: number };
type Binding = { id: string; target: string; params: string[]; keys: Key[] };
const key = (x: number, y: number): Key => ({ at: [x], value: y });

function sample(keys: Key[], x: number): number {
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i]!.at[0]!) {
      const a = keys[i - 1]!; const b = keys[i]!;
      const t = (x - a.at[0]!) / (b.at[0]! - a.at[0]!);
      return a.value * (1 - t) + b.value * t;
    }
  }
  return keys[keys.length - 1]!.value;
}
function fixture() {
  const bindings: Binding[] = [];
  for (const [image, param, suffix] of [
    ["imageLeft", "EyeROpen", "eyeR"],
    ["imageRight", "EyeLOpen", "eyeL"],
  ]) {
    for (const name of ["closed", "half"]) {
      const part = "sprite_eyes_" + name + "_" + image;
      bindings.push({
        id: part + "Show", target: "part:" + part + ".opacity",
        params: [param], keys: [key(0, name === "closed" ? 1 : 0), key(1, 0)],
      });
    }
    for (const layer of ["white", "ball", "lower", "upper", "crease"]) {
      const id = suffix + "_" + layer;
      bindings.push({
        id: id + "UnderSprite", target: "part:" + id + ".opacity",
        params: [param], keys: [key(0, 0), key(0.7, 1), key(1, 1)],
      });
    }
  }
  const mouth = { id: "mouthForm", params: ["MouthForm"], target: "param:MouthForm",
    keys: [key(0, 0), key(1, 1)] };
  return { meta: { width: 512, height: 640 }, bindings: [...bindings, mouth] };
}

describe("opt-in stepped Rev2D eye sprite experiment", () => {
  it("preserves other controls and source model without mutation", () => {
    const model = fixture();
    const original = structuredClone(model);
    const result = steppedDrawnEyes(model);
    expect(model).toEqual(original);
    expect(result.changedBindings).toHaveLength(14);
    expect((result.model.bindings as Binding[]).at(-1)).toEqual(original.bindings.at(-1));
    expect(result.profile).toEqual(STEPPED_EYE_PROFILE);
  });

  it("has exactly one opaque eye appearance except in the tiny switch interval", () => {
    const model = steppedDrawnEyes(fixture()).model as { bindings: Binding[] };
    for (const image of ["imageLeft", "imageRight"]) {
      const closed = model.bindings.find(b => b.id === "sprite_eyes_closed_" + image + "Show")!;
      const half = model.bindings.find(b => b.id === "sprite_eyes_half_" + image + "Show")!;
      const mesh = model.bindings.find(b => b.id === (image === "imageLeft"
        ? "eyeR_whiteUnderSprite" : "eyeL_whiteUnderSprite"))!;
      for (const x of [0, 0.05, 0.19, 0.20, 0.35, 0.5, 0.68, 0.70, 0.82, 1]) {
        const states = [closed, half, mesh].map(b => sample(b.keys, x));
        expect(states.filter(value => Math.abs(value - 1) < 1e-9)).toHaveLength(1);
        expect(states.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 7);
      }
      expect(sample(closed.keys, 0.19)).toBe(1);
      expect(sample(half.keys, 0.19)).toBe(0);
      expect(sample(half.keys, 0.2)).toBe(1);
      expect(sample(half.keys, 0.68)).toBe(1);
      expect(sample(mesh.keys, 0.70)).toBe(1);
      expect(sample(half.keys, 0.69)).toBe(0);
    }
  });

  it("enforces complementary opacity at the exact narrow switch midpoint", () => {
    const model = steppedDrawnEyes(fixture()).model as { bindings: Binding[] };
    const find = (id: string) => model.bindings.find(b => b.id === id)!.keys;
    const c = STEPPED_EYE_PROFILE.closedToHalf;
    const h = STEPPED_EYE_PROFILE.halfToMesh;
    const halfWidth = STEPPED_EYE_PROFILE.stepWidth / 2;
    expect(sample(find("sprite_eyes_closed_imageLeftShow"), c - halfWidth)).toBeCloseTo(0.5, 6);
    expect(sample(find("sprite_eyes_half_imageLeftShow"), c - halfWidth)).toBeCloseTo(0.5, 6);
    expect(sample(find("sprite_eyes_half_imageLeftShow"), h - halfWidth)).toBeCloseTo(0.5, 6);
    expect(sample(find("eyeR_whiteUnderSprite"), h - halfWidth)).toBeCloseTo(0.5, 6);
  });

  it("rejects missing/unsupported eye topology rather than altering arbitrary rig", () => {
    const withoutRight = fixture();
    withoutRight.bindings = withoutRight.bindings.filter(b =>
      b.id !== "sprite_eyes_half_imageRightShow");
    expect(() => steppedDrawnEyes(withoutRight)).toThrow(/incompatible|variants/);
  });
});

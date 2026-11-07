import { describe, expect, it } from "vitest";
import { shortFadeDrawnEyes } from "../src/character/eye-short-fade.js";

type B = { id: string; target: string; params: string[]; keys: { at: number[]; value: number }[] };
const values = (entries: Array<[number, number]>) => entries.map(([at, value]) => ({ at: [at], value }));
const sprite = (name: string, param: string, initial: number): B => ({
  id: name + "Show", target: "part:" + name + ".opacity", params: [param],
  keys: values([[0, initial], [1, 0]]),
});
function fixture() {
  const bindings: B[] = [
    sprite("sprite_eyes_closed_imageLeft", "EyeROpen", 1),
    sprite("sprite_eyes_closed_imageRight", "EyeLOpen", 1),
    sprite("sprite_eyes_half_imageLeft", "EyeROpen", 1),
    sprite("sprite_eyes_half_imageRight", "EyeLOpen", 1),
  ];
  for (const [eye, param] of [["eyeR", "EyeROpen"], ["eyeL", "EyeLOpen"]]) {
    for (const kind of ["white", "ball", "lower", "upper", "crease"]) {
      const name = eye + "_" + kind;
      bindings.push({
        id: name + "UnderSprite", target: "part:" + name + ".opacity",
        params: [param], keys: values([[0, 0], [0.7, 1], [1, 1]]),
      });
    }
  }
  bindings.push({ id: "mouthShape", target: "part:mouth.opacity",
    params: ["MouthOpen"], keys: values([[0, 1], [1, 1]]) });
  return { meta: { name: "experimental", width: 512, height: 640 }, bindings };
}

function sample(keys: { at: number[]; value: number }[], x: number) {
  if (x <= keys[0]!.at[0]!) return keys[0]!.value;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!, b = keys[i]!;
    if (x <= b.at[0]!) {
      const fraction = (x - a.at[0]!) / (b.at[0]! - a.at[0]!);
      return a.value + (b.value - a.value) * fraction;
    }
  }
  return keys[keys.length - 1]!.value;
}

describe("experimental short fade for reviewed eye sprites", () => {
  it("returns a new model with only expected eye opacity bindings changed", () => {
    const src = fixture();
    const before = structuredClone(src);
    const result = shortFadeDrawnEyes(src);
    const bindings = result.model.bindings as B[];
    expect(src).toEqual(before);
    expect(result.model).not.toBe(src);
    expect(result.changedBindings).toHaveLength(14);
    expect(bindings.find((b) => b.id === "mouthShape")).toEqual(before.bindings.at(-1));
    for (const side of ["imageLeft", "imageRight"]) {
      const closed = bindings.find((b) => b.id === "sprite_eyes_closed_" + side + "Show")!;
      const half = bindings.find((b) => b.id === "sprite_eyes_half_" + side + "Show")!;
      expect(sample(closed.keys, 0.167)).toBe(1);
      expect(sample(half.keys, 0.167)).toBe(0);
      expect(sample(half.keys, 0.5)).toBe(1);
      expect(sample(half.keys, 0.667)).toBe(1);
      expect(sample(half.keys, 0.833)).toBe(0);
      expect(sample(closed.keys, 0.19)).toBeCloseTo(0.5, 7);
      expect(sample(half.keys, 0.19)).toBeCloseTo(0.5, 7);
      // It is a short fade, NOT a claim that transitions can never ghost.
    }
    expect(result.profile.closedToHalf).toEqual([0.18, 0.2]);
  });

  it("keeps both eyes fully hidden in drawn poses, and restores mesh outside the sprites", () => {
    const model = shortFadeDrawnEyes(fixture()).model;
    const mesh = (model.bindings as B[]).filter((b) => b.id.endsWith("UnderSprite"));
    expect(mesh).toHaveLength(10);
    for (const b of mesh) {
      expect(sample(b.keys, 0.5)).toBe(0);
      expect(sample(b.keys, 0.667)).toBe(0);
      expect(sample(b.keys, 0.7)).toBe(1);
      expect(sample(b.keys, 1)).toBe(1);
    }
  });

  it("preserves upstream multi-parameter warp bindings even though their values are not scalars", () => {
    const original = fixture();
    const warp = {
      target: "warp:avatarWarp.offsets", params: ["AngleX", "AngleY"],
      keys: [{ at: [-30, -30], value: { "264": [-0.01, 0.01] } }],
    };
    const model = { ...original, bindings: [...original.bindings, warp] };
    const before = structuredClone(model);
    const transformed = shortFadeDrawnEyes(model).model as { bindings: unknown[] };
    expect(model).toEqual(before);
    expect(transformed.bindings.at(-1)).toEqual(warp);
  });

  it("refuses a missing half-eye sprite or incomplete mesh-hide rig", () => {
    const a = fixture();
    a.bindings = a.bindings.filter((b) => b.id !== "sprite_eyes_half_imageRightShow");
    expect(() => shortFadeDrawnEyes(a)).toThrow(/half.*closed variants/);
    const b = fixture();
    b.bindings = b.bindings.filter((entry) => !entry.id.startsWith("eyeR_") || entry.id.includes("white"));
    expect(() => shortFadeDrawnEyes(b)).toThrow(/incomplete eye-mesh/);
  });

  it("refuses unknown eye smile layering, duplicate bindings or incorrect eye parameter mapping", () => {
    const smile = fixture();
    smile.bindings.push(sprite("sprite_eyes_smile_imageLeft", "EyeRSmile", 1));
    expect(() => shortFadeDrawnEyes(smile)).toThrow(/eyes_smile/);
    const duplicate = fixture();
    duplicate.bindings.push(duplicate.bindings[0]!);
    expect(() => shortFadeDrawnEyes(duplicate)).toThrow(/duplicate/);
    const mismatch = fixture();
    mismatch.bindings[0]!.params = ["EyeLOpen"];
    expect(() => shortFadeDrawnEyes(mismatch)).toThrow(/incompatible/);
  });

  it("refuses unsupported model layouts and nonstandard mesh-opacity values", () => {
    expect(() => shortFadeDrawnEyes(null)).toThrow(/invalid model/);
    expect(() => shortFadeDrawnEyes({ bindings: [] })).toThrow(/missing or incompatible/);
    const invalid = fixture();
    invalid.bindings[4]!.keys[0]!.value = 0.1;
    expect(() => shortFadeDrawnEyes(invalid)).toThrow(/nonstandard/);
  });
});

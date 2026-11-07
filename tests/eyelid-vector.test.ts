import { describe, expect, it } from "vitest";
import { vectorizeImportedEyelids } from "../src/character/eyelid-vector.js";
import { vectorEyeColorsFromLayers } from "../src/character/eyelid-vector-workflow.js";

const colors = { eyeR: "#2a1828", eyeL: "#2b1829" };
function fixture() {
  const parts: Record<string, unknown>[] = [];
  const bindings: Record<string, unknown>[] = [];
  for (const [prefix, control] of [["eyeR", "EyeROpen"], ["eyeL", "EyeLOpen"]]) {
    const x = prefix === "eyeR" ? 100 : 240;
    const top = Array.from({ length: 10 }, (_, i) => [x + i * 4, 112 - Math.sin(i * Math.PI / 9) * 9]).flat();
    const low = Array.from({ length: 10 }, (_, i) => [x + i * 4, 124 + Math.sin(i * Math.PI / 9) * 7]).flat();
    const open = [...top, ...low];
    const closed = top.flatMap((_, i) => i % 2 === 0 ? [top[i], 119] : [])
      .concat(top.flatMap((_, i) => i % 2 === 0 ? [top[i], 119] : []));
    parts.push({ id: prefix + "_white", parent: "faceWarp",
      shape: { type: "mesh", vertices: open, triangles: [] } });
    parts.push({ id: prefix + "_ball", mask: [prefix + "_white"],
      shape: { type: "image", texture: prefix + "_ball", x, y: 100, w: 50, h: 50 } });
    for (const name of ["upper", "lower", "upperRim", "lowerRim"]) {
      parts.push({ id: prefix + "_" + name, visible: true,
        shape: { type: "image", texture: prefix + "_" + name, x, y: 100, w: 50, h: 50 } });
    }
    parts.push({ id: "sprite_eyes_closed_" + (prefix === "eyeR" ? "imageLeft" : "imageRight"),
      visible: true, shape: { type: "image", texture: "closed", x, y: 100, w: 50, h: 50 } });
    bindings.push({ id: prefix + "Mask", target: "part:" + prefix + "_white.shape.vertices",
      params: [control], keys: [{ at: [0], value: closed }, { at: [1], value: open }] });
    bindings.push({ id: prefix + "_ballUnderSprite", target: "part:" + prefix + "_ball.opacity",
      params: [control], keys: [{ at: [0], value: 0 }, { at: [1], value: 1 }] });
  }
  parts.push({ id: "mouth", shape: { type: "rect", x: 1, y: 2, w: 3, h: 4 } });
  bindings.push({ id: "mouthOpen", target: "part:mouth.opacity", params: ["MouthOpen"],
    keys: [{ at: [0], value: 0 }, { at: [1], value: 1 }] });
  return { parts, bindings, meta: { width: 512, height: 640 } };
}

describe("guarded vector lash ribbons driven by an iris occlusion mask", () => {
  it("maps image-left to character-right lash color and rejects missing/unsafe metadata", () => {
    expect(vectorEyeColorsFromLayers({ eyes: {
      imageLeft: { colors: { lash: "#2a1828" } },
      imageRight: { colors: { lash: "#2b1829" } },
    }})).toEqual(colors);
    expect(() => vectorEyeColorsFromLayers({ eyes: {
      imageLeft: { colors: { lash: "../../unsafe" } },
      imageRight: { colors: { lash: "#2b1829" } },
    }})).toThrow(/valid lash colors/);
    expect(() => vectorEyeColorsFromLayers({})).toThrow(/valid lash colors/);
  });

  it("creates four deformable strips and preserves the source, non-eye controls and textures", () => {
    const raw = fixture();
    const original = structuredClone(raw);
    const result = vectorizeImportedEyelids(raw, colors);
    expect(raw).toEqual(original);
    expect(result.newPartIds).toEqual([
      "eyeR_vector_upper", "eyeR_vector_lower",
      "eyeL_vector_upper", "eyeL_vector_lower",
    ]);
    const model = result.model as ReturnType<typeof fixture>;
    expect(model.parts.find(p => p.id === "mouth")).toEqual(original.parts.find(p => p.id === "mouth"));
    expect(model.bindings.find(p => p.id === "mouthOpen")).toEqual(original.bindings.find(p => p.id === "mouthOpen"));
    const upper = model.parts.find(p => p.id === "eyeR_vector_upper")!;
    expect(upper.fill).toBe(colors.eyeR);
    expect(upper.shape).toMatchObject({ type: "mesh" });
    const curve = model.bindings.find(p => p.id === "eyeR_vector_upperVertices")!;
    expect(curve.keys).toHaveLength(2);
    expect(model.parts.find(p => p.id === "eyeR_upper")?.visible).toBe(false);
    expect(model.parts.find(p => p.id === "sprite_eyes_closed_imageLeft")?.visible).toBe(false);
    expect((model.bindings.find(p => p.id === "eyeR_ballUnderSprite")?.keys as {value: number}[])
      .map(x => x.value)).toEqual([1, 1]);
  });

  it("matches mask top/bottom at closed EyeOpen so upper and lower join", () => {
    const model = vectorizeImportedEyelids(fixture(), colors).model as ReturnType<typeof fixture>;
    for (const side of ["eyeR", "eyeL"]) {
      const up = model.bindings.find(b => b.id === side + "_vector_upperVertices")!;
      const lo = model.bindings.find(b => b.id === side + "_vector_lowerVertices")!;
      const a = (up.keys as {value: number[]}[])[0]!.value;
      const b = (lo.keys as {value: number[]}[])[0]!.value;
      // The two bands share the exact same centerline, at every one of ten x points.
      for (let i = 0; i < a.length; i += 4) {
        expect((a[i + 1]! + a[i + 3]!) / 2).toBeCloseTo((b[i + 1]! + b[i + 3]!) / 2, 8);
      }
    }
  });

  it("refuses reapplication, smile sprites, foreign eye hide bindings and missing lower eyelid", () => {
    const already = vectorizeImportedEyelids(fixture(), colors);
    expect(() => vectorizeImportedEyelids(already.model, colors))
      .toThrow(/already vectorized|Already vectorized/i);
    const smile = fixture();
    smile.parts.push({ id: "sprite_eyes_smile_imageLeft", shape: { type: "image" } });
    expect(() => vectorizeImportedEyelids(smile, colors)).toThrow(/smiling eye/i);
    const hide = fixture();
    hide.bindings.push({ id: "eyeR_crazyUnderSprite", target: "part:x.opacity",
      keys: [{ at: [0], value: 0 }, { at: [1], value: 1 }] });
    expect(() => vectorizeImportedEyelids(hide, colors)).toThrow(/Unexpected sprite-hide/);
    const missing = fixture();
    missing.parts = missing.parts.filter(p => p.id !== "eyeL_lower");
    expect(() => vectorizeImportedEyelids(missing, colors)).toThrow(/Missing or incompatible/);
    const unclipped = fixture();
    unclipped.parts.find(p => p.id === "eyeR_ball")!.mask = [];
    expect(() => vectorizeImportedEyelids(unclipped, colors)).toThrow(/Missing or incompatible/);
  });

  it("rejects a malformed mask and invalid lash palette before output", () => {
    const flipped = fixture();
    const mask = flipped.bindings.find(b => b.id === "eyeRMask")!;
    const vertices = (mask.keys as { value: number[] }[])[1]!.value;
    vertices[2] = vertices[0] - 5;
    expect(() => vectorizeImportedEyelids(flipped, colors)).toThrow(/strictly increasing/);
    expect(() => vectorizeImportedEyelids(fixture(), { ...colors, eyeR: "transparent" }))
      .toThrow(/fully opaque/);
    const impossible = fixture();
    const bad = impossible.bindings.find(b => b.id === "eyeLMask")!;
    (bad.keys as {value: number[]}[])[0]!.value[1] += 50;
    expect(() => vectorizeImportedEyelids(impossible, colors)).toThrow(/converge cleanly/);
  });
});

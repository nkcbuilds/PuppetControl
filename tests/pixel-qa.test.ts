import { describe, expect, it } from "vitest";
import { compareRgbaPixels, parsePixelRegionArgument } from "../src/character/pixel-qa.js";

function solid(width: number, height: number, rgba: [number, number, number, number]): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) bytes.set(rgba, i * 4);
  return bytes;
}

describe("pixel-level image comparison is deterministic triage, not automatic approval", () => {
  it("compares identical pixels without invented motion or border gaps", () => {
    const reference = solid(4, 3, [20, 40, 60, 255]);
    const result = compareRgbaPixels(reference, reference, 4, 3);
    expect(result).toMatchObject({
      comparedPixels: 12, ignoredTransparentPixels: 0,
      rgbMeanAbsoluteError: 0, changedPixels: 0, changedFraction: 0,
      unexpectedTransparentBorderPixels: 0,
    });
    expect(result.note).toMatch(/visually inspect/i);
  });

  it("measures region-specific RGB change without counting unaffected pixels", () => {
    const reference = solid(3, 3, [10, 20, 30, 255]);
    const changed = reference.slice();
    const center = (1 * 3 + 1) * 4;
    changed[center] = 100;
    const full = compareRgbaPixels(reference, changed, 3, 3);
    expect(full.changedPixels).toBe(1);
    expect(full.rgbMeanAbsoluteError).toBeCloseTo(90 / (9 * 3), 3);
    const crop = compareRgbaPixels(reference, changed, 3, 3,
      { x: 1, y: 1, width: 1, height: 1 });
    expect(crop.changedFraction).toBe(1);
    expect(crop.rgbMeanAbsoluteError).toBe(30);
  });

  it("ignores fully transparent RGB noise and finds new opaque-border holes", () => {
    const reference = solid(3, 3, [100, 120, 140, 255]);
    const candidate = reference.slice();
    // Reference-opaque top-left corner becomes transparent.
    candidate[3] = 0;
    // Fully transparent center has arbitrary irrelevant RGB values.
    const emptyReference = solid(2, 2, [12, 0, 0, 0]);
    const emptyCandidate = solid(2, 2, [250, 180, 160, 0]);
    const transparent = compareRgbaPixels(emptyReference, emptyCandidate, 2, 2);
    expect(transparent.comparedPixels).toBe(0);
    expect(transparent.ignoredTransparentPixels).toBe(4);
    expect(transparent.changedPixels).toBe(0);
    expect(compareRgbaPixels(reference, candidate, 3, 3).unexpectedTransparentBorderPixels).toBe(1);
  });

  it("does not double-count corners or single-row/single-column borders", () => {
    const ref = solid(1, 3, [3, 4, 5, 255]);
    const result = compareRgbaPixels(ref, solid(1, 3, [3, 4, 5, 0]), 1, 3);
    expect(result.unexpectedTransparentBorderPixels).toBe(3);
    const flat = compareRgbaPixels(solid(3, 1, [0, 0, 0, 255]),
      solid(3, 1, [0, 0, 0, 0]), 3, 1);
    expect(flat.unexpectedTransparentBorderPixels).toBe(3);
  });

  it("parses strict CLI region syntax and rejects malformed values", () => {
    expect(parsePixelRegionArgument("175,220,170,75"))
      .toEqual({ x: 175, y: 220, width: 170, height: 75 });
    for (const bad of ["0,0,0,1", "-1,0,1,1", "2,3,4", "1.5,0,1,1", "1,2,3,4junk", "1,2,3,9999999999999999999"]) {
      expect(() => parsePixelRegionArgument(bad)).toThrowError(/region/i);
    }
  });

  it("rejects wrong pixel lengths, unsafe sizes and ROIs", () => {
    const img = solid(2, 2, [0, 0, 0, 255]);
    expect(() => compareRgbaPixels(img, img.slice(0, 8), 2, 2))
      .toThrowError(/matching RGBA/);
    expect(() => compareRgbaPixels(img, img, 2, 2, { x: 1, y: 1, width: 2, height: 2 }))
      .toThrowError(/rectangle/);
    expect(() => compareRgbaPixels(img, img, 2, 2, { x: 0, y: 0, width: 0, height: 1 }))
      .toThrowError(/rectangle/);
    expect(() => compareRgbaPixels(img, img, Infinity, 2))
      .toThrowError(/bounded dimensions/);
  });
});

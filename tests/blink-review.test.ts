import { describe, expect, it } from "vitest";
import {
  BLINK_CLOSING_VALUES, BLINK_REVIEW_VALUES, eyeRegionFromAvatarSpec,
} from "../src/character/blink-review.js";

describe("non-approving imported-avatar blink review", () => {
  it("samples critical sprite transition boundaries without skipping 0.19 or 0.69", () => {
    expect(BLINK_CLOSING_VALUES).toContain(0.19);
    expect(BLINK_CLOSING_VALUES).toContain(0.69);
    expect(BLINK_CLOSING_VALUES).toContain(0.18);
    expect(BLINK_CLOSING_VALUES).toContain(0.68);
    expect(BLINK_CLOSING_VALUES[0]).toBe(1);
    expect(BLINK_CLOSING_VALUES.at(-1)).toBe(0);
  });

  it("mirrors every closing sample into reopening and returns to its starting value", () => {
    expect(BLINK_REVIEW_VALUES).toHaveLength(BLINK_CLOSING_VALUES.length * 2 - 1);
    expect(BLINK_REVIEW_VALUES.at(-1)).toBe(1);
    for (let i = 0; i < BLINK_REVIEW_VALUES.length; i++) {
      expect(BLINK_REVIEW_VALUES[i]).toBe(BLINK_REVIEW_VALUES.at(-1 - i));
    }
  });

  it("derives a padded crop containing both iris/eyelid regions", () => {
    const spec = { face: { eyes: {
      imageLeft: { opening: [165, 206, 202, 202, 205, 225, 160, 230] },
      imageRight: { opening: [305, 210, 346, 208, 349, 227, 302, 232] },
    } } };
    const region = eyeRegionFromAvatarSpec(spec, 512, 640);
    expect(region.x).toBeLessThan(160);
    expect(region.y).toBeLessThan(200);
    expect(region.x + region.width).toBeGreaterThan(349);
    expect(region.y + region.height).toBeGreaterThan(232);
  });

  it("refuses to guess when eyes cannot be located", () => {
    expect(() => eyeRegionFromAvatarSpec({}, 512, 640))
      .toThrow(/--region/);
    expect(() => eyeRegionFromAvatarSpec({
      face: { eyes: { imageLeft: { opening: [0, 1, 2, 3, 4, 5, 6, 7] } } },
    }, 512, 640)).toThrow(/--region/);
  });
});

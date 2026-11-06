import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assessAvatarGeometry } from "../src/character/geometry-quality.js";

const good = JSON.parse(readFileSync("examples/avatar-import/hana-landmarks.json", "utf8")) as Record<string, unknown>;

describe("facial and body landmark geometry triage", () => {
  it("does not flag the manually validated Hana reference geometry", () => {
    expect(assessAvatarGeometry(good)).toEqual([]);
  });

  it("flags a body pivot placed at the bottom of the illustration", () => {
    const broken = structuredClone(good) as any;
    broken.body.pivot = [256, 628];
    broken.body.fade = [602, 640];
    const warnings = assessAvatarGeometry(broken);
    expect(warnings.map((warning) => warning.code)).toContain("BODY_PIVOT_TOO_LOW");
    expect(warnings.map((warning) => warning.code)).toContain("BODY_FADE_TOO_LOW");
  });

  it("flags missing iris geometry and impossible iris centers", () => {
    const broken = structuredClone(good) as any;
    delete broken.face.eyes.imageLeft.iris;
    broken.face.eyes.imageRight.iris.center = [0, 0];
    const codes = assessAvatarGeometry(broken).map((warning) => warning.code);
    expect(codes).toContain("IRIS_LANDMARK_MISSING");
    expect(codes).toContain("IRIS_OUTSIDE_EYE");
  });

  it("flags below-band head tilt pivots", () => {
    const broken = structuredClone(good) as any;
    broken.head.pivot = [256, 530];
    expect(assessAvatarGeometry(broken).map((warning) => warning.code))
      .toContain("HEAD_PIVOT_BELOW_NECK");
  });

  it("does not crash on partial or malformed agent suggestions", () => {
    expect(assessAvatarGeometry(null)).toEqual([]);
    expect(assessAvatarGeometry({ face: { eyes: {} } }).map((warning) => warning.code))
      .toContain("IRIS_LANDMARK_MISSING");
    expect(assessAvatarGeometry({
      face: { eyes: { imageLeft: { iris: { center: "not a point", radius: ["x"] } } } },
    }).length).toBeGreaterThan(0);
  });
});

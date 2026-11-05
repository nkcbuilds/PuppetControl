import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadAndValidateScene } from "../src/scene/load.js";
import { planPoseTimeline } from "../src/animation/pose-timeline.js";
import { compilePerformance } from "../src/render/scene-plan.js";

const fixture = resolve("examples/scenes/hana-gesture-1080p.json");
const sharedParameters = new Map([
  ["ArmRaise", 0],
  ["MouthForm", 0],
  ["Cheek", 0],
  ["BrowLY", 0],
  ["BrowRY", 0],
  ["AngleX", 0],
  ["AngleY", 0],
  ["EyeBallX", 0],
  ["EyeBallY", 0],
]);
const crossedParameters = new Map([...sharedParameters].filter(([name]) => name !== "ArmRaise"));

describe("continuous same-rig pose performance", () => {
  it("plans a sampled geometric interpolation instead of an edited cut", async () => {
    const result = await loadAndValidateScene(fixture);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const actor = result.characters.get("hana")!;
    const plan = planPoseTimeline(result.scene, actor, "hana");
    expect(plan.segments.map((segment) => [
      segment.kind,
      segment.kind === "pose" ? segment.pose : segment.mode,
      segment.startFrame,
      segment.endFrame,
    ])).toEqual([
      ["pose", "neutral", 0, 60],
      ["transition", "interpolate", 60, 69],
      ["pose", "pointing", 69, 126],
      ["pose", "arms-crossed", 126, 195],
    ]);
    const transition = plan.transitions.find((item) => item.decision.to === "pointing");
    expect(transition?.decision.mode).toBe("interpolate");
    expect(transition?.decision.durationMs).toBe(300);
  });

  it("adds parameter curves to move an arm through intermediate geometry", async () => {
    const result = await loadAndValidateScene(fixture);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const actor = result.characters.get("hana")!;
    const performance = compilePerformance(result.scene, actor, "hana", sharedParameters, undefined, {
      allowExternalPoseFamilies: true,
      currentModelPath: "rigs/gesture.r2d.json",
    });
    const arm = performance.tracks.find((track) => track.target === "param:ArmRaise");
    expect(arm?.keys).toEqual([
      { t: 0, v: 0, ease: "inOutSine" },
      { t: 0.3, v: 0 },
      { t: 2, v: 0, ease: "inOutSine" },
      { t: 2.3, v: 1 },
      { t: 6.5, v: 1 },
    ]);
  });

  it("does not apply gesture-only ArmRaise controls to the crossed-arms rig", async () => {
    const result = await loadAndValidateScene(fixture);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const actor = result.characters.get("hana")!;
    const performance = compilePerformance(result.scene, actor, "hana", crossedParameters, undefined, {
      allowExternalPoseFamilies: true,
      currentModelPath: "rigs/arms-crossed.r2d.json",
    });
    expect(performance.tracks.some((track) => track.target === "param:ArmRaise")).toBe(false);
  });

  it("fails if a relevant pose preset targets nonexistent geometry controls", async () => {
    const result = await loadAndValidateScene(fixture);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const actor = structuredClone(result.characters.get("hana")!);
    actor.render!.posePresets!.pointing["MissingArmControl"] = 1;
    expect(() => compilePerformance(result.scene, actor, "hana", sharedParameters, undefined, {
      allowExternalPoseFamilies: true,
      currentModelPath: "rigs/gesture.r2d.json",
    })).toThrow(/Pose control not in rig/);
  });
});

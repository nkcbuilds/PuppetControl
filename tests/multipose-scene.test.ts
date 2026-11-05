import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadAndValidateScene } from "../src/scene/load.js";
import { planPoseTimeline } from "../src/animation/pose-timeline.js";
import { renderRev2DFrames } from "../src/render/rev2d.js";
import { sceneSchema } from "../src/scene/schemas.js";

describe("multi-pose scene contract", () => {
  it("plans real, distinct rig files and exact hard-cut boundaries", async () => {
    const result = await loadAndValidateScene(resolve("examples/scenes/hana-multipose.json"));
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const actor = result.characters.get("hana")!;
    expect(actor.poseFamilies.map((p) => p.modelPath)).toEqual([
      "rigs/neutral.r2d.json",
      "rigs/pointing.r2d.json",
      "rigs/arms-crossed.r2d.json",
    ]);
    expect(new Set(actor.poseFamilies.map((p) => p.rigId)).size).toBe(3);

    const plan = planPoseTimeline(result.scene, actor, "hana");
    expect(plan.segments.map((segment) => [segment.kind, segment.kind === "pose" ? segment.pose : "transition", segment.startFrame, segment.endFrame]))
      .toEqual([
        ["pose", "neutral", 0, 30],
        ["pose", "pointing", 30, 63],
        ["pose", "arms-crossed", 63, 98],
      ]);
    expect(plan.transitions.filter((point) => point.decision.mode === "cut").map((point) => point.frame))
      .toEqual([30, 63]);
  });

  it("will not silently render a bridge as a cut if the rig is unavailable", async () => {
    const loaded = await loadAndValidateScene(resolve("examples/scenes/hana-multipose.json"));
    expect(loaded.valid).toBe(true);
    if (!loaded.valid) return;
    const actor = structuredClone(loaded.characters.get("hana")!);
    // Explicit bridge preferred; if bridge isn't implemented, preview must fail.
    actor.transitions = actor.transitions.filter((item) => !(item.from === "neutral" && item.to === "pointing"));
    actor.transitions.push({
      kind: "bridge", from: "neutral", to: "pointing",
      clip: "not-yet-implemented.anim", durationMs: 500,
    });
    const scene = sceneSchema.parse({
      ...loaded.scene,
      events: loaded.scene.events.map((event) => event.kind === "pose" && event.name === "pointing"
        ? { ...event, transition: "bridge" as const }
        : event),
    });
    await expect(renderRev2DFrames(
      scene, actor,
      resolve("examples/characters/hana/character-poses.json"),
      "hana", resolve(".cache/missing-render-test"),
      resolve("examples/scenes/hana-multipose.json"),
    )).rejects.toMatchObject({ code: "BRIDGE_RENDER_NOT_IMPLEMENTED" });
  });

  it("requires a literal camera-cut event at the same timestamp", async () => {
    const loaded = await loadAndValidateScene(resolve("examples/scenes/hana-multipose.json"));
    expect(loaded.valid).toBe(true);
    if (!loaded.valid) return;
    const scene = sceneSchema.parse({
      ...loaded.scene,
      events: loaded.scene.events.filter((event) => !(event.kind === "camera" && event.name === "cut")),
    });
    expect(() => planPoseTimeline(scene, loaded.characters.get("hana"), "hana"))
      .toThrow(/unsupported/i);
  });
});

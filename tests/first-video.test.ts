import { describe, expect, it } from "vitest";
import { createFirstVideoScene } from "../src/scene/first-video.js";
import { characterSchema, type Character, type SceneEvent } from "../src/scene/schemas.js";

function character(approved = true): Character {
  return characterSchema.parse({
    schemaVersion: 1, id: "hana", defaultPose: "neutral",
    poseFamilies: [{ name: "neutral", rigId: "hana-test", approved, head: "shared" }],
    expressions: ["neutral", "happy", "confused"],
    motions: [], transitions: [],
    render: { backend: "rev2d", modelPath: "hana.r2d.json",
      expressionPresets: { neutral: {}, happy: { MouthForm: 0.6 }, confused: { MouthForm: -0.4 } },
    },
  });
}
const base = {
  id: "first-video", actorId: "hana", characterPath: "./character.json",
  durationMs: 10_000, fps: 24, resolution: { width: 512, height: 640 },
};

describe("usable first-video scene composition", () => {
  it("creates a supported strict 10-second scene, reusable without mutating the character", () => {
    const actor = character();
    const before = JSON.stringify(actor);
    const one = createFirstVideoScene(actor, base);
    const two = createFirstVideoScene(actor, { ...base, id: "second-scene" });
    expect(one.id).toBe("first-video");
    expect(two.id).toBe("second-scene");
    expect(one.actors[0]?.characterPath).toBe(two.actors[0]?.characterPath);
    expect(one.events.some((event) => event.kind === "expression")).toBe(true);
    expect(one.events.some((event) => event.kind === "look")).toBe(true);
    expect(one.events.every((event) => event.atMs < one.durationMs)).toBe(true);
    expect(JSON.stringify(actor)).toBe(before);
  });

  it("enforces explicit reviewed pose and refuses unsupported actions", () => {
    expect(() => createFirstVideoScene(character(false), base))
      .toThrow(/approve/i);
    const bad: SceneEvent[] = [
      { kind: "caption", atMs: 1000, text: "not yet", durationMs: 700 },
    ];
    expect(() => createFirstVideoScene(character(), { ...base, events: bad }))
      .toThrow(/support/i);
    const motion: SceneEvent[] = [
      { kind: "motion", atMs: 1000, actor: "hana", name: "jump", intensity: 1 },
    ];
    expect(() => createFirstVideoScene(character(), { ...base, events: motion }))
      .toThrow(/support/i);
  });

  it("validates explicit expressions, timing, IDs and voice cue paths", () => {
    const wrong: SceneEvent[] = [
      { kind: "expression", atMs: 2000, actor: "hana", name: "invisible", intensity: 0.5 },
    ];
    expect(() => createFirstVideoScene(character(), { ...base, events: wrong }))
      .toThrow(/not supported|UNSUPPORTED_EXPRESSION/i);
    expect(() => createFirstVideoScene(character(), { ...base, fps: 0 }))
      .toThrow(/duration|FPS/i);
    expect(() => createFirstVideoScene(character(), { ...base, durationMs: 61_000 }))
      .toThrow(/duration/i);
    expect(() => createFirstVideoScene(character(), { ...base, id: "../../bad" }))
      .toThrow(/scene/i);
    const voice = createFirstVideoScene(character(), {
      ...base, audio: { path: "./voice.wav", cuesPath: "./mouth.json", startMs: 0 },
    });
    expect(voice.audio).toEqual([{ actor: "hana", path: "./voice.wav", cuesPath: "./mouth.json", startMs: 0 }]);
    expect(() => createFirstVideoScene(character(), {
      ...base, audio: { path: "./voice.wav", cuesPath: "", startMs: 0 },
    })).toThrow();
  });

  it("does not fabricate facial expressions for a rig that only supports neutral", () => {
    const actor = character();
    actor.expressions = ["neutral"];
    actor.render!.expressionPresets = { neutral: {} };
    const scene = createFirstVideoScene(actor, base);
    expect(scene.events.filter((event) => event.kind === "expression")).toHaveLength(0);
  });
});

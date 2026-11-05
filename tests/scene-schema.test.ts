import { describe, expect, it } from "vitest";
import { characterSchema, sceneSchema } from "../src/scene/schemas.js";

const baseScene = {
  schemaVersion: 1,
  id: "demo",
  durationMs: 6000,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  actors: [{ id: "maya", characterPath: "maya.json" }],
  events: [],
};

describe("scene schema", () => {
  it("accepts a strict valid timeline", () => {
    const parsed = sceneSchema.parse({
      ...baseScene,
      events: [
        { atMs: 1200, kind: "expression", actor: "maya", name: "annoyed", intensity: 0.4 },
        { atMs: 2000, kind: "pose", actor: "maya", name: "pointing" },
      ],
    });
    expect(parsed.events[1]).toMatchObject({ transition: "auto" });
  });

  it("rejects unknown commands, invalid intensity and extra unexpected fields", () => {
    expect(sceneSchema.safeParse({
      ...baseScene,
      events: [{ atMs: 50, kind: "launch-missiles", actor: "maya" }],
    }).success).toBe(false);
    expect(sceneSchema.safeParse({
      ...baseScene,
      events: [{ atMs: 50, kind: "expression", name: "happy", actor: "maya", intensity: 5 }],
    }).success).toBe(false);
    expect(sceneSchema.safeParse({ ...baseScene, silentFailure: true }).success).toBe(false);
  });

  it("rejects events outside the scene or duplicate actors", () => {
    expect(sceneSchema.safeParse({
      ...baseScene,
      events: [{ atMs: 6000, kind: "camera", name: "medium" }],
    }).success).toBe(false);
    expect(sceneSchema.safeParse({
      ...baseScene,
      actors: [baseScene.actors[0], baseScene.actors[0]],
    }).success).toBe(false);
  });

  it("rejects a character with duplicate pose family names", () => {
    expect(characterSchema.safeParse({
      schemaVersion: 1,
      id: "maya",
      defaultPose: "neutral",
      poseFamilies: [
        { name: "neutral", rigId: "base", approved: true },
        { name: "neutral", rigId: "base", approved: true },
      ],
      expressions: ["neutral"],
    }).success).toBe(false);
  });
});

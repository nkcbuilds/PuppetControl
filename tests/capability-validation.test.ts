import { describe, expect, it } from "vitest";
import { characterSchema, sceneSchema } from "../src/scene/schemas.js";
import { validateSceneCapabilities } from "../src/scene/validate.js";

const actor = characterSchema.parse({
  schemaVersion: 1,
  id: "maya",
  defaultPose: "neutral",
  poseFamilies: [
    { name: "neutral", rigId: "base", approved: true },
    { name: "pointing", rigId: "base", approved: true },
    { name: "crossed", rigId: "cross", approved: true },
  ],
  expressions: ["neutral", "confused"],
  motions: ["nod"],
  transitions: [],
});

const core = {
  schemaVersion: 1,
  id: "intro",
  durationMs: 8000,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  actors: [{ id: "maya", characterPath: "maya.json" }],
};

const characters = new Map([["maya", actor]]);

describe("scene capability validator", () => {
  it("reports unsupported pose and expression requests", () => {
    const scene = sceneSchema.parse({
      ...core,
      events: [
        { atMs: 200, kind: "pose", actor: "maya", name: "flying" },
        { atMs: 500, kind: "expression", actor: "maya", name: "furious" },
        { atMs: 700, kind: "motion", actor: "maya", name: "handstand" },
      ],
    });
    expect(validateSceneCapabilities(scene, characters).diagnostics.map((d) => d.code)).toEqual([
      "UNSUPPORTED_POSE", "UNSUPPORTED_EXPRESSION", "UNSUPPORTED_MOTION",
    ]);
  });

  it("requires a real camera cut event at the transition timestamp", () => {
    const scene = sceneSchema.parse({
      ...core,
      allowCameraCuts: true,
      events: [{ atMs: 900, kind: "pose", actor: "maya", name: "crossed" }],
    });
    expect(validateSceneCapabilities(scene, characters)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "TRANSITION_UNSUPPORTED" }],
    });

    const repaired = sceneSchema.parse({
      ...core,
      allowCameraCuts: true,
      events: [
        { atMs: 900, kind: "camera", name: "cut" },
        { atMs: 900, kind: "pose", actor: "maya", name: "crossed" },
      ],
    });
    const validation = validateSceneCapabilities(repaired, characters);
    expect(validation.valid).toBe(true);
    expect(validation.diagnostics[0]?.code).toBe("CUT_REQUIRED");
    expect(validation.transitions[0]?.mode).toBe("cut");
  });

  it("supports out-of-order events by sorting before tracking pose state", () => {
    const scene = sceneSchema.parse({
      ...core,
      events: [
        { atMs: 2000, kind: "pose", actor: "maya", name: "neutral" },
        { atMs: 1000, kind: "pose", actor: "maya", name: "pointing" },
      ],
    });
    const validation = validateSceneCapabilities(scene, characters);
    expect(validation.valid).toBe(true);
    expect(validation.transitions.map((decision) => decision.from + "->" + decision.to))
      .toEqual(["neutral->pointing", "pointing->neutral"]);
  });

  it("rejects actor references not in the scene", () => {
    const scene = sceneSchema.parse({
      ...core,
      events: [{ atMs: 500, kind: "motion", actor: "alex", name: "nod" }],
    });
    expect(validateSceneCapabilities(scene, characters).diagnostics[0]?.code).toBe("UNKNOWN_ACTOR");
  });
});

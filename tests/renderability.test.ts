import { describe, expect, it } from "vitest";
import { characterSchema, sceneSchema } from "../src/scene/schemas.js";
import { checkSceneRenderability } from "../src/render/renderability.js";

const actor = characterSchema.parse({
  schemaVersion: 1, id: "person", defaultPose: "neutral",
  poseFamilies: [{ name: "neutral", rigId: "rig", approved: true, head: "shared" }],
  expressions: ["neutral"], motions: ["wave"], transitions: [],
  render: { backend: "rev2d", modelPath: "rig.r2d.json",
    expressionPresets: { neutral: {} } },
});

const base = {
  schemaVersion: 1, id: "clip", durationMs: 3000, fps: 15,
  resolution: { width: 512, height: 640 },
  actors: [{ id: "person", characterPath: "./character.json" }],
  audio: [], allowCameraCuts: false, events: [],
};

const asScene = (patch: Record<string, unknown> = {}) => sceneSchema.parse({ ...base, ...patch });
const loaded = new Map([["person", actor]]);

describe("strict MP4 renderability preflight", () => {
  it("accepts a simple supported single-rig actor scene", () => {
    expect(checkSceneRenderability(asScene(), loaded)).toEqual({ valid: true, diagnostics: [] });
  });
  it("refuses audio without required lip-cue mapping", () => {
    const result = checkSceneRenderability(asScene({
      audio: [{ path: "voice.wav", startMs: 0, actor: "person" }],
    }), loaded);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("LIP_CUES_REQUIRED");
  });
  it("refuses a caption and declared motion even when general schema permits them", () => {
    const result = checkSceneRenderability(asScene({
      events: [
        { kind: "caption", atMs: 0, text: "Title", durationMs: 500 },
        { kind: "motion", atMs: 1000, actor: "person", name: "wave" },
      ],
    }), loaded);
    expect(result.diagnostics.map((d) => d.code))
      .toEqual(["COMPOSITION_NOT_IMPLEMENTED", "MOTION_NOT_IMPLEMENTED"]);
  });
  it("refuses multiple actors because the current renderer can only draw one", () => {
    const result = checkSceneRenderability(asScene({
      actors: [{ id: "person", characterPath: "./character.json" },
        { id: "other", characterPath: "./other.json" }],
    }), new Map([["person", actor], ["other", actor]]));
    expect(result.diagnostics.some((d) => d.code === "MULTI_ACTOR_UNSUPPORTED")).toBe(true);
  });
  it("detects a bridge that is plan-valid but cannot be rendered", () => {
    const alternative = characterSchema.parse({
      ...actor,
      poseFamilies: [
        { name: "neutral", rigId: "rig", approved: true, head: "shared", modelPath: "rig.r2d.json" },
        { name: "folded", rigId: "folded-rig", approved: true, head: "shared", modelPath: "folded.r2d.json" },
      ],
      transitions: [{ kind: "bridge", from: "neutral", to: "folded", clip: "folded-bridge.anim", durationMs: 250 }],
    });
    const result = checkSceneRenderability(asScene({
      events: [{ kind: "pose", atMs: 500, actor: "person", name: "folded", transition: "bridge" }],
    }), new Map([["person", alternative]]));
    expect(result.diagnostics.some((d) => d.code === "BRIDGE_RENDER_NOT_IMPLEMENTED")).toBe(true);
  });
});

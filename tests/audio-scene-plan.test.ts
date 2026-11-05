import { describe, expect, it } from "vitest";
import { characterSchema, sceneSchema } from "../src/scene/schemas.js";
import { compilePerformance, PreviewUnsupportedError } from "../src/render/scene-plan.js";

const actor = characterSchema.parse({
  schemaVersion: 1,
  id: "hana",
  defaultPose: "neutral",
  poseFamilies: [{ name: "neutral", rigId: "base", approved: true }],
  expressions: ["neutral", "happy"],
  render: {
    backend: "rev2d",
    modelPath: "hana.r2d.json",
    expressionPresets: {
      neutral: { MouthForm: 0, Cheek: 0 },
      happy: { MouthForm: 0.9, Cheek: 0.4 },
    },
  },
});
const defaults = new Map([["MouthOpen", 0], ["MouthForm", 0], ["Cheek", 0]]);
const scene = sceneSchema.parse({
  schemaVersion: 1,
  id: "voice-demo",
  durationMs: 2000,
  fps: 30,
  resolution: { width: 512, height: 640 },
  actors: [{ id: "hana", characterPath: "hana.json" }],
  audio: [{ path: "voice.wav", startMs: 500, actor: "hana", cuesPath: "voice.json" }],
  events: [{ atMs: 250, actor: "hana", kind: "expression", name: "happy" }],
});
const cues = [
  { start: 0, end: 0.1, value: "X" as const },
  { start: 0.1, end: 0.4, value: "C" as const },
  { start: 0.4, end: 0.5, value: "X" as const },
];

describe("voice integration into the performance plan", () => {
  it("delays mouth cues relative to audio and overrides emotion mouth only", () => {
    const animation = compilePerformance(scene, actor, "hana", defaults, { cues, startMs: 500 });
    const tracks = new Map(animation.tracks.map((track) => [track.target, track.keys]));
    const mouth = tracks.get("param:MouthOpen") ?? [];
    const mouthForm = tracks.get("param:MouthForm") ?? [];
    const cheek = tracks.get("param:Cheek") ?? [];

    expect(mouth[0]?.t).toBe(0);
    expect(mouth.some((key) => key.t > 0.58 && key.t < 0.95 && key.v > 0.3)).toBe(true);
    expect(mouth[mouth.length - 1]).toMatchObject({ t: 2, v: 0 });
    expect(mouthForm[mouthForm.length - 1]?.v).toBe(0);
    expect(cheek.some((key) => key.v === 0.4)).toBe(true);
    expect(animation.tracks.filter((track) => track.target === "param:MouthForm")).toHaveLength(1);
  });

  it("fails if a voiced scene lacks precomputed cues", () => {
    expect(() => compilePerformance(scene, actor, "hana", defaults)).toThrowError(PreviewUnsupportedError);
  });
});

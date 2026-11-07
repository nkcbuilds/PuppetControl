import { describe, expect, it } from "vitest";
import { characterSchema, sceneSchema } from "../src/scene/schemas.js";
import { compilePerformance, PreviewUnsupportedError } from "../src/render/scene-plan.js";

const actor = characterSchema.parse({
  schemaVersion: 1,
  id: "hana",
  defaultPose: "neutral",
  poseFamilies: [
    { name: "neutral", rigId: "main", approved: true },
    { name: "crossed", rigId: "crossed", approved: true },
  ],
  expressions: ["neutral", "happy"],
  render: {
    backend: "rev2d",
    modelPath: "example.r2d.json",
    expressionPresets: {
      neutral: { MouthForm: 0 },
      happy: { MouthForm: 0.8 },
    },
  },
});

const defaultRig = new Map([
  ["AngleX", 0], ["AngleY", 0], ["EyeBallX", 0],
  ["EyeBallY", 0], ["MouthForm", 0],
]);

function build(events: unknown[]) {
  return sceneSchema.parse({
    schemaVersion: 1,
    id: "demo",
    durationMs: 4000,
    fps: 15,
    resolution: { width: 512, height: 640 },
    actors: [{ id: "hana", characterPath: "hana.json" }],
    events,
  });
}

describe("performance compiler (one rig)", () => {
  it("generates eased curves for look and expression rather than frame jumps", () => {
    const animation = compilePerformance(build([
      { atMs: 200, actor: "hana", kind: "look", x: 0.5, y: 0.25, durationMs: 400 },
      { atMs: 1000, actor: "hana", kind: "expression", name: "happy", intensity: 0.75 },
    ]), actor, "hana", defaultRig);
    expect(animation.id).toBe("puppetcontrol_performance");
    const tracks = new Map(animation.tracks.map((t) => [t.target, t.keys]));
    expect(tracks.get("param:AngleX")).toEqual([
      { t: 0, v: 0 },
      { t: 0.2, v: 0, ease: "inOutSine" },
      { t: 0.6, v: 11 },
      { t: 4, v: 11 },
    ]);
    expect(tracks.get("param:MouthForm")).toEqual([
      { t: 0, v: 0 },
      { t: 1, v: 0, ease: "inOutSine" },
      { t: 1.28, v: 0.6000000000000001 },
      { t: 4, v: 0.6000000000000001 },
    ]);
  });

  it("keeps legacy look amplitude for existing layered characters", () => {
    const animation = compilePerformance(build([
      { atMs: 200, actor: "hana", kind: "look", x: 1, y: -1, durationMs: 400 },
    ]), actor, "hana", defaultRig);
    const values = new Map(animation.tracks.map((track) =>
      [track.target, track.keys.find((key) => key.t === 0.6)?.v]));
    expect(values.get("param:AngleX")).toBe(22);
    expect(values.get("param:AngleY")).toBe(12);
    expect(values.get("param:EyeBallX")).toBe(0.5);
    expect(values.get("param:EyeBallY")).toBe(0.5);
  });

  it("restrains look for legacy flat-image imports even without a new manifest field", () => {
    const imported = characterSchema.parse({
      ...actor, provenance: { file: "avatar-build.json" },
    });
    const animation = compilePerformance(build([
      { atMs: 200, actor: "hana", kind: "look", x: 1, y: -1, durationMs: 400 },
    ]), imported, "hana", defaultRig);
    const values = new Map(animation.tracks.map((track) =>
      [track.target, track.keys.find((key) => key.t === 0.6)?.v]));
    expect(values.get("param:AngleX")).toBe(8);
    expect(values.get("param:AngleY")).toBe(5);
    expect(values.get("param:EyeBallX")).toBe(0.2);
    expect(values.get("param:EyeBallY")).toBe(0.2);
  });

  it("obeys each explicitly authored look limit independently, including zero", () => {
    const authored = characterSchema.parse({
      ...actor, render: {
        ...actor.render,
        lookLimits: { headYawDegrees: 4, headPitchDegrees: 1,
          eyeX: 0, eyeY: 0.1 },
      },
    });
    const animation = compilePerformance(build([
      { atMs: 200, actor: "hana", kind: "look", x: -1, y: 1, durationMs: 400 },
    ]), authored, "hana", defaultRig);
    const values = new Map(animation.tracks.map((track) =>
      [track.target, track.keys.find((key) => key.t === 0.6)?.v]));
    expect(values.get("param:AngleX")).toBe(-4);
    expect(values.get("param:AngleY")).toBe(-1);
    expect(values.get("param:EyeBallX")).toBe(0);
    expect(values.get("param:EyeBallY")).toBe(-0.1);
  });

  it("rejects malformed or wider-than-supported look limits", () => {
    const limits = { headYawDegrees: 8, headPitchDegrees: 5, eyeX: 0.2, eyeY: 0.2 };
    for (const bad of [
      { ...limits, eyeX: 0.8 },
      { ...limits, headYawDegrees: -1 },
      { ...limits, headPitchDegrees: 30 },
      { ...limits, eyeY: Number.POSITIVE_INFINITY },
      { eyeX: 0.2 },
      { ...limits, extra: true },
    ]) {
      expect(characterSchema.safeParse({ ...actor, render: { ...actor.render, lookLimits: bad } }).success)
        .toBe(false);
    }
  });

  it("rejects unsupported pose changes rather than faking a seamless transition", () => {
    expect(() => compilePerformance(build([
      { atMs: 300, actor: "hana", kind: "pose", name: "crossed" },
    ]), actor, "hana", defaultRig))
      .toThrowError(PreviewUnsupportedError);
  });

  it("leaves camera-only events to the video compositor", () => {
    const performance = compilePerformance(build([
      { atMs: 300, kind: "camera", name: "punch-in", amount: 0.1 },
    ]), actor, "hana", defaultRig);
    expect(performance.tracks).toEqual([]);
  });

  it("still rejects unimplemented caption rendering", () => {
    expect(() => compilePerformance(build([
      { atMs: 300, kind: "caption", text: "Hello", durationMs: 300 },
    ]), actor, "hana", defaultRig)).toThrowError(PreviewUnsupportedError);
  });

  it("rejects presets targeting missing rig controls", () => {
    const invalid = structuredClone(actor);
    invalid.render!.expressionPresets.happy["Nonexistent"] = 0.1;
    expect(() => compilePerformance(build([
      { atMs: 300, actor: "hana", kind: "expression", name: "happy" },
    ]), invalid, "hana", defaultRig)).toThrowError(/Unknown rig parameter/);
  });
});

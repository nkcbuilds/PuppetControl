import { describe, expect, it } from "vitest";
import { characterSchema, sceneSchema } from "../src/scene/schemas.js";
import {
  frameBoundaryAtOrAfterMs,
  planPoseTimeline,
  PoseTimelineError,
} from "../src/animation/pose-timeline.js";

const character = characterSchema.parse({
  schemaVersion: 1,
  id: "maya",
  defaultPose: "neutral",
  poseFamilies: [
    { name: "neutral", rigId: "base", approved: true },
    { name: "pointing", rigId: "base", approved: true },
    { name: "crossed", rigId: "cross", approved: true },
    { name: "side", rigId: "side", approved: true },
    { name: "draft", rigId: "draft", approved: false },
  ],
  expressions: ["neutral"],
  transitions: [
    { kind: "bridge", from: "pointing", to: "crossed", clip: "point-cross.anim", durationMs: 450 },
    { kind: "bridge", from: "neutral", to: "crossed", clip: "neutral-cross.anim", durationMs: 450 },
  ],
});

function scene(
  events: unknown[],
  options: { durationMs?: number; fps?: number; allowCameraCuts?: boolean; actors?: unknown[] } = {},
) {
  return sceneSchema.parse({
    schemaVersion: 1,
    id: "demo",
    durationMs: options.durationMs ?? 3000,
    fps: options.fps ?? 30,
    resolution: { width: 512, height: 640 },
    actors: options.actors ?? [{ id: "maya", characterPath: "maya.json" }],
    allowCameraCuts: options.allowCameraCuts ?? false,
    events,
  });
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error("Expected planner to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(PoseTimelineError);
    expect((error as PoseTimelineError).code).toBe(code);
  }
}

describe("pose timeline planner", () => {
  it("builds contiguous pose and interpolation segments using exact sampled-frame boundaries", () => {
    const plan = planPoseTimeline(scene([
      { kind: "pose", actor: "maya", atMs: 1000, name: "pointing", transition: "auto" },
    ]), character, "maya");

    expect(plan.frameCount).toBe(90);
    expect(plan.segments).toEqual([
      { kind: "pose", pose: "neutral", startFrame: 0, endFrame: 30 },
      {
        kind: "transition", mode: "interpolate", from: "neutral", to: "pointing",
        startFrame: 30, endFrame: 39,
      },
      { kind: "pose", pose: "pointing", startFrame: 39, endFrame: 90 },
    ]);
    expect(plan.transitions[0]).toMatchObject({
      eventIndex: 0,
      atMs: 1000,
      frame: 30,
      endFrame: 39,
      decision: { mode: "interpolate", from: "neutral", to: "pointing", durationMs: 300 },
    });
  });

  it("samples frame n at n/fps so a non-aligned cut starts on the first frame at or after the event", () => {
    expect(frameBoundaryAtOrAfterMs(1000, 30)).toBe(30);
    expect(frameBoundaryAtOrAfterMs(1001, 30)).toBe(31);

    const plan = planPoseTimeline(scene([
      { kind: "camera", atMs: 1001, name: "cut" },
      { kind: "pose", actor: "maya", atMs: 1001, name: "side", transition: "cut" },
    ], { allowCameraCuts: true }), character, "maya");

    expect(plan.segments).toEqual([
      { kind: "pose", pose: "neutral", startFrame: 0, endFrame: 31 },
      { kind: "pose", pose: "side", startFrame: 31, endFrame: 90 },
    ]);
    expect(plan.transitions[0]).toMatchObject({
      atMs: 1001,
      frame: 31,
      endFrame: 31,
      decision: { mode: "cut" },
    });
  });

  it("keeps an authored bridge renderable as a bridge even when a camera cut exists at the same time", () => {
    const plan = planPoseTimeline(scene([
      { kind: "camera", atMs: 500, name: "cut" },
      { kind: "pose", actor: "maya", atMs: 500, name: "crossed", transition: "auto" },
    ], { allowCameraCuts: true }), character, "maya");

    expect(plan.transitions[0]?.decision).toMatchObject({
      mode: "bridge",
      clip: "neutral-cross.anim",
      durationMs: 450,
    });
    expect(plan.segments).toContainEqual({
      kind: "transition",
      mode: "bridge",
      from: "neutral",
      to: "crossed",
      clip: "neutral-cross.anim",
      startFrame: 15,
      endFrame: 29,
    });
    expect(plan.segments.some((segment) => segment.kind === "transition" && segment.mode === "bridge")).toBe(true);
  });

  it("preserves original event order for same-timestamp cuts and keeps the cut on one exact boundary", () => {
    const plan = planPoseTimeline(scene([
      { kind: "camera", atMs: 500, name: "cut" },
      { kind: "pose", actor: "maya", atMs: 500, name: "side", transition: "cut" },
      { kind: "pose", actor: "maya", atMs: 500, name: "crossed", transition: "cut" },
    ], { allowCameraCuts: true }), character, "maya");

    expect(plan.transitions.map((item) => ({
      eventIndex: item.eventIndex,
      from: item.decision.from,
      to: item.decision.to,
      mode: item.decision.mode,
      frame: item.frame,
    }))).toEqual([
      { eventIndex: 1, from: "neutral", to: "side", mode: "cut", frame: 15 },
      { eventIndex: 2, from: "side", to: "crossed", mode: "cut", frame: 15 },
    ]);
    expect(plan.segments).toEqual([
      { kind: "pose", pose: "neutral", startFrame: 0, endFrame: 15 },
      { kind: "pose", pose: "crossed", startFrame: 15, endFrame: 90 },
    ]);
  });

  it("rejects unsupported or explicitly bogus transition requests instead of silently substituting another mode", () => {
    expectCode(() => planPoseTimeline(scene([
      { kind: "pose", actor: "maya", atMs: 500, name: "side", transition: "auto" },
    ]), character, "maya"), "TRANSITION_UNSUPPORTED");

    expectCode(() => planPoseTimeline(scene([
      { kind: "camera", atMs: 500, name: "cut" },
      { kind: "pose", actor: "maya", atMs: 500, name: "neutral", transition: "bridge" },
    ], { allowCameraCuts: true }), character, "maya"), "TRANSITION_REQUEST_MISMATCH");

    expectCode(() => planPoseTimeline(scene([
      { kind: "pose", actor: "maya", atMs: 500, name: "draft", transition: "auto" },
    ]), character, "maya"), "TRANSITION_UNSUPPORTED");
  });

  it("rejects a pose event that arrives before a nonzero transition has completed", () => {
    expectCode(() => planPoseTimeline(scene([
      { kind: "pose", actor: "maya", atMs: 500, name: "pointing", transition: "auto" },
      { kind: "pose", actor: "maya", atMs: 600, name: "crossed", transition: "bridge" },
    ]), character, "maya"), "TRANSITION_OVERLAP");
  });

  it("rejects transitions that cannot complete or occupy a sampled frame", () => {
    expectCode(() => planPoseTimeline(scene([
      { kind: "pose", actor: "maya", atMs: 2800, name: "pointing", transition: "auto" },
    ]), character, "maya"), "TRANSITION_OUT_OF_BOUNDS");

    expectCode(() => planPoseTimeline(scene([
      { kind: "pose", actor: "maya", atMs: 100, name: "pointing", transition: "auto" },
    ], { fps: 1 }), character, "maya"), "TRANSITION_UNSAMPLED");
  });

  it("re-validates raw scene/character inputs and every actor reference", () => {
    expectCode(() => planPoseTimeline({
      schemaVersion: 1,
      id: "bad",
      durationMs: -1,
      fps: 30,
      resolution: { width: 512, height: 640 },
      actors: [{ id: "maya", characterPath: "maya.json" }],
      events: [],
    }, character, "maya"), "INVALID_SCENE");

    expectCode(() => planPoseTimeline(scene([], {
      actors: [{ id: "maya", characterPath: "maya.json" }],
    }), character, "missing"), "UNKNOWN_ACTOR");

    const unknownActorScene = {
      schemaVersion: 1,
      id: "unknown-event-actor",
      durationMs: 1000,
      fps: 30,
      resolution: { width: 512, height: 640 },
      actors: [{ id: "maya", characterPath: "maya.json" }],
      events: [
        { kind: "expression", actor: "ghost", atMs: 10, name: "neutral" },
      ],
    };
    expectCode(() => planPoseTimeline(unknownActorScene, character, "maya"), "EVENT_UNKNOWN_ACTOR");

    expectCode(() => planPoseTimeline(scene([]), {
      schemaVersion: 1,
      id: "bad-character",
      defaultPose: "missing",
      poseFamilies: [{ name: "neutral", rigId: "base", approved: true }],
      expressions: ["neutral"],
    }, "maya"), "INVALID_CHARACTER");

    expectCode(() => planPoseTimeline(scene([]), {
      schemaVersion: 1,
      id: "unapproved-default",
      defaultPose: "draft",
      poseFamilies: [{ name: "draft", rigId: "draft", approved: false }],
      expressions: ["neutral"],
    }, "maya"), "DEFAULT_POSE_NOT_APPROVED");
  });
});

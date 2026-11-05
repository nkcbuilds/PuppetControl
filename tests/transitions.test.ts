import { describe, expect, it } from "vitest";
import { characterSchema } from "../src/scene/schemas.js";
import { resolveTransition } from "../src/animation/transitions.js";

const maya = characterSchema.parse({
  schemaVersion: 1,
  id: "maya",
  defaultPose: "neutral",
  poseFamilies: [
    { name: "neutral", rigId: "base", approved: true },
    { name: "pointing", rigId: "base", approved: true },
    { name: "crossed", rigId: "cross", approved: true },
    { name: "unfinished", rigId: "special", approved: false },
  ],
  expressions: ["neutral", "annoyed"],
  transitions: [
    { from: "pointing", to: "crossed", kind: "bridge", clip: "point-to-cross.anim", durationMs: 450 },
    { from: "crossed", to: "neutral", kind: "cut" },
  ],
});

describe("pose-family transition policy", () => {
  it("interpolates within a compatible rig", () => {
    expect(resolveTransition(maya, "neutral", "pointing")).toMatchObject({
      mode: "interpolate",
      durationMs: 300,
    });
  });

  it("does not morph distinct artwork even when rig ID is the same", () => {
    const character = characterSchema.parse({
      schemaVersion: 1,
      id: "test",
      defaultPose: "neutral",
      poseFamilies: [
        { name: "neutral", rigId: "shared", approved: true, modelPath: "neutral.r2d.json" },
        { name: "pointing", rigId: "shared", approved: true, modelPath: "pointing.r2d.json" },
      ],
      expressions: ["neutral"],
    });
    expect(resolveTransition(character, "neutral", "pointing").mode).toBe("unsupported");
    expect(resolveTransition(character, "neutral", "pointing", { allowCameraCut: true }).mode).toBe("cut");
  });

  it("does not interpolate different rigs", () => {
    expect(resolveTransition(maya, "neutral", "crossed").mode).toBe("unsupported");
    expect(resolveTransition(maya, "neutral", "crossed", {
      requested: "interpolate",
      allowCameraCut: true,
    }).mode).toBe("unsupported");
  });

  it("uses authored bridge clips and exposes the clip", () => {
    expect(resolveTransition(maya, "pointing", "crossed")).toMatchObject({
      mode: "bridge",
      durationMs: 450,
      clip: "point-to-cross.anim",
    });
  });

  it("does not hide incompatible transitions without an intentional camera cut", () => {
    expect(resolveTransition(maya, "crossed", "neutral").mode).toBe("unsupported");
    expect(resolveTransition(maya, "crossed", "neutral", { allowCameraCut: true })).toMatchObject({
      mode: "cut",
      durationMs: 0,
    });
  });

  it("does not animate rejected assets or unknown poses", () => {
    expect(resolveTransition(maya, "neutral", "unfinished").mode).toBe("unsupported");
    expect(resolveTransition(maya, "neutral", "missing").mode).toBe("unsupported");
  });
});

import { describe, expect, it } from "vitest";
import {
  AvatarWorkflowError, createImportedCharacter, createImportedPreviewScene, importAvatar, parsePngSize,
} from "../src/character/avatar.js";

function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function parameters(...ids: string[]) {
  return { parameters: ids.map((id) => ({ id, min: -1, max: 1, default: 0 })) };
}

describe("agent-first avatar import contracts", () => {
  it("extracts dimensions from a PNG signature and IHDR", () => {
    expect(parsePngSize(pngHeader(512, 640))).toEqual({ width: 512, height: 640 });
  });

  it("rejects non-PNG files, forged IHDR locations and short headers", () => {
    expect(() => parsePngSize(Buffer.from("hello world"))).toThrowError(AvatarWorkflowError);
    const forged = pngHeader(512, 640);
    forged.write("FAKE", 12);
    expect(() => parsePngSize(forged)).toThrow(/valid PNG/);
  });

  it("rejects undersized or excessively large images before invoking a backend", () => {
    expect(() => parsePngSize(pngHeader(200, 512))).toThrow(/256/);
    expect(() => parsePngSize(pngHeader(512, 5000))).toThrow(/4096/);
  });

  const minimum = parameters("AngleX", "AngleY", "EyeBallX", "EyeBallY", "MouthOpen", "MouthForm");

  it("creates an unapproved neutral-only rig using the built model's actual controls", () => {
    const result = createImportedCharacter("demo_character", minimum);
    expect(result.defaultPose).toBe("neutral");
    expect(result.poseFamilies).toEqual([expect.objectContaining({
      name: "neutral", approved: false, modelPath: "demo_character.r2d.json",
    })]);
    expect(result.expressions).toEqual(["neutral", "happy", "confused"]);
    expect(result.render?.expressionPresets.happy).toEqual({ MouthForm: 0.6 });
    expect(result.render?.expressionPresets.confused).toEqual({ MouthForm: -0.3 });
    expect(result.render?.lookLimits).toEqual({
      headYawDegrees: 8, headPitchDegrees: 5, eyeX: 0.2, eyeY: 0.2,
    });
    expect(result.transitions).toEqual([]);
  });

  it("includes brows and blush only when those parameters exist", () => {
    const result = createImportedCharacter("miko", parameters(
      "AngleX", "AngleY", "EyeBallX", "EyeBallY", "MouthOpen",
      "MouthForm", "BrowLY", "BrowRY", "Cheek",
    ));
    expect(result.render?.expressionPresets.happy).toEqual({ MouthForm: 0.6, Cheek: 0.3 });
    expect(result.render?.expressionPresets.confused).toEqual({
      MouthForm: -0.3, BrowLY: 0.4, BrowRY: -0.2,
    });
  });

  it("creates a strict preview scene for agent editing, without auto-approving the rig", () => {
    const rev2dMeta = { width: 512, height: 640, name: "miko", background: "#ffffff", fps: 60 };
    const scene = createImportedPreviewScene("miko", rev2dMeta);
    expect(scene.resolution).toEqual({ width: 512, height: 640 });
    expect(scene.actors[0]).toEqual({ id: "miko", characterPath: "character.json" });
    expect(scene.id).toBe("miko-preview");
    expect(scene.fps).toBe(15);
    expect(scene.events.map((event) => event.kind)).toEqual(["expression", "look", "look"]);
    expect(() => createImportedPreviewScene("miko", { width: 120, height: 640 })).toThrow();
  });

  it("fails if a generated model does not support required head/gaze/mouth controls", () => {
    expect(() => createImportedCharacter("broken", parameters("MouthForm", "MouthOpen")))
      .toThrow(/mouth, gaze and head/);
  });

  it("rejects lexical workspace escapes before touching external images", async () => {
    await expect(importAvatar("../outside.png", ".cache/demo", "safe"))
      .rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });
  });

  it("rejects invalid agent-supplied character IDs", () => {
    expect(() => createImportedCharacter("../../outside", minimum)).toThrow(/Character ID/);
    expect(() => createImportedCharacter("some name", minimum)).toThrow(/Character ID/);
    expect(() => createImportedCharacter("x".repeat(85), minimum)).toThrow(/Character ID/);
  });
});

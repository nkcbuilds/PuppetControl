import { describe, it, expect } from "vitest";
import { sceneSchema } from "../src/scene/schemas.js";
import { buildFitVideoFilter } from "../src/video/output.js";
import { buildFfmpegArgs } from "../src/audio/ffmpeg.js";
import { backgroundForScene, rev2dFrameRenderingFlags, DEFAULT_RENDER_BACKGROUND } from "../src/render/rev2d.js";

describe("presentation output sizing", () => {
  it("uses an opaque background for alpha gaps from moving mesh edges", () => {
    expect(DEFAULT_RENDER_BACKGROUND).toBe("#f0eaf4");
    expect(backgroundForScene({})).toBe("#f0eaf4");
    expect(backgroundForScene({ output: { width: 512, height: 640, background: "#efe7f1" } }))
      .toBe("#efe7f1");
    expect(rev2dFrameRenderingFlags({})).toEqual([
      "--bg", "#f0eaf4", "--ss", "1", "--json",
    ]);
    expect(rev2dFrameRenderingFlags({
      output: { width: 512, height: 640, background: "#efe7f1" },
    })).toEqual(["--bg", "#efe7f1", "--ss", "1", "--json"]);
  });

  it("fits without distorting the source ratio and pads for 1080p", () => {
    expect(buildFitVideoFilter({
      width: 1920, height: 1080, background: "#f0eaf4",
    })).toBe(
      "scale=w=1920:h=1080:force_original_aspect_ratio=decrease:flags=lanczos," +
      "pad=w=1920:h=1080:x=(ow-iw)/2:y=(oh-ih)/2:color=0xf0eaf4,setsar=1",
    );
  });

  it("avoids building arbitrary filter injection strings", () => {
    expect(() => buildFitVideoFilter({
      width: 1920, height: 1080, background: "#112233,drawtext=x",
    })).toThrow(/hex color/);
    expect(() => buildFitVideoFilter({
      width: 1919, height: 1080, background: "#112233",
    })).toThrow(/even integer/);
  });

  it("keeps the native rig scene resolution separate from presentation resolution", () => {
    const scene = sceneSchema.parse({
      schemaVersion: 1,
      id: "demo",
      durationMs: 3000,
      fps: 30,
      resolution: { width: 512, height: 640 },
      output: { width: 1920, height: 1080, background: "#f5f2fa" },
      actors: [{ id: "hana", characterPath: "character.json" }],
    });
    expect(scene.resolution).toEqual({ width: 512, height: 640 });
    expect(scene.output).toEqual({ width: 1920, height: 1080, background: "#f5f2fa" });
    expect(sceneSchema.safeParse({
      ...scene,
      output: { width: 1081, height: 1080, background: "#f0eaf4" },
    }).success).toBe(false);
  });

  it("injects only an argv ffmpeg video filter, with source audio still separate", () => {
    const args = buildFfmpegArgs({
      framesPattern: "frames/frame_%04d.png",
      outputPath: "outputs/output.mp4",
      fps: 30,
      frameCount: 90,
      output: { width: 1920, height: 1080, background: "#010203" },
      audio: { path: "audio/voice.wav", startMs: 200 },
    });
    expect(args).toContain("-vf");
    expect(args[args.indexOf("-vf") + 1]).toContain("scale=w=1920:h=1080");
    expect(args).toContain("-filter_complex");
    expect(args).toContain("-c:a");
  });
});

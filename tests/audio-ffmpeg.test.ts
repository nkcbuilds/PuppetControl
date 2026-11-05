import { describe, expect, it } from "vitest";
import { buildFfmpegArgs } from "../src/audio/ffmpeg.js";

describe("buildFfmpegArgs", () => {
  it("builds a deterministic silent H264/yuv420p encode from an explicit PNG sequence", () => {
    expect(buildFfmpegArgs({
      framesPattern: "renders/frame_%04d.png",
      outputPath: "outputs/scene.mp4",
      fps: 30,
      frameCount: 90,
    })).toEqual([
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-framerate", "30",
      "-i", "renders/frame_%04d.png",
      "-map", "0:v:0",
      "-frames:v", "90",
      "-r", "30",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-an",
      "-movflags", "+faststart",
      "outputs/scene.mp4",
    ]);
  });

  it("delays, pads and trims one audio track to the exact video duration and encodes AAC", () => {
    const args = buildFfmpegArgs({
      framesPattern: "renders/frame_%04d.png",
      outputPath: "outputs/scene.mp4",
      fps: 24,
      frameCount: 48,
      audio: {
        path: "audio/voice.wav",
        startMs: 250,
      },
    });

    expect(args).toEqual([
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-framerate", "24",
      "-i", "renders/frame_%04d.png",
      "-i", "audio/voice.wav",
      "-filter_complex",
      "[1:a:0]adelay=250:all=1,apad=whole_dur=2,atrim=end=2[audio]",
      "-map", "0:v:0",
      "-map", "[audio]",
      "-frames:v", "48",
      "-r", "24",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "outputs/scene.mp4",
    ]);
  });

  it("keeps shell metacharacters inside individual argv entries", () => {
    const framesPattern = "renders/a; echo pwned/frame_%04d.png";
    const audioPath = "audio/voice && echo pwned.wav";
    const outputPath = "outputs/out $(echo pwned).mp4";

    const args = buildFfmpegArgs({
      framesPattern,
      outputPath,
      fps: 30,
      frameCount: 30,
      audio: { path: audioPath, startMs: 0 },
    });

    expect(args[args.indexOf("-i") + 1]).toBe(framesPattern);
    expect(args).toContain(audioPath);
    expect(args.at(-1)).toBe(outputPath);
  });

  it("accepts fractional fps and derives audio duration from frame count divided by fps", () => {
    const args = buildFfmpegArgs({
      framesPattern: "renders/frame_%04d.png",
      outputPath: "outputs/scene.mp4",
      fps: 29.97,
      frameCount: 90,
      audio: { path: "audio/voice.wav", startMs: 12.5 },
    });

    expect(args).toContain("29.97");
    expect(args).toContain(
      "[1:a:0]adelay=12.5:all=1,apad=whole_dur=3.003003003,atrim=end=3.003003003[audio]",
    );
  });

  it("rejects invalid timing, fps and frame counts", () => {
    const base = {
      framesPattern: "renders/frame_%04d.png",
      outputPath: "outputs/scene.mp4",
      fps: 30,
      frameCount: 30,
    };

    expect(() => buildFfmpegArgs({ ...base, fps: 0 })).toThrow("fps");
    expect(() => buildFfmpegArgs({ ...base, fps: Number.NaN })).toThrow("fps");
    expect(() => buildFfmpegArgs({ ...base, frameCount: 0 })).toThrow("frameCount");
    expect(() => buildFfmpegArgs({ ...base, frameCount: 1.5 })).toThrow("frameCount");
    expect(() => buildFfmpegArgs({
      ...base,
      audio: { path: "audio/voice.wav", startMs: -1 },
    })).toThrow("non-negative");
    expect(() => buildFfmpegArgs({
      ...base,
      audio: { path: "audio/voice.wav", startMs: Number.POSITIVE_INFINITY },
    })).toThrow("non-negative");
  });

  it("rejects empty, null-byte and option-like paths", () => {
    const base = {
      framesPattern: "renders/frame_%04d.png",
      outputPath: "outputs/scene.mp4",
      fps: 30,
      frameCount: 30,
    };

    expect(() => buildFfmpegArgs({ ...base, framesPattern: "" })).toThrow("framesPattern");
    expect(() => buildFfmpegArgs({ ...base, outputPath: "-f" })).toThrow("outputPath");
    expect(() => buildFfmpegArgs({
      ...base,
      audio: { path: "bad\0.wav", startMs: 0 },
    })).toThrow("null byte");
  });
});

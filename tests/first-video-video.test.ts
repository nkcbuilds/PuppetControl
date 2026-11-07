import { describe, expect, it } from "vitest";
import {
  DEFAULT_DURATION_TOLERANCE_MS,
  DEFAULT_FPS_TOLERANCE,
  DEFAULT_FRAME_TOLERANCE,
  DEFAULT_MAX_BYTES,
  evaluateProbe,
  isPathInsideRoot,
  parseArgs,
  parseRate,
} from "../scripts/check-first-video-video.mjs";

function probeFixture({
  audio = false,
  width = 1920,
  height = 1080,
  fps = "30/1",
  frames = "90",
  duration = "3.000000",
}: {
  audio?: boolean;
  width?: number;
  height?: number;
  fps?: string;
  frames?: string;
  duration?: string;
} = {}) {
  return {
    streams: [
      {
        index: 0,
        codec_type: "video",
        codec_name: "h264",
        width,
        height,
        avg_frame_rate: fps,
        r_frame_rate: fps,
        nb_frames: frames,
        nb_read_frames: frames,
        duration,
      },
      ...(audio ? [{
        index: 1,
        codec_type: "audio",
        codec_name: "aac",
        duration,
      }] : []),
    ],
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration,
      size: "12345",
    },
  };
}

function expected(overrides: Record<string, unknown> = {}) {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    frames: 90,
    audio: false,
    fpsTolerance: DEFAULT_FPS_TOLERANCE,
    durationToleranceMs: DEFAULT_DURATION_TOLERANCE_MS,
    frameTolerance: DEFAULT_FRAME_TOLERANCE,
    videoCodec: undefined,
    audioCodec: undefined,
    ...overrides,
  };
}

describe("first video MP4 acceptance checker", () => {
  it("parses required expectations and bounded defaults without implying quality approval", () => {
    expect(parseArgs([
      "outputs/first.mp4",
      "--fps", "30",
      "--width", "1920",
      "--height", "1080",
      "--frames", "90",
      "--audio",
      "--video-codec", "h264",
      "--audio-codec", "aac",
    ])).toMatchObject({
      path: "outputs/first.mp4",
      fps: 30,
      width: 1920,
      height: 1080,
      frames: 90,
      audio: true,
      maxBytes: DEFAULT_MAX_BYTES,
      fpsTolerance: DEFAULT_FPS_TOLERANCE,
      durationToleranceMs: DEFAULT_DURATION_TOLERANCE_MS,
      frameTolerance: DEFAULT_FRAME_TOLERANCE,
      videoCodec: "h264",
      audioCodec: "aac",
    });

    expect(() => parseArgs(["outputs/first.mp4", "--fps", "30"])).toThrow("missing required argument");
    expect(() => parseArgs([
      "outputs/first.mp4",
      "--fps", "30",
      "--width", "1920",
      "--height", "1080",
      "--frames", "90",
      "--audio-codec", "aac",
    ])).toThrow("--audio-codec requires --audio");
  });

  it("accepts exact video metadata and ffprobe rational frame rates", () => {
    expect(parseRate("30000/1001")).toBeCloseTo(29.97002997, 8);
    const result = evaluateProbe(probeFixture(), expected());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.observed).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 30,
      frames: 90,
      durationSeconds: 3,
      videoStreams: 1,
      audioStreams: 0,
      videoCodec: "h264",
    });
  });

  it("requires audio iff requested and supports exact codec checks", () => {
    const unexpected = evaluateProbe(probeFixture({ audio: true }), expected());
    expect(unexpected.ok).toBe(false);
    expect(unexpected.errors).toContain("expected no audio stream, found 1");

    const missing = evaluateProbe(probeFixture(), expected({ audio: true }));
    expect(missing.ok).toBe(false);
    expect(missing.errors).toContain("expected exactly one audio stream, found 0");

    const accepted = evaluateProbe(
      probeFixture({ audio: true }),
      expected({ audio: true, videoCodec: "h264", audioCodec: "aac" }),
    );
    expect(accepted.ok).toBe(true);
  });

  it("reports dimensions, fps, frame-count, duration and container mismatches independently", () => {
    const probe = probeFixture({
      width: 1280,
      height: 720,
      fps: "24/1",
      frames: "89",
      duration: "4.000000",
    });
    probe.format.format_name = "matroska,webm";

    const result = evaluateProbe(probe, expected());
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("width mismatch");
    expect(result.errors.join("\n")).toContain("height mismatch");
    expect(result.errors.join("\n")).toContain("fps mismatch");
    expect(result.errors.join("\n")).toContain("frame count mismatch");
    expect(result.errors.join("\n")).toContain("duration mismatch");
    expect(result.errors.join("\n")).toContain("container mismatch");
  });

  it("keeps lexical paths confined to the workspace root", () => {
    const root = process.platform === "win32" ? "S:\\PuppetControl" : "/repo/PuppetControl";
    const inside = process.platform === "win32"
      ? "S:\\PuppetControl\\outputs\\first.mp4"
      : "/repo/PuppetControl/outputs/first.mp4";
    const outside = process.platform === "win32"
      ? "S:\\other\\first.mp4"
      : "/repo/other/first.mp4";

    expect(isPathInsideRoot(root, inside)).toBe(true);
    expect(isPathInsideRoot(root, outside)).toBe(false);
    if (process.platform === "win32") {
      expect(isPathInsideRoot(root, "T:\\elsewhere\\first.mp4")).toBe(false);
    }
  });
});

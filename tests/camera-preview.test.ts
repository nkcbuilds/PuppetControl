import { describe, expect, it } from "vitest";
import { buildCameraPreviewFilter } from "../src/video/camera-preview.js";
import { buildFfmpegArgs } from "../src/audio/ffmpeg.js";
import { sceneSchema } from "../src/scene/schemas.js";

function cameraEvents(events: unknown[]) {
  const scene = sceneSchema.parse({
    schemaVersion: 1,
    id: "camera-test",
    durationMs: 5000,
    fps: 15,
    resolution: { width: 512, height: 640 },
    actors: [{ id: "hana", characterPath: "character.json" }],
    allowCameraCuts: true,
    events,
  });
  return scene.events;
}

describe("conservative shot framing", () => {
  const native = { width: 512, height: 640 };

  it("does not introduce a zoom for mere camera-cut markers", () => {
    const events = cameraEvents([{ atMs: 2000, kind: "camera", name: "cut" }]);
    expect(buildCameraPreviewFilter(events, 15, native)).toBeNull();
  });

  it("changes framing immediately at explicit cut frames", () => {
    const events = cameraEvents([
      { atMs: 2000, kind: "camera", name: "cut" },
      { atMs: 2000, kind: "camera", name: "medium" },
      { atMs: 4200, kind: "camera", name: "cut" },
      { atMs: 4200, kind: "camera", name: "close-up" },
    ]);
    const stage = buildCameraPreviewFilter(events, 15, native);
    expect(stage).toContain("zoompan=z='");
    expect(stage).toContain("if(lt(on,30)");
    expect(stage).toContain("if(lt(on,63)");
    expect(stage).toContain("1.12");
    expect(stage).toContain("1.34");
    expect(stage).toContain("d=1:s=512x640:fps=15");
  });

  it("creates eased punch-in curves instead of skipping intermediate samples", () => {
    const events = cameraEvents([{ atMs: 1000, kind: "camera", name: "punch-in", amount: 0.12, durationMs: 400 }]);
    const stage = buildCameraPreviewFilter(events, 15, native);
    expect(stage).toContain("if(lt(on,15)");
    expect(stage).toContain("if(lt(on,21)");
    expect(stage).toContain("*(3-2*");
    expect(stage).toContain("1.12");
  });

  it("rejects overlapping camera transitions and unsafe numbers", () => {
    const overlapping = cameraEvents([
      { atMs: 500, kind: "camera", name: "medium", durationMs: 900 },
      { atMs: 700, kind: "camera", name: "close-up", durationMs: 300 },
    ]);
    expect(() => buildCameraPreviewFilter(overlapping, 15, native)).toThrow(/overlap/);
    expect(() => buildCameraPreviewFilter([], 0, native)).toThrow();
    expect(() => buildCameraPreviewFilter([], 15, { width: 0, height: 640 })).toThrow();
  });

  it("composes zoompan before aspect-safe scaling without shell execution", () => {
    const events = cameraEvents([
      { atMs: 2000, kind: "camera", name: "cut" },
      { atMs: 2000, kind: "camera", name: "medium" },
    ]);
    const argv = buildFfmpegArgs({
      framesPattern: "frames/frame_%04d.png",
      outputPath: "output.mp4",
      fps: 15,
      frameCount: 75,
      camera: { events, sourceWidth: 512, sourceHeight: 640 },
      output: { width: 1920, height: 1080, background: "#ede8f1" },
    });
    const filter = argv[argv.indexOf("-vf") + 1];
    expect(filter).toMatch(/^zoompan=/);
    expect(filter).toContain(",scale=w=1920:h=1080");
    expect(filter).toContain(",pad=w=1920:h=1080");
  });
});

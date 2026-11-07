import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { encodeFrames, type FrameResult } from "../src/render/rev2d.js";

let directory = "";
beforeEach(async () => {
  await mkdir(resolve(".cache"), { recursive: true });
  directory = await mkdtemp(join(resolve(".cache"), "video-atomic-"));
});
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function fixtureFrames(): FrameResult {
  return {
    framesDir: join(directory, "missing-frames"),
    count: 2, fps: 15, width: 512, height: 640,
    manifestPath: "", characterId: "fixture", poseFamilies: ["neutral"],
  };
}

describe("non-destructive MP4 output", () => {
  it("refuses an existing output before launching FFmpeg or altering its bytes", async () => {
    const output = join(directory, "original.mp4");
    const original = Buffer.from("previous good video must survive even when source frames do not exist");
    await writeFile(output, original);
    await expect(encodeFrames(fixtureFrames(), output))
      .rejects.toMatchObject({ code: "VIDEO_OUTPUT_EXISTS" });
    expect(await readFile(output)).toEqual(original);
    expect((await readdir(directory)).filter((entry) => entry.endsWith(".mp4")))
      .toEqual(["original.mp4"]);
  });

  it("rejects unsupported extension before attempting FFmpeg", async () => {
    await expect(encodeFrames(fixtureFrames(), join(directory, "movie.txt")))
      .rejects.toMatchObject({ code: "VIDEO_OUTPUT_INVALID" });
  });

  it("refuses an output path outside the project", async () => {
    await expect(encodeFrames(fixtureFrames(), resolve("..", "export-outside.mp4")))
      .rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });
  });
});

import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prepareFreshFrameDirectory, isSafeRev2DFrameName } from "../src/render/rev2d.js";

let home = "";
let inside = "";
let sibling = "";
beforeEach(async () => {
  await mkdir(resolve(".cache"), { recursive: true });
  home = await mkdtemp(resolve(".cache", "frame-path-safety-"));
  inside = join(home, "inside");
  sibling = join(home, "sibling");
  await mkdir(inside);
  await mkdir(sibling);
});
afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true });
});

describe("subprocess-provided frame names", () => {
  it("accepts only flat Rev2D frame filenames", () => {
    expect(isSafeRev2DFrameName("frame_0000.png")).toBe(true);
    expect(isSafeRev2DFrameName("frame_0023.png")).toBe(true);
    for (const filename of [
      "../other.png", "./frame_0000.png", "segment/frame_0000.png",
      "frame_0000.png/../../stolen", "frame_0000.jpg", "", null, 5,
    ]) expect(isSafeRev2DFrameName(filename)).toBe(false);
  });
});

describe("new render frame directory confinement", () => {
  it("creates a fresh directory inside its root", async () => {
    const path = join(inside, "frames");
    expect(await prepareFreshFrameDirectory(path, inside)).toBe(path);
    expect(await readdir(inside)).toEqual(["frames"]);
  });

  it("does not overwrite previous output, even an empty directory", async () => {
    const path = join(inside, "existing");
    await mkdir(path);
    await expect(prepareFreshFrameDirectory(path, inside))
      .rejects.toMatchObject({ code: "FRAME_DIRECTORY_EXISTS" });
  });

  it("refuses an ancestor symlink/junction escaping the supplied workspace root", async () => {
    const link = join(inside, "redirect");
    await symlink(sibling, link, process.platform === "win32" ? "junction" : "dir");
    await expect(prepareFreshFrameDirectory(join(link, "frames"), inside))
      .rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });
    expect(await readdir(sibling)).toEqual([]);
  });

  it("refuses the workspace root itself as the frame output", async () => {
    await expect(prepareFreshFrameDirectory(inside, inside))
      .rejects.toMatchObject({ code: "FRAME_DIRECTORY_EXISTS" });
  });
});

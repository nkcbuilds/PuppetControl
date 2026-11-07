import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createAvatarBuildRecord, writeAvatarBuildRecord } from "../src/character/provenance.js";
import { snapshotImportedRig } from "../src/render/rig-snapshot.js";

let root = "";
let dir = "";
let characterPath = "";
beforeEach(async () => {
  root = resolve(process.cwd());
  await mkdir(join(root, ".cache"), { recursive: true });
  dir = await mkdtemp(join(root, ".cache", "snapshot-rig-"));
  await mkdir(join(dir, "textures"));
  characterPath = join(dir, "character.json");
  await writeFile(characterPath, JSON.stringify({ id: "test" }));
  await writeFile(join(dir, "source.png"), "source bytes");
  await writeFile(join(dir, "avatar.json"), '{"name":"source"}');
  await writeFile(join(dir, "textures", "face.png"), "face pixels");
  await writeFile(join(dir, "rig.r2d.json"), JSON.stringify({
    meta: { width: 512, height: 640 },
    textures: [{ id: "face", path: "./textures/face.png" }],
    parameters: [], animations: [],
  }));
  await writeAvatarBuildRecord(dir, await createAvatarBuildRecord(dir, "rig.r2d.json"));
});
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("approved avatar per-render asset snapshot", () => {
  it("makes a private, independently hashed model+texture copy before render", async () => {
    const result = await snapshotImportedRig(
      characterPath, "rig.r2d.json", join(dir, "snapshot"), root,
    );
    expect(result.fileCount).toBe(4);
    const rig = JSON.parse(await readFile(result.modelPath, "utf8"));
    expect(rig.textures[0].path).toBe("./textures/face.png");
    expect(await readFile(join(result.snapshotDirectory, "textures", "face.png"), "utf8"))
      .toBe("face pixels");

    // The renderer is handed the copied path. Original source swaps cannot
    // affect the bytes in the copy that Rev2D consumes.
    await writeFile(join(dir, "rig.r2d.json"), '{"swapped":true}');
    await writeFile(join(dir, "textures", "face.png"), "replacement");
    expect(JSON.parse(await readFile(result.modelPath, "utf8"))).toEqual(rig);
    expect(await readFile(join(result.snapshotDirectory, "textures", "face.png"), "utf8"))
      .toBe("face pixels");
  });

  it("fails closed when a source asset changed before its snapshot was verified", async () => {
    await writeFile(join(dir, "textures", "face.png"), "unapproved pixels");
    await expect(snapshotImportedRig(
      characterPath, "rig.r2d.json", join(dir, "changed"), root,
    )).rejects.toMatchObject({ code: "AVATAR_ASSETS_STALE" });
  });

  it("refuses to reuse an existing snapshot or switch to an unexpected rig", async () => {
    await mkdir(join(dir, "exists"));
    await expect(snapshotImportedRig(characterPath, "rig.r2d.json", join(dir, "exists"), root))
      .rejects.toThrow();
    await expect(snapshotImportedRig(characterPath, "different.r2d.json", join(dir, "other"), root))
      .rejects.toMatchObject({ code: "AVATAR_BUILD_RECORD_INVALID" });
  });

  it("refuses an edited build record that points to a texture escape", async () => {
    const recordPath = join(dir, "avatar-build.json");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    record.textures[0].path = "../elsewhere.png";
    await writeFile(recordPath, JSON.stringify(record));
    await expect(snapshotImportedRig(characterPath, "rig.r2d.json", join(dir, "malicious"), root))
      .rejects.toMatchObject({ code: "AVATAR_BUILD_RECORD_INVALID" });
  });
});

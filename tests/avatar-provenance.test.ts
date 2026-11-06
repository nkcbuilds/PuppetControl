import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink, unlink, truncate } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  createAvatarBuildRecord, writeAvatarBuildRecord,
  verifyAvatarBuildRecord, revokeAvatarApprovalBeforeBuild, checkAvatarPoseCoverage,
} from "../src/character/provenance.js";
import { createImportedCharacter } from "../src/character/avatar.js";
import { loadAndValidateScene } from "../src/scene/load.js";
import { renderRev2DFrames } from "../src/render/rev2d.js";
import { characterSchema, sceneSchema } from "../src/scene/schemas.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "puppetcontrol-proof-"));
  dirs.push(dir);
  await mkdir(join(dir, "textures"));
  await writeFile(join(dir, "source.png"), "source-art-v1");
  await writeFile(join(dir, "avatar.json"), '{"format":"rev2d-avatar","name":"test"}\n');
  await writeFile(join(dir, "textures", "base.png"), "rendered-layer-v1");
  await writeFile(join(dir, "test.r2d.json"), JSON.stringify({
    textures: [{ id: "base", path: "textures/base.png", width: 512, height: 640 }],
  }));
  const parameters = ["AngleX", "AngleY", "EyeBallX", "EyeBallY", "MouthOpen", "MouthForm"]
    .map((id) => ({ id, min: -1, max: 1, default: 0 }));
  const character = createImportedCharacter("test", { parameters });
  character.poseFamilies[0]!.approved = true;
  await writeFile(join(dir, "character.json"), JSON.stringify(character, null, 2) + "\n");
  const record = await createAvatarBuildRecord(dir, "test.r2d.json");
  await writeAvatarBuildRecord(dir, record);
  await writeFile(join(dir, "scene.json"), JSON.stringify({
    schemaVersion: 1, id: "test-scene", durationMs: 1000, fps: 15,
    resolution: { width: 512, height: 640 },
    actors: [{ id: "test", characterPath: "character.json" }],
    audio: [], events: [],
  }, null, 2));
  return { dir, record };
}

describe("imported avatar build provenance", () => {
  it("accepts the exact source, spec, model and texture bytes from a finished build", async () => {
    const { dir, record } = await fixture();
    expect(record.source.path).toBe("source.png");
    expect(record.textures.map((t) => t.path)).toEqual(["textures/base.png"]);
    expect(await verifyAvatarBuildRecord(join(dir, "character.json"), "test.r2d.json"))
      .toEqual({ valid: true });
    expect((await loadAndValidateScene(join(dir, "scene.json"))).valid).toBe(true);
  });

  for (const asset of ["source.png", "avatar.json", "test.r2d.json", "textures/base.png"]) {
    it("rejects stale " + asset + " even if old character.json is still approved", async () => {
      const { dir } = await fixture();
      await writeFile(join(dir, asset), "tampered");
      const result = await verifyAvatarBuildRecord(join(dir, "character.json"), "test.r2d.json");
      expect(result.valid).toBe(false);
      const scene = await loadAndValidateScene(join(dir, "scene.json"));
      expect(scene.valid).toBe(false);
      if (!scene.valid) {
        expect(scene.diagnostics.some((d) => d.code.startsWith("AVATAR_"))).toBe(true);
      }
    });
  }

  it("rejects changed rig assets even when rendering is called directly, bypassing scene preflight", async () => {
    const { dir } = await fixture();
    const character = characterSchema.parse(JSON.parse(await readFile(join(dir, "character.json"), "utf8")));
    const scene = sceneSchema.parse(JSON.parse(await readFile(join(dir, "scene.json"), "utf8")));
    await writeFile(join(dir, "textures", "base.png"), "unexpected-frames");
    await expect(renderRev2DFrames(
      scene, character, join(dir, "character.json"), "test",
      join(dir, "frames"), join(dir, "scene.json"),
    )).rejects.toMatchObject({ code: "AVATAR_ASSETS_STALE" });
  });

  it("does not silently approve separately authored pose rigs outside the avatar build record", async () => {
    const { dir } = await fixture();
    const path = join(dir, "character.json");
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const poses = raw.poseFamilies as Array<Record<string, unknown>>;
    poses.push({
      name: "crossed", rigId: "other", modelPath: "rigs/crossed.r2d.json",
      head: "shared", approved: true,
    });
    const character = characterSchema.parse(raw);
    expect(checkAvatarPoseCoverage(character))
      .toMatchObject({ valid: false, code: "AVATAR_POSE_PROVENANCE_MISSING" });
    await writeFile(path, JSON.stringify(character));
    const result = await loadAndValidateScene(join(dir, "scene.json"));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics.some((d) => d.code === "AVATAR_POSE_PROVENANCE_MISSING")).toBe(true);
    }
    const scene = sceneSchema.parse(JSON.parse(await readFile(join(dir, "scene.json"), "utf8")));
    await expect(renderRev2DFrames(
      scene, character, path, "test", join(dir, "unverified-frames"), join(dir, "scene.json"),
    )).rejects.toMatchObject({ code: "AVATAR_POSE_PROVENANCE_MISSING" });
  });

  it("refuses a missing build record and manipulated texture path", async () => {
    const { dir } = await fixture();
    const valid = await verifyAvatarBuildRecord(join(dir, "character.json"), "other.r2d.json");
    expect(valid).toMatchObject({ valid: false, code: "AVATAR_BUILD_RECORD_INVALID" });
    const path = join(dir, "avatar-build.json");
    const record = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    record.textures = [{ path: "../other-site/secret", sha256: "a".repeat(64) }];
    await writeFile(path, JSON.stringify(record));
    expect(await verifyAvatarBuildRecord(join(dir, "character.json"), "test.r2d.json"))
      .toMatchObject({ valid: false, code: "AVATAR_BUILD_RECORD_INVALID" });
    await rm(path);
    expect(await verifyAvatarBuildRecord(join(dir, "character.json"), "test.r2d.json"))
      .toMatchObject({ valid: false, code: "AVATAR_BUILD_RECORD_MISSING_OR_INVALID" });
  });

  it("works through symlinked project paths without leaving the project boundary", async () => {
    const { dir } = await fixture();
    const link = join(dirname(dir), "avatar-alias-" + randomUUID());
    await symlink(dir, link, process.platform === "win32" ? "junction" : "dir");
    try {
      const record = await createAvatarBuildRecord(link, "test.r2d.json");
      await writeAvatarBuildRecord(link, record);
      expect(await verifyAvatarBuildRecord(join(link, "character.json"), "test.r2d.json"))
        .toEqual({ valid: true });
    } finally {
      await unlink(link);
    }
  });

  it("bounds untrusted model size before loading its JSON", async () => {
    const { dir } = await fixture();
    await truncate(join(dir, "test.r2d.json"), 20_000_001);
    await expect(createAvatarBuildRecord(dir, "test.r2d.json"))
      .rejects.toMatchObject({ code: "REV2D_MODEL_INVALID" });
  });

  it("canonicalizes supported relative texture paths and rejects traversal", async () => {
    const { dir } = await fixture();
    const path = join(dir, "test.r2d.json");
    const input = JSON.parse(await readFile(path, "utf8")) as {
      textures: Array<{path: string}>;
    };
    input.textures[0]!.path = "./textures/base.png";
    await writeFile(path, JSON.stringify(input));
    const record = await createAvatarBuildRecord(dir, "test.r2d.json");
    expect(record.textures[0]?.path).toBe("textures/base.png");
    await writeAvatarBuildRecord(dir, record);
    expect(await verifyAvatarBuildRecord(join(dir, "character.json"), "test.r2d.json"))
      .toEqual({ valid: true });
    input.textures[0]!.path = "../source.png";
    await writeFile(path, JSON.stringify(input));
    await expect(createAvatarBuildRecord(dir, "test.r2d.json"))
      .rejects.toMatchObject({ code: "AVATAR_TEXTURE_LIST_INVALID" });
  });

  it("revokes approval before a potentially destructive rebuild and stays idempotent", async () => {
    const { dir } = await fixture();
    const path = join(dir, "character.json");
    expect(await revokeAvatarApprovalBeforeBuild(path)).toBe(true);
    const approved = JSON.parse(await readFile(path, "utf8")) as {
      poseFamilies: Array<{ approved: boolean }>;
    };
    expect(approved.poseFamilies.every((p) => p.approved === false)).toBe(true);
    expect(await revokeAvatarApprovalBeforeBuild(path)).toBe(false);
    expect(await revokeAvatarApprovalBeforeBuild(join(dir, "unknown.json"))).toBe(false);
  });
});

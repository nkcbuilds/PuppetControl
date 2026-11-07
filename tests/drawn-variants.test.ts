import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImportedCharacter, runRev2D } from "../src/character/avatar.js";
import { createAvatarBuildRecord, writeAvatarBuildRecord } from "../src/character/provenance.js";
import {
  DRAWN_VARIANT_IDS, importDrawnVariants, requestDrawnVariants, validateDrawnVariantIds,
} from "../src/character/drawn-variants.js";

const projects: string[] = [];
afterEach(async () => {
  await Promise.all(projects.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "puppetcontrol-variants-"));
  projects.push(dir);
  await mkdir(join(dir, "textures"));
  await mkdir(join(dir, "variants"));
  await writeFile(join(dir, "source.png"), pngHeader(512, 640));
  await writeFile(join(dir, "avatar.json"), '{"format":"rev2d-avatar","name":"test","image":{"file":"source.png"}}');
  await writeFile(join(dir, "textures", "base.png"), "texture");
  await writeFile(join(dir, "test.r2d.json"), JSON.stringify({
    textures: [{ id: "base", path: "textures/base.png", width: 512, height: 640 }],
  }));
  const parameters = ["AngleX", "AngleY", "EyeBallX", "EyeBallY", "MouthOpen", "MouthForm"]
    .map((id) => ({ id, min: -1, max: 1, default: 0 }));
  const manifest = createImportedCharacter("test", { parameters });
  manifest.poseFamilies[0]!.approved = true;
  await writeFile(join(dir, "character.json"), JSON.stringify(manifest));
  await writeAvatarBuildRecord(dir, await createAvatarBuildRecord(dir, "test.r2d.json"));
  return dir;
}

describe("local drawn avatar variants", () => {
  it("defaults to only the two recommended variants", () => {
    expect(validateDrawnVariantIds([])).toEqual(["eyes_closed", "mouth_a"]);
    expect(DRAWN_VARIANT_IDS).toContain("mouth_o");
    expect(validateDrawnVariantIds(["eyes_closed", "eyes_half"])).toEqual(["eyes_closed", "eyes_half"]);
  });

  it("requires explicit IDs for imports and rejects unsupported, duplicate, and option-like IDs", () => {
    expect(() => validateDrawnVariantIds([], true)).toThrowError(/exact reviewed artwork/);
    for (const ids of [["eyes_closed", "eyes_closed"], ["--all"], ["../../art"], ["mouth_x"]]) {
      expect(() => validateDrawnVariantIds(ids)).toThrowError(/variant ID/);
    }
  });

  it("refuses stale imported avatar assets instead of laundering changed model bytes", async () => {
    const dir = await fixture();
    const modelFile = join(dir, "test.r2d.json");
    const model = JSON.parse(await readFile(modelFile, "utf8"));
    model.meta = { width: 512, height: 640 };
    await writeFile(modelFile, JSON.stringify(model));
    await expect(requestDrawnVariants(dir, ["eyes_closed"], dir))
      .rejects.toMatchObject({ code: "AVATAR_ASSETS_STALE" });
    const json = JSON.parse(await readFile(join(dir, "character.json"), "utf8"));
    expect(json.poseFamilies[0].approved).toBe(true);
  });

  it("rejects mismatched illustration size BEFORE modifying the approved manifest", async () => {
    const dir = await fixture();
    await writeFile(join(dir, "variants", "eyes_closed.png"), pngHeader(512, 600));
    await expect(importDrawnVariants(dir, ["eyes_closed"], dir))
      .rejects.toMatchObject({ code: "VARIANT_SIZE_MISMATCH" });
    const json = JSON.parse(await readFile(join(dir, "character.json"), "utf8"));
    expect(json.poseFamilies[0].approved).toBe(true);
  });

  it("rejects missing selected drawings without revoking the original rig", async () => {
    const dir = await fixture();
    await expect(importDrawnVariants(dir, ["mouth_a"], dir)).rejects.toThrow();
    const json = JSON.parse(await readFile(join(dir, "character.json"), "utf8"));
    expect(json.poseFamilies[0].approved).toBe(true);
  });

  it("surfaces Rev2D drawing rejection codes and reasons even when diagnostics is empty", async () => {
    const dir = await fixture();
    await mkdir(join(dir, "bin"));
    await writeFile(join(dir, "bin", "rev2d.js"), [
      "process.stdout.write(JSON.stringify({",
      "  ok: false, diagnostics: [],",
      "  checks: [{ id: 'eyes_closed', ok: false, code: 'unchanged', reason: 'No pixels changed' }]",
      "}));",
      "process.exit(1);",
    ].join("\n"));
    await expect(runRev2D(dir, ["avatar", "variants", "import", dir]))
      .rejects.toMatchObject({
        code: "REV2D_AVATAR_FAILED",
        message: expect.stringContaining("unchanged"),
      });
  });
});

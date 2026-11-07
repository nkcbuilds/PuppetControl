import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createImportedCharacter } from "../src/character/avatar.js";
import { createAvatarBuildRecord, writeAvatarBuildRecord } from "../src/character/provenance.js";
import { approveImportedAvatar } from "../src/character/review-approval.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function pngHeader(width = 512, height = 640): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

async function fixture(options: { approved?: boolean; reviews?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "puppetcontrol-approval-"));
  dirs.push(dir);
  await mkdir(join(dir, "textures"));
  await mkdir(join(dir, "review"));
  await writeFile(join(dir, "source.png"), "source-art-v1");
  await writeFile(join(dir, "avatar.json"), '{"format":"rev2d-avatar","name":"test"}\n');
  await writeFile(join(dir, "textures", "base.png"), "rendered-layer-v1");
  await writeFile(join(dir, "test.r2d.json"), JSON.stringify({
    textures: [{ id: "base", path: "textures/base.png", width: 512, height: 640 }],
  }));

  const parameters = ["AngleX", "AngleY", "EyeBallX", "EyeBallY", "MouthOpen", "MouthForm"]
    .map((id) => ({ id, min: -1, max: 1, default: 0 }));
  const character = createImportedCharacter("test", { parameters });
  character.poseFamilies[0]!.approved = options.approved ?? false;
  // Preserve a legitimate user edit while approval changes only the approved bit.
  character.expressions = ["neutral", "happy", "confused", "serious"];
  await writeFile(join(dir, "character.json"), JSON.stringify(character, null, 2) + "\n");

  const record = await createAvatarBuildRecord(dir, "test.r2d.json");
  await writeAvatarBuildRecord(dir, record);

  if (options.reviews !== false) {
    for (const name of ["poses.png", "turn.png", "eyes.png", "mouth.png"]) {
      await writeFile(join(dir, "review", name), pngHeader());
    }
  }
  return { dir, root: dirname(dir), characterPath: join(dir, "character.json") };
}

describe("explicit imported-avatar review approval", () => {
  it("rejects approval without explicit reviewed=true and leaves the manifest untouched", async () => {
    const { dir, root, characterPath } = await fixture();
    const before = await readFile(characterPath, "utf8");
    await expect(approveImportedAvatar(dir, false, root))
      .rejects.toMatchObject({ code: "AVATAR_REVIEW_REQUIRED" });
    expect(await readFile(characterPath, "utf8")).toBe(before);
  });

  it("rejects missing or implausible review artifacts without approving anything", async () => {
    const { dir, root, characterPath } = await fixture({ reviews: false });
    const before = await readFile(characterPath, "utf8");
    await writeFile(join(dir, "review", "poses.png"), pngHeader());
    await writeFile(join(dir, "review", "turn.png"), pngHeader());
    await writeFile(join(dir, "review", "eyes.png"), pngHeader());

    await expect(approveImportedAvatar(dir, true, root))
      .rejects.toMatchObject({ code: "AVATAR_REVIEW_ASSET_MISSING" });
    expect(await readFile(characterPath, "utf8")).toBe(before);

    await writeFile(join(dir, "review", "mouth.png"), pngHeader(1, 640));
    await expect(approveImportedAvatar(dir, true, root))
      .rejects.toMatchObject({ code: "AVATAR_REVIEW_ASSET_INVALID" });
    expect(await readFile(characterPath, "utf8")).toBe(before);
  });

  it("rejects stale provenance-tracked assets and has no approval side effect", async () => {
    const { dir, root, characterPath } = await fixture();
    const before = await readFile(characterPath, "utf8");
    await writeFile(join(dir, "textures", "base.png"), "changed-after-review");

    await expect(approveImportedAvatar(dir, true, root))
      .rejects.toMatchObject({ code: "AVATAR_ASSETS_STALE" });
    expect(await readFile(characterPath, "utf8")).toBe(before);
  });

  it("approves atomically while preserving other manifest edits", async () => {
    const { dir, root, characterPath } = await fixture();
    const result = await approveImportedAvatar(basename(dir), true, root);
    expect(result).toMatchObject({
      valid: true, status: "approved", approved: true, changed: true,
    });
    expect(result.message).toMatch(/cannot technically verify/i);

    const saved = JSON.parse(await readFile(characterPath, "utf8")) as {
      poseFamilies: Array<{ approved: boolean; modelPath?: string }>;
      expressions: string[];
      render: { modelPath: string };
    };
    expect(saved.poseFamilies).toHaveLength(1);
    expect(saved.poseFamilies[0]!.approved).toBe(true);
    expect(saved.poseFamilies[0]!.modelPath).toBe("test.r2d.json");
    expect(saved.render.modelPath).toBe("test.r2d.json");
    expect(saved.expressions).toEqual(["neutral", "happy", "confused", "serious"]);
  });

  it("is explicitly idempotent for an already-approved avatar after rechecking safety gates", async () => {
    const { dir, root, characterPath } = await fixture({ approved: true });
    const before = await readFile(characterPath, "utf8");
    const result = await approveImportedAvatar(dir, true, root);
    expect(result).toMatchObject({
      valid: true, status: "already-approved", approved: true, changed: false,
    });
    expect(await readFile(characterPath, "utf8")).toBe(before);
  });

  it("rejects additional pose families that are not covered by this single-pose approval flow", async () => {
    const { dir, root, characterPath } = await fixture();
    const raw = JSON.parse(await readFile(characterPath, "utf8")) as {
      poseFamilies: Array<Record<string, unknown>>;
    };
    raw.poseFamilies.push({
      name: "pointing",
      rigId: "test-avatar",
      modelPath: "test.r2d.json",
      head: "shared",
      approved: false,
    });
    await writeFile(characterPath, JSON.stringify(raw, null, 2) + "\n");
    const before = await readFile(characterPath, "utf8");

    await expect(approveImportedAvatar(dir, true, root))
      .rejects.toMatchObject({ code: "AVATAR_POSE_FAMILIES_UNSUPPORTED" });
    expect(await readFile(characterPath, "utf8")).toBe(before);
  });
});

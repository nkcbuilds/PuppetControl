import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createImportedCharacter } from "../src/character/avatar.js";
import { createAvatarBuildRecord, writeAvatarBuildRecord } from "../src/character/provenance.js";
import { approveImportedAvatar } from "../src/character/review-approval.js";
import {
  isVectorEyelidModelPath, publishVectorReviewProof,
  verifyVectorReviewProof,
} from "../src/character/vector-review-evidence.js";

const temporary: string[] = [];
const DERIVED = "test-vector-eyelids-11111111-2222-4333-8444-555555555555.r2d.json";
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function png() {
  const buffer = Buffer.alloc(32);
  PNG_HEADER.copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12);
  buffer.writeUInt32BE(512, 16);
  buffer.writeUInt32BE(640, 20);
  return buffer;
}
function mp4() {
  const buffer = Buffer.alloc(48);
  buffer.writeUInt32BE(32, 0);
  buffer.write("ftyp", 4);
  buffer.write("isom", 8);
  return buffer;
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "puppetcontrol-vector-proof-"));
  temporary.push(dir);
  const root = dirname(dir);
  const review = join(dir, "review");
  await mkdir(review);
  await mkdir(join(dir, "textures"));
  await writeFile(join(dir, "source.png"), "source-image");
  await writeFile(join(dir, "avatar.json"), '{"format":"rev2d-avatar","name":"test"}');
  await writeFile(join(dir, "textures", "face.png"), "base-face");
  await writeFile(join(dir, DERIVED), JSON.stringify({
    textures: [{ id: "face", path: "textures/face.png" }],
    parts: ["eyeR_vector_upper", "eyeR_vector_lower", "eyeL_vector_upper", "eyeL_vector_lower"]
      .map(id => ({ id })),
  }));
  const parameters = ["AngleX", "AngleY", "EyeBallX", "EyeBallY", "MouthOpen", "MouthForm"]
    .map(id => ({ id, min: -1, max: 1, default: 0 }));
  const manifest = createImportedCharacter("test", { parameters });
  manifest.render!.modelPath = DERIVED;
  manifest.poseFamilies[0]!.modelPath = DERIVED;
  await writeFile(join(dir, "character.json"), JSON.stringify(manifest, null, 2) + "\n");
  for (const name of ["poses.png", "turn.png", "eyes.png", "mouth.png"]) {
    await writeFile(join(review, name), png());
  }
  await writeFile(join(review, "synthetic-timed.mp4"), mp4());
  await writeFile(join(review, "stress.png"), png());
  await writeAvatarBuildRecord(dir, await createAvatarBuildRecord(dir, DERIVED));
  return {
    dir, root, review, model: join(dir, DERIVED),
    inputs: {
      eyeSheet: join(review, "eyes.png"), fullSheet: join(review, "poses.png"),
      timedVideo: join(review, "synthetic-timed.mp4"),
      stressSheet: join(review, "stress.png"),
    },
  };
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("vectorized eyelid current-model approval evidence", () => {
  it("requires a new model-bound review package even when four legacy PNGs exist", async () => {
    const { dir, root } = await fixture();
    expect(isVectorEyelidModelPath(DERIVED)).toBe(true);
    expect(isVectorEyelidModelPath("test.r2d.json")).toBe(false);
    await expect(approveImportedAvatar(dir, true, root))
      .rejects.toMatchObject({ code: "VECTOR_REVIEW_PROOF_MISSING_OR_STALE" });
    const manifest = JSON.parse(await readFile(join(dir, "character.json"), "utf8"));
    expect(manifest.poseFamilies[0].approved).toBe(false);
  });

  it("requires review for vector geometry even if the model filename is changed", async () => {
    const { dir, root, model } = await fixture();
    const renamed = "renamed-model.r2d.json";
    await writeFile(join(dir, renamed), await readFile(model));
    const characterPath = join(dir, "character.json");
    const manifest = JSON.parse(await readFile(characterPath, "utf8"));
    manifest.render.modelPath = renamed;
    manifest.poseFamilies[0].modelPath = renamed;
    await writeFile(characterPath, JSON.stringify(manifest, null, 2) + "\n");
    await writeAvatarBuildRecord(dir, await createAvatarBuildRecord(dir, renamed));
    await expect(approveImportedAvatar(dir, true, root))
      .rejects.toMatchObject({ code: "VECTOR_REVIEW_PROOF_MISSING_OR_STALE" });
  });

  it("accepts exact current-model sheet/video hashes but does not grant approval on publishing alone", async () => {
    const { dir, root, inputs } = await fixture();
    const result = await publishVectorReviewProof(dir, DERIVED, inputs, root);
    expect(result.proofFile).toContain("review");
    expect((await verifyVectorReviewProof(dir, DERIVED))).toHaveLength(4);
    const manifestBefore = JSON.parse(await readFile(join(dir, "character.json"), "utf8"));
    expect(manifestBefore.poseFamilies[0].approved).toBe(false);
    const approval = await approveImportedAvatar(dir, true, root);
    expect(approval.status).toBe("approved");
    expect(approval.reviewArtifacts).toHaveLength(8);
  });

  it("rejects a modified image after the review proof was produced", async () => {
    const { dir, root, inputs } = await fixture();
    const result = await publishVectorReviewProof(dir, DERIVED, inputs, root);
    await writeFile(result.eyes, Buffer.concat([await readFile(result.eyes), Buffer.from("tampered")]));
    await expect(approveImportedAvatar(dir, true, root))
      .rejects.toMatchObject({ code: "VECTOR_REVIEW_PROOF_MISSING_OR_STALE" });
  });

  it("rejects old version-one evidence that lacks the combined-control stress sheet", async () => {
    const { dir, root, inputs } = await fixture();
    const result = await publishVectorReviewProof(dir, DERIVED, inputs, root);
    const old = JSON.parse(await readFile(result.proofFile, "utf8"));
    old.version = 1;
    delete old.artifacts.stress;
    await writeFile(result.proofFile, JSON.stringify(old));
    await expect(approveImportedAvatar(dir, true, root))
      .rejects.toMatchObject({ code: "VECTOR_REVIEW_PROOF_MISSING_OR_STALE" });
    const manifest = JSON.parse(await readFile(join(dir, "character.json"), "utf8"));
    expect(manifest.poseFamilies[0].approved).toBe(false);
  });

  it("rejects tampered combined-control eye stress evidence", async () => {
    const { dir, root, inputs } = await fixture();
    const proof = await publishVectorReviewProof(dir, DERIVED, inputs, root);
    await writeFile(proof.stress, Buffer.concat([await readFile(proof.stress), Buffer.from("changed")]));
    await expect(approveImportedAvatar(dir, true, root))
      .rejects.toMatchObject({ code: "VECTOR_REVIEW_PROOF_MISSING_OR_STALE" });
  });

  it("rejects a proof after a new model build record replaces the previous model hash", async () => {
    const { dir, root, model, inputs } = await fixture();
    await publishVectorReviewProof(dir, DERIVED, inputs, root);
    const changed = JSON.parse(await readFile(model, "utf8"));
    changed.experiment = "later re-rigging";
    await writeFile(model, JSON.stringify(changed));
    await writeAvatarBuildRecord(dir, await createAvatarBuildRecord(dir, DERIVED));
    await expect(approveImportedAvatar(dir, true, root))
      .rejects.toMatchObject({ code: "VECTOR_REVIEW_PROOF_MISSING_OR_STALE" });
  });

  it("rejects altered sidecar paths, missing MP4 evidence, and mismatched model identity", async () => {
    const { dir, root, inputs } = await fixture();
    const result = await publishVectorReviewProof(dir, DERIVED, inputs, root);
    const wrongModel = "test-vector-eyelids-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.r2d.json";
    await expect(verifyVectorReviewProof(dir, wrongModel))
      .rejects.toMatchObject({ code: "VECTOR_REVIEW_PROOF_MISSING_OR_STALE" });
    const proof = JSON.parse(await readFile(result.proofFile, "utf8"));
    proof.artifacts.eyes.path = "../../outside.png";
    await writeFile(result.proofFile, JSON.stringify(proof));
    await expect(verifyVectorReviewProof(dir, DERIVED))
      .rejects.toMatchObject({ code: "VECTOR_REVIEW_PROOF_MISSING_OR_STALE" });
    await expect(publishVectorReviewProof(dir, DERIVED,
      { ...inputs, timedVideo: undefined }, root))
      .rejects.toMatchObject({ code: "VECTOR_REVIEW_PROOF_MISSING_OR_STALE" });
  });
});

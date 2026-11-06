import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarWorkflowError } from "../src/character/avatar.js";
import { composeCandidate, verifyCandidateScope, preserveAvatarBackup } from "../src/character/landmarks.js";

const source = "a".repeat(64);
const spec = {
  format: "rev2d-avatar",
  name: "sample",
  image: { file: "source.png", width: 512, height: 640 },
  head: { center: null },
  face: { eyes: {} },
  body: { pivot: null },
  build: { feather: 1 },
  post: [{ kind: "binding", id: "existing" }],
};

const landmarks = {
  head: { center: [256, 240], radius: [150, 200] },
  face: { eyes: { imageLeft: {}, imageRight: {} } },
  body: { pivot: [256, 450], fade: [400, 600] },
};

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    format: "puppetcontrol-landmarks-v1",
    sourceSha256: source,
    landmarks,
    ...overrides,
  };
}

describe("staged agent landmark proposals", () => {
  it("preserves the source file, model ID, build settings, and existing custom ops", () => {
    const result = composeCandidate(spec, proposal(), source);
    expect(result.image).toEqual(spec.image);
    expect(result.name).toBe("sample");
    expect(result.post).toEqual(spec.post);
    expect(result.build).toEqual(spec.build);
    expect(result.head).toEqual(landmarks.head);
    expect(result.face).toEqual(landmarks.face);
    expect(result.body).toEqual(landmarks.body);
    expect(spec.head).toEqual({ center: null });
  });

  it("rejects a proposal referring to a different source illustration", () => {
    expect(() => composeCandidate(spec, proposal({ sourceSha256: "b".repeat(64) }), source))
      .toThrowError(AvatarWorkflowError);
  });

  it("rejects a filename/URL override, even when the source hash matches", () => {
    expect(() => composeCandidate(spec, proposal({ image: { file: "../outside.png" } }), source))
      .toThrow(/Unexpected proposal property/);
    expect(() => composeCandidate(spec, proposal({
      landmarks: { ...landmarks, image: { file: "other.png" } },
    }), source)).toThrow(/geometry groups/);
  });

  it("requires complete core geometry groups and safe notes", () => {
    expect(() => composeCandidate(spec, proposal({ landmarks: { head: landmarks.head } }), source))
      .toThrow(/Missing required landmark group/);
    expect(() => composeCandidate(spec, proposal({ notes: "x".repeat(2100) }), source))
      .toThrow(/short string/);
    expect(() => composeCandidate(spec, proposal({ landmarks: null }), source))
      .toThrow(/only landmark geometry/);
  });

  it("rejects tampered candidate config even if metadata hashes were recomputed", () => {
    const valid = composeCandidate(spec, proposal(), source);
    expect(() => verifyCandidateScope(spec, valid)).not.toThrow();
    expect(() => verifyCandidateScope(spec, { ...valid, image: { file: "outside.png" } }))
      .toThrow(/protected field: image/);
    expect(() => verifyCandidateScope(spec, { ...valid, post: [{ kind: "exec", command: "danger" }] }))
      .toThrow(/protected field: post/);
    expect(() => verifyCandidateScope(spec, { ...valid, unrelated: true }))
      .toThrow(/protected field: unrelated/);
    expect(() => verifyCandidateScope(spec, { ...valid, head: null }))
      .toThrow(/landmark group missing/);
  });

  it("reuses identical existing backups but rejects conflicting backups", async () => {
    const directory = await mkdtemp(join(tmpdir(), "puppetcontrol-backup-"));
    const backup = join(directory, "avatar.json.bak");
    const original = Buffer.from('{"head":{"center":[100,200]}}');
    try {
      await preserveAvatarBackup(backup, original);
      await preserveAvatarBackup(backup, original);
      expect(await readFile(backup)).toEqual(original);
      await writeFile(backup, Buffer.from('{"tampered":true}'));
      await expect(preserveAvatarBackup(backup, original))
        .rejects.toMatchObject({ code: "BACKUP_CONFLICT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains optional groups or accepts explicit replacements", () => {
    const replacement = composeCandidate({
      ...spec,
      hair: { strands: [{ id: "hair01" }] },
      attachments: [{ id: "bow" }],
    }, proposal(), source);
    expect(replacement.hair).toEqual({ strands: [{ id: "hair01" }] });
    expect(replacement.attachments).toEqual([{ id: "bow" }]);
    const empty = composeCandidate(spec, proposal({
      landmarks: { ...landmarks, hair: { strands: [] }, attachments: [] },
    }), source);
    expect(empty.hair).toEqual({ strands: [] });
    expect(empty.attachments).toEqual([]);
  });
});

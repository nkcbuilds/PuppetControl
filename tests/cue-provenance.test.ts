import { afterEach, describe, expect, it } from "vitest";
import {
  copyFile, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import {
  CUE_BINDING_FORMAT,
  CUE_BINDING_VERSION,
  createCueBinding,
  verifyCueBinding,
} from "../src/audio/cue-provenance.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function cuesJson(value = "A") {
  return JSON.stringify({
    metadata: { soundFile: "voice.wav", duration: 0.2 },
    mouthCues: [{ start: 0, end: 0.2, value }],
  }) + "\n";
}

async function fixture() {
  const cache = join(process.cwd(), ".cache");
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, "cue-provenance-test-"));
  cleanup.push(dir);
  const audio = join(dir, "voice.wav");
  const cues = join(dir, "voice.cues.json");
  const sidecar = join(dir, "voice.cues.binding.json");
  await writeFile(audio, Buffer.from("RIFF-test-audio-bytes-v1"));
  await writeFile(cues, cuesJson());
  return { dir, audio, cues, sidecar };
}

function canonical(path: string) {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

describe("Rhubarb cue provenance sidecar", () => {
  it("creates deterministic v1 metadata bound to exact bytes and canonical workspace paths", async () => {
    const { audio, cues, sidecar } = await fixture();

    const binding = await createCueBinding(audio, cues, sidecar);
    expect(binding).toMatchObject({
      format: CUE_BINDING_FORMAT,
      version: CUE_BINDING_VERSION,
      hashAlgorithm: "sha256",
      sidecarPath: canonical(sidecar),
      audio: { path: canonical(audio) },
      cues: { path: canonical(cues) },
    });
    expect(binding.audio.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(binding.cues.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(isAbsolute(binding.audio.path)).toBe(false);
    expect(isAbsolute(binding.cues.path)).toBe(false);
    expect(isAbsolute(binding.sidecarPath)).toBe(false);

    const disk = JSON.parse(await readFile(sidecar, "utf8")) as unknown;
    expect(disk).toEqual(binding);
    expect(await verifyCueBinding(audio, cues, sidecar)).toEqual({ valid: true, binding });
  });

  it("refuses to bind malformed or empty Rhubarb cue data", async () => {
    const malformed = await fixture();
    await writeFile(malformed.cues, JSON.stringify({ metadata: {}, mouthCues: [] }));
    await expect(createCueBinding(malformed.audio, malformed.cues, malformed.sidecar))
      .rejects.toThrow("at least one mouth cue");
    expect(await verifyCueBinding(malformed.audio, malformed.cues, malformed.sidecar))
      .toMatchObject({ valid: false, code: "CUE_BINDING_MISSING_OR_INVALID" });
  });

  it("fails closed if either audio or cue bytes change", async () => {
    const first = await fixture();
    await createCueBinding(first.audio, first.cues, first.sidecar);
    await writeFile(first.audio, Buffer.from("RIFF-tampered-audio"));
    expect(await verifyCueBinding(first.audio, first.cues, first.sidecar))
      .toMatchObject({ valid: false, code: "CUE_BINDING_STALE" });

    const second = await fixture();
    await createCueBinding(second.audio, second.cues, second.sidecar);
    await writeFile(second.cues, cuesJson("B"));
    expect(await verifyCueBinding(second.audio, second.cues, second.sidecar))
      .toMatchObject({ valid: false, code: "CUE_BINDING_STALE" });
  });

  it("fails closed on missing, malformed, or unsupported sidecars", async () => {
    const { audio, cues, sidecar } = await fixture();
    expect(await verifyCueBinding(audio, cues, sidecar))
      .toMatchObject({ valid: false, code: "CUE_BINDING_MISSING_OR_INVALID" });

    await writeFile(sidecar, "{");
    expect(await verifyCueBinding(audio, cues, sidecar))
      .toMatchObject({ valid: false, code: "CUE_BINDING_MISSING_OR_INVALID" });

    await rm(sidecar);
    const binding = await createCueBinding(audio, cues, sidecar);
    await writeFile(sidecar, JSON.stringify({ ...binding, version: 2 }));
    expect(await verifyCueBinding(audio, cues, sidecar))
      .toMatchObject({ valid: false, code: "CUE_BINDING_MISSING_OR_INVALID" });
  });

  it("binds the sidecar to its canonical location and refuses silent rebinding", async () => {
    const { dir, audio, cues, sidecar } = await fixture();
    const binding = await createCueBinding(audio, cues, sidecar);

    await expect(createCueBinding(audio, cues, sidecar))
      .rejects.toMatchObject({ code: "CUE_BINDING_EXISTS" });
    expect(JSON.parse(await readFile(sidecar, "utf8"))).toEqual(binding);

    const copied = join(dir, "copied.binding.json");
    await copyFile(sidecar, copied);
    expect(await verifyCueBinding(audio, cues, copied))
      .toMatchObject({ valid: false, code: "CUE_BINDING_STALE" });
  });

  it("canonicalizes safe in-workspace symlink aliases", async () => {
    const { dir, cues, sidecar } = await fixture();
    const targetDir = join(dir, "real-audio");
    const aliasDir = join(dir, "audio-alias");
    await mkdir(targetDir);
    const audio = join(targetDir, "voice.wav");
    await writeFile(audio, Buffer.from("RIFF-symlinked-audio"));
    await symlink(targetDir, aliasDir, process.platform === "win32" ? "junction" : "dir");

    const throughAlias = join(aliasDir, "voice.wav");
    const binding = await createCueBinding(throughAlias, cues, sidecar);
    expect(binding.audio.path).toBe(canonical(audio));
    expect(await verifyCueBinding(throughAlias, cues, sidecar)).toEqual({ valid: true, binding });
  });

  it("rejects symlink escapes outside the workspace for inputs and sidecars", async () => {
    const { dir, audio, cues, sidecar } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "puppetcontrol-cue-outside-"));
    cleanup.push(outside);
    await writeFile(join(outside, "outside.wav"), Buffer.from("RIFF-outside"));
    const escape = join(dir, "escape");
    await symlink(outside, escape, process.platform === "win32" ? "junction" : "dir");

    await expect(createCueBinding(join(escape, "outside.wav"), cues, sidecar))
      .rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });

    const outsideSidecar = join(escape, "binding.json");
    await expect(createCueBinding(audio, cues, outsideSidecar))
      .rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });
    expect(await verifyCueBinding(audio, cues, outsideSidecar))
      .toMatchObject({ valid: false, code: "CUE_BINDING_MISSING_OR_INVALID" });
  });
});

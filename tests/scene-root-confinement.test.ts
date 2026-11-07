import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadAndValidateScene } from "../src/scene/load.js";
import { createCueBinding } from "../src/audio/cue-provenance.js";

let home = "";
let scope = "";
let sibling = "";
let sceneFile = "";
const scene = (audio: unknown[] = [], characterPath = "character.json") => ({
  schemaVersion: 1, id: "scoped", durationMs: 3000, fps: 15,
  resolution: { width: 512, height: 640 },
  actors: [{ id: "hana", characterPath }],
  events: [], audio,
});

beforeEach(async () => {
  await mkdir(resolve(".cache"), { recursive: true });
  home = await mkdtemp(resolve(".cache", "load-root-"));
  scope = join(home, "scoped");
  sibling = join(home, "outside-scope");
  await mkdir(scope);
  await mkdir(sibling);
  sceneFile = join(scope, "scene.json");
  const original = await readFile(resolve("examples/characters/hana/character.json"));
  await writeFile(join(scope, "character.json"), original);
  await writeFile(join(sibling, "character.json"), original);
});
afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true });
});

describe("scene and voice confinement to an explicit root", () => {
  it("allows a local scene and actor", async () => {
    await writeFile(sceneFile, JSON.stringify(scene()));
    const result = await loadAndValidateScene(sceneFile, { root: scope });
    expect(result.valid).toBe(true);
  });

  it("does not throw on an out-of-root scene", async () => {
    const result = await loadAndValidateScene(join(sibling, "scene.json"), { root: scope });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.diagnostics[0]?.code).toBe("SCENE_PATH_OUTSIDE_WORKSPACE");
  });

  it("rejects escaped WAV/cue/sidecar paths before verifying a bound file", async () => {
    await writeFile(sceneFile, JSON.stringify(scene([{
      actor: "hana", path: "../outside-scope/voice.wav",
      cuesPath: "../outside-scope/cues.json",
      bindingPath: "../outside-scope/voice.binding.json", startMs: 0,
    }])));
    const result = await loadAndValidateScene(sceneFile, { root: scope });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.diagnostics.map((d) => d.code))
      .toContain("AUDIO_PATH_OUTSIDE_WORKSPACE");
  });

  it("also refuses escaped unbound audio", async () => {
    await writeFile(sceneFile, JSON.stringify(scene([{
      actor: "hana", path: "../outside-scope/voice.wav", startMs: 0,
    }])));
    const result = await loadAndValidateScene(sceneFile, { root: scope });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.diagnostics.map((d) => d.code))
      .toContain("AUDIO_PATH_OUTSIDE_WORKSPACE");
  });

  it("rejects a character reached through a symlink/junction to a sibling directory", async () => {
    const alias = join(scope, "linked");
    await symlink(sibling, alias, process.platform === "win32" ? "junction" : "dir");
    await writeFile(sceneFile, JSON.stringify(scene([], "linked/character.json")));
    const result = await loadAndValidateScene(sceneFile, { root: scope });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.diagnostics.some((d) =>
      d.code === "CHARACTER_LOAD_FAILED")).toBe(true);
  });

  it("accepts a correctly bound voice/cue file entirely inside the specified root", async () => {
    const wav = join(scope, "voice.wav");
    const cues = join(scope, "cues.json");
    const sidecar = join(scope, "voice.binding.json");
    await writeFile(wav, Buffer.from("RIFF-voice-fixture"));
    await writeFile(cues, JSON.stringify({
      metadata: { duration: 0.3, soundFile: "voice.wav" },
      mouthCues: [{ start: 0, end: 0.3, value: "A" }],
    }));
    await createCueBinding(wav, cues, sidecar);
    await writeFile(sceneFile, JSON.stringify(scene([{
      actor: "hana", path: "./voice.wav", cuesPath: "./cues.json",
      bindingPath: "./voice.binding.json", startMs: 0,
    }])));
    const result = await loadAndValidateScene(sceneFile, { root: scope });
    expect(result.valid).toBe(true);
  });
});

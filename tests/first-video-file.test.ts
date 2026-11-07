import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createFirstVideoFile } from "../src/scene/create-first-video-file.js";
import { loadAndValidateScene } from "../src/scene/load.js";
import { createCueBinding } from "../src/audio/cue-provenance.js";

let root = "";
let working = "";
let hana = "";
beforeEach(async () => {
  root = resolve(process.cwd());
  await mkdir(resolve(root, ".cache"), { recursive: true });
  working = await mkdtemp(join(resolve(root, ".cache"), "first-video-file-"));
  // Hermetic fixture: CI intentionally does not install the ignored .cache/rev2d
  // backend. We only test scene-file composition, not real model rendering.
  const character = JSON.parse(
    await readFile(resolve(root, "examples/characters/hana/character.json"), "utf8"),
  ) as { render: { modelPath: string } };
  character.render.modelPath = "fixture.r2d.json";
  hana = join(working, "character.json");
  await writeFile(hana, JSON.stringify(character));
  await writeFile(join(working, "fixture.r2d.json"), JSON.stringify({
    meta: { name: "test-rig", width: 512, height: 640 },
    parameters: [], animations: [],
  }));
});
afterEach(async () => {
  if (working) await rm(working, { recursive: true, force: true });
});

describe("first-video file creation", () => {
  it("creates two editable scenes using exactly one already approved rig without mutating the character", async () => {
    const before = await readFile(hana, "utf8");
    const outputs = [join(working, "first.json"), join(working, "revision.json")];
    for (let i = 0; i < outputs.length; i++) {
      const result = await createFirstVideoFile({
        outputSceneFile: outputs[i]!, characterFile: hana,
        id: "hana-test-" + i, seconds: 4, fps: 15,
      }, root);
      expect(result).toMatchObject({
        valid: true, reusedExistingRig: true,
        durationMs: 4000, fps: 15, hasVoice: false,
      });
      const parsed = await loadAndValidateScene(outputs[i]!);
      expect(parsed.valid).toBe(true);
      if (parsed.valid) {
        expect(parsed.scene.actors[0]?.id).toBe("hana");
        expect(resolve(working, parsed.scene.actors[0]!.characterPath)).toBe(hana);
        expect(parsed.scene.events.every((event) => event.kind !== "motion" && event.kind !== "caption")).toBe(true);
      }
    }
    expect(await readFile(hana, "utf8")).toBe(before);
    const first = JSON.parse(await readFile(outputs[0]!, "utf8"));
    const second = JSON.parse(await readFile(outputs[1]!, "utf8"));
    expect(first.id).not.toBe(second.id);
    expect(first.actors[0].characterPath).toBe(second.actors[0].characterPath);
  });

  it("binds voice and Rhubarb cues to immutable bytes and refuses stale audio before rendering", async () => {
    const output = join(working, "bound-scene.json");
    const wav = join(working, "voice.wav");
    const cues = join(working, "voice.cues.json");
    const sidecar = join(working, "voice.binding.json");
    await writeFile(wav, Buffer.from("RIFF-test-voice-content"));
    await writeFile(cues, JSON.stringify({
      metadata: { soundFile: "voice.wav", duration: 0.2 },
      mouthCues: [{ start: 0, end: 0.2, value: "A" }],
    }));
    await createCueBinding(wav, cues, sidecar);
    const created = await createFirstVideoFile({
      outputSceneFile: output, characterFile: hana, voiceFile: wav, cuesFile: cues,
      bindingFile: sidecar, seconds: 3,
    }, root);
    expect(created.voiceBoundToCues).toBe(true);
    const first = await loadAndValidateScene(output);
    expect(first.valid).toBe(true);
    await writeFile(wav, Buffer.from("RIFF-tampered-voice"));
    const next = await loadAndValidateScene(output);
    expect(next.valid).toBe(false);
    if (!next.valid) {
      expect(next.diagnostics.map((diagnostic) => diagnostic.code)).toContain("CUE_BINDING_STALE");
    }
  });

  it("derives distinct default scene IDs from distinct filenames", async () => {
    const first = join(working, "first-clip.json");
    const second = join(working, "second-clip.json");
    await createFirstVideoFile({ outputSceneFile: first, characterFile: hana, seconds: 3 }, root);
    await createFirstVideoFile({ outputSceneFile: second, characterFile: hana, seconds: 3 }, root);
    expect(JSON.parse(await readFile(first, "utf8")).id).toBe("first-clip");
    expect(JSON.parse(await readFile(second, "utf8")).id).toBe("second-clip");
  });

  it("refuses silent overwrite of a previously authored scene", async () => {
    const output = join(working, "existing.json");
    await writeFile(output, "{\"author\":\"do not overwrite\"}");
    await expect(createFirstVideoFile({ outputSceneFile: output, characterFile: hana }, root))
      .rejects.toThrow();
    expect(await readFile(output, "utf8")).toContain("do not overwrite");
  });

  it("requires cues when voice is requested and never fakes alignment", async () => {
    const output = join(working, "voice.json");
    await writeFile(join(working, "voice.wav"), Buffer.from([1, 2, 3]));
    await expect(createFirstVideoFile({
      outputSceneFile: output, characterFile: hana,
      voiceFile: join(working, "voice.wav"),
    }, root)).rejects.toMatchObject({ code: "FIRST_VIDEO_VOICE_CUES_REQUIRED" });
  });

  it("refuses unapproved imported-style characters rather than silently granting approval", async () => {
    const manifest = JSON.parse(await readFile(hana, "utf8"));
    manifest.poseFamilies[0].approved = false;
    manifest.render.modelPath = "fixture.r2d.json";
    const file = join(working, "unapproved.json");
    await writeFile(file, JSON.stringify(manifest));
    await expect(createFirstVideoFile({
      outputSceneFile: join(working, "blocked.json"), characterFile: file,
    }, root)).rejects.toMatchObject({ code: "FIRST_VIDEO_NOT_REVIEWED" });
  });

  it("refuses output files outside the workspace", async () => {
    await expect(createFirstVideoFile({
      outputSceneFile: resolve(root, "..", "outside-project.scene.json"),
      characterFile: hana,
    }, root)).rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createCueBinding } from "../src/audio/cue-provenance.js";
import { snapshotBoundSpeech } from "../src/render/speech-snapshot.js";

let dir = "";
let wav = "";
let cues = "";
let sidecar = "";
const initialAudio = Buffer.from("RIFF-demo-voice-contents");
const initialCues = JSON.stringify({
  metadata: { soundFile: "voice.wav", duration: 0.25 },
  mouthCues: [{ start: 0, end: 0.25, value: "A" }],
});

beforeEach(async () => {
  await mkdir(resolve(".cache"), { recursive: true });
  dir = await mkdtemp(resolve(".cache", "bound-speech-snapshot-"));
  wav = join(dir, "voice.wav");
  cues = join(dir, "cues.json");
  sidecar = join(dir, "cues.binding.json");
  await writeFile(wav, initialAudio);
  await writeFile(cues, initialCues);
  await createCueBinding(wav, cues, sidecar);
});
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("verified speech uses per-render immutable-by-origin copies", () => {
  it("parses the copied cue bytes and supplies FFmpeg only the copied audio", async () => {
    const snapshot = await snapshotBoundSpeech(wav, cues, sidecar, join(dir, "private-a"));
    expect(snapshot.audioPath).toContain("private-a");
    expect(snapshot.cues).toHaveLength(1);
    expect(await readFile(snapshot.audioPath)).toEqual(initialAudio);

    await writeFile(wav, Buffer.from("RIFF-swapped-unapproved-voice"));
    await writeFile(cues, '{"not":"rhubarb cues"}');

    expect(await readFile(snapshot.audioPath)).toEqual(initialAudio);
    expect(snapshot.cues[0]?.value).toBe("A");
  });

  it("refuses changed voice bytes before materializing the snapshot", async () => {
    await writeFile(wav, Buffer.from("RIFF-unauthorized"));
    await expect(snapshotBoundSpeech(wav, cues, sidecar, join(dir, "private-b")))
      .rejects.toMatchObject({ code: "CUE_BINDING_STALE" });
  });

  it("refuses changed cues before materializing the snapshot", async () => {
    await writeFile(cues, JSON.stringify({
      metadata: { soundFile: "voice.wav", duration: 0.25 },
      mouthCues: [{ start: 0, end: 0.25, value: "B" }],
    }));
    await expect(snapshotBoundSpeech(wav, cues, sidecar, join(dir, "private-c")))
      .rejects.toMatchObject({ code: "CUE_BINDING_STALE" });
  });

  it("rejects reusing a previously created private output directory", async () => {
    const name = join(dir, "private-d");
    await snapshotBoundSpeech(wav, cues, sidecar, name);
    await expect(snapshotBoundSpeech(wav, cues, sidecar, name)).rejects.toThrow();
  });
});

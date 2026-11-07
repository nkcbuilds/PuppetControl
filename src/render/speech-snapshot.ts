/**
 * Consume exact verified WAV/cue bytes from private per-render copies.
 *
 * Checking a sidecar and later passing the *original* filename to FFmpeg
 * leaves a replacement window. This helper copies both inputs into a fresh
 * render-only folder and checks each copied byte stream against the binding.
 * Rev2D receives cues parsed from that copied JSON; FFmpeg receives the copied
 * audio path. Source-file replacement afterward cannot affect this export.
 *
 * As with rig snapshots, no Node filesystem API can defend an ignored render
 * directory against a malicious same-user process modifying the copies.
 */
import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { checkedPath } from "../character/avatar.js";
import { parseRhubarbMouthCuesJson } from "../audio/rhubarb.js";
import { verifyCueBinding, CueBindingError } from "../audio/cue-provenance.js";

const MAX_AUDIO = 200 * 1024 * 1024;
const MAX_CUES = 5 * 1024 * 1024;

async function hashStream(path: string, max: number): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > max) {
    throw new CueBindingError("CUE_BINDING_STALE", "Snapshot input missing, empty or oversized");
  }
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

export async function snapshotBoundSpeech(
  originalAudio: string,
  originalCues: string,
  sidecarFile: string,
  destination: string,
  root = process.cwd(),
): Promise<{ audioPath: string; cues: ReturnType<typeof parseRhubarbMouthCuesJson> }> {
  const audio = await checkedPath(root, resolve(originalAudio));
  const cues = await checkedPath(root, resolve(originalCues));
  const bindingFile = await checkedPath(root, resolve(sidecarFile));
  const verified = await verifyCueBinding(audio, cues, bindingFile);
  if (!verified.valid) {
    throw new CueBindingError(verified.code, verified.message);
  }

  const dst = await checkedPath(root, resolve(destination));
  await checkedPath(root, dirname(dst));
  await mkdir(dst); // Caller supplies a unique, never-reused render directory.
  const suffix = extname(audio).toLowerCase();
  if (![".wav", ".mp3", ".m4a", ".flac", ".ogg"].includes(suffix)) {
    throw new CueBindingError("CUE_BINDING_INPUT_INVALID",
      "Bound speech audio must use a supported, explicit audio extension");
  }
  const audioPath = await checkedPath(dst, join(dst, "voice" + suffix));
  const cuesPath = await checkedPath(dst, join(dst, "mouth-cues.json"));
  await copyFile(audio, audioPath, constants.COPYFILE_EXCL);
  await copyFile(cues, cuesPath, constants.COPYFILE_EXCL);

  // Compare the copied files with immutable expected hashes from the verified
  // binding, not with a fresh read of potentially replaced original paths.
  const [audioHash, cueBytes] = await Promise.all([
    hashStream(audioPath, MAX_AUDIO),
    readFile(cuesPath),
  ]);
  if (cueBytes.length < 1 || cueBytes.length > MAX_CUES) {
    throw new CueBindingError("CUE_BINDING_STALE", "Snapshot Rhubarb cues are missing or oversized");
  }
  const cuesHash = createHash("sha256").update(cueBytes).digest("hex");
  if (audioHash !== verified.binding.audio.sha256 ||
      cuesHash !== verified.binding.cues.sha256) {
    throw new CueBindingError("CUE_BINDING_STALE",
      "Audio/cues changed between verification and copying into the renderer");
  }
  const parsed = parseRhubarbMouthCuesJson(cueBytes.toString("utf8"));
  if (!parsed.length) {
    throw new CueBindingError("CUE_BINDING_INPUT_INVALID", "Bound Rhubarb cue list is empty");
  }
  return { audioPath, cues: parsed };
}

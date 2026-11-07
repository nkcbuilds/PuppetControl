import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { checkedPath } from "../character/avatar.js";
import { parseRhubarbMouthCuesJson } from "./rhubarb.js";

export const CUE_BINDING_FORMAT = "puppetcontrol-rhubarb-cue-binding";
export const CUE_BINDING_VERSION = 1;

const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const MAX_CUES_BYTES = 5 * 1024 * 1024;
const MAX_SIDECAR_BYTES = 64 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

const canonicalPathSchema = z.string().min(1).max(1024).refine((value) => {
  if (value.includes("\\") || value.includes(":") || value.startsWith("/")) return false;
  return !value.split("/").some((segment) => !segment || segment === "." || segment === "..");
}, "Expected a canonical workspace-relative path");

const fileBindingSchema = z.strictObject({
  path: canonicalPathSchema,
  sha256: z.string().regex(SHA256),
});

export const cueBindingSchema = z.strictObject({
  format: z.literal(CUE_BINDING_FORMAT),
  version: z.literal(CUE_BINDING_VERSION),
  hashAlgorithm: z.literal("sha256"),
  sidecarPath: canonicalPathSchema,
  audio: fileBindingSchema,
  cues: fileBindingSchema,
});

export type CueBinding = z.infer<typeof cueBindingSchema>;

export type CueBindingVerification =
  | { valid: true; binding: CueBinding }
  | {
      valid: false;
      code: "CUE_BINDING_MISSING_OR_INVALID" | "CUE_BINDING_STALE";
      message: string;
    };

export class CueBindingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CueBindingError";
  }
}

interface WorkspaceFile {
  fullPath: string;
  canonicalPath: string;
}

function relativeCanonical(rootReal: string, fullPath: string): string {
  const rel = relative(rootReal, fullPath);
  if (!rel || rel === ".." || rel.startsWith(".." + sep)) {
    throw new CueBindingError("CUE_BINDING_PATH_INVALID", "Cue binding files must stay inside the workspace");
  }
  return rel.replaceAll("\\", "/");
}

async function existingWorkspaceFile(
  rootReal: string,
  input: string,
  label: string,
  maxBytes: number,
): Promise<WorkspaceFile> {
  const lexicalPath = await checkedPath(rootReal, resolve(rootReal, input));
  const fullPath = await realpath(lexicalPath);
  await checkedPath(rootReal, fullPath);
  const info = await stat(fullPath);
  if (!info.isFile() || info.size < 1 || info.size > maxBytes) {
    throw new CueBindingError(
      "CUE_BINDING_INPUT_INVALID",
      label + " must be a nonempty regular file no larger than " + maxBytes + " bytes",
    );
  }
  return { fullPath, canonicalPath: relativeCanonical(rootReal, fullPath) };
}

async function newSidecarPath(rootReal: string, input: string): Promise<WorkspaceFile> {
  const lexicalPath = await checkedPath(rootReal, resolve(rootReal, input));
  const parentReal = await realpath(dirname(lexicalPath));
  await checkedPath(rootReal, parentReal);
  const fullPath = join(parentReal, basename(lexicalPath));
  await checkedPath(rootReal, fullPath);
  return { fullPath, canonicalPath: relativeCanonical(rootReal, fullPath) };
}

async function existingSidecarPath(rootReal: string, input: string): Promise<WorkspaceFile> {
  return existingWorkspaceFile(rootReal, input, "Cue binding sidecar", MAX_SIDECAR_BYTES);
}

async function fingerprint(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function resolveInputs(audioFile: string, cuesFile: string) {
  const rootReal = await realpath(process.cwd());
  const [audio, cues] = await Promise.all([
    existingWorkspaceFile(rootReal, audioFile, "Audio file", MAX_AUDIO_BYTES),
    existingWorkspaceFile(rootReal, cuesFile, "Rhubarb cues file", MAX_CUES_BYTES),
  ]);
  if (audio.fullPath === cues.fullPath) {
    throw new CueBindingError("CUE_BINDING_INPUT_INVALID", "Audio and Rhubarb cues must be different files");
  }
  return { rootReal, audio, cues };
}

/**
 * Create a deterministic integrity sidecar for one already-aligned Rhubarb cue file.
 *
 * The record contains only workspace-relative canonical paths and SHA-256 hashes.
 * It does not prove who created/reviewed the cues and does not generate lip-sync data.
 * Existing sidecars are never overwritten: rebinding must be an explicit caller action.
 */
export async function createCueBinding(
  audioFile: string,
  cuesFile: string,
  sidecarFile: string,
): Promise<CueBinding> {
  const { rootReal, audio, cues } = await resolveInputs(audioFile, cuesFile);
  const sidecar = await newSidecarPath(rootReal, sidecarFile);
  if (sidecar.fullPath === audio.fullPath || sidecar.fullPath === cues.fullPath) {
    throw new CueBindingError("CUE_BINDING_PATH_INVALID", "Cue binding sidecar must be a separate file");
  }

  // Parse the *same* bytes we hash. A separate filename reopen for the cue
  // digest could otherwise hash a replacement file after parsing an older one.
  const cueBytes = await readFile(cues.fullPath);
  if (cueBytes.length < 1 || cueBytes.length > MAX_CUES_BYTES) {
    throw new CueBindingError("CUE_BINDING_INPUT_INVALID", "Rhubarb cues are empty or oversized");
  }
  const parsedCues = parseRhubarbMouthCuesJson(cueBytes.toString("utf8"));
  if (parsedCues.length === 0) {
    throw new CueBindingError("CUE_BINDING_INPUT_INVALID", "Rhubarb cue file must contain at least one mouth cue");
  }
  const cuesSha256 = createHash("sha256").update(cueBytes).digest("hex");
  const audioSha256 = await fingerprint(audio.fullPath);
  const binding = cueBindingSchema.parse({
    format: CUE_BINDING_FORMAT,
    version: CUE_BINDING_VERSION,
    hashAlgorithm: "sha256",
    sidecarPath: sidecar.canonicalPath,
    audio: { path: audio.canonicalPath, sha256: audioSha256 },
    cues: { path: cues.canonicalPath, sha256: cuesSha256 },
  });

  let handle;
  try {
    handle = await open(sidecar.fullPath, "wx");
    await handle.writeFile(JSON.stringify(binding, null, 2) + "\n", "utf8");
    await handle.sync();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new CueBindingError(
        "CUE_BINDING_EXISTS",
        "Cue binding sidecar already exists; verify it instead of silently rebinding changed inputs",
      );
    }
    throw error;
  } finally {
    await handle?.close();
  }

  return binding;
}

/**
 * Verify that the sidecar still refers to these exact canonical files and exact bytes.
 * Missing, malformed, moved, or modified files fail closed and never read paths from
 * untrusted sidecar metadata.
 */
export async function verifyCueBinding(
  audioFile: string,
  cuesFile: string,
  sidecarFile: string,
): Promise<CueBindingVerification> {
  try {
    const { rootReal, audio, cues } = await resolveInputs(audioFile, cuesFile);
    const sidecar = await existingSidecarPath(rootReal, sidecarFile);
    if (sidecar.fullPath === audio.fullPath || sidecar.fullPath === cues.fullPath) {
      return {
        valid: false,
        code: "CUE_BINDING_MISSING_OR_INVALID",
        message: "Cue binding sidecar must be separate from the audio and cue files",
      };
    }

    const raw = await readFile(sidecar.fullPath, "utf8");
    const binding = cueBindingSchema.parse(JSON.parse(raw) as unknown);
    if (
      binding.sidecarPath !== sidecar.canonicalPath ||
      binding.audio.path !== audio.canonicalPath ||
      binding.cues.path !== cues.canonicalPath
    ) {
      return {
        valid: false,
        code: "CUE_BINDING_STALE",
        message: "Cue binding canonical paths no longer match the requested audio, cues, or sidecar",
      };
    }

    const [audioSha256, cuesSha256] = await Promise.all([
      fingerprint(audio.fullPath),
      fingerprint(cues.fullPath),
    ]);
    if (binding.audio.sha256 !== audioSha256 || binding.cues.sha256 !== cuesSha256) {
      return {
        valid: false,
        code: "CUE_BINDING_STALE",
        message: "Audio or Rhubarb cue bytes changed after the cue binding was created",
      };
    }
    return { valid: true, binding };
  } catch (error) {
    return {
      valid: false,
      code: "CUE_BINDING_MISSING_OR_INVALID",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

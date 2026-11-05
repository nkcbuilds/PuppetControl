import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { promisify } from "node:util";
import { parseRhubarbMouthCuesJson } from "./rhubarb.js";

const execFileAsync = promisify(execFile);

export interface AlignOptions {
  audioPath: string;
  outputPath: string;
  binary?: string;
  dialogPath?: string;
  overwrite?: boolean;
}

export interface AlignResult {
  valid: true;
  cuesPath: string;
  cueCount: number;
  lengthSeconds: number;
  shapes: string[];
}

/**
 * Only argv, never a shell command. Rhubarb is an optional external executable.
 * Output is written to a temporary file first and promoted after validation.
 */
export function buildRhubarbArgs(
  audioPath: string,
  tempOutputPath: string,
  dialogPath?: string,
): string[] {
  for (const [label, path] of [
    ["audioPath", audioPath],
    ["outputPath", tempOutputPath],
    ...(dialogPath ? [["dialogPath", dialogPath]] : []),
  ]) {
    if (!path || path.includes("\0")) throw new Error(label + " is invalid");
  }
  const args = [
    "--exportFormat", "json",
    "--extendedShapes", "GHX",
    "--output", tempOutputPath,
  ];
  if (dialogPath) args.push("--dialogFile", dialogPath);
  args.push("--", audioPath);
  return args;
}

export async function alignAudioWithRhubarb(options: AlignOptions): Promise<AlignResult> {
  const input = resolve(options.audioPath);
  const output = resolve(options.outputPath);
  const binary = options.binary || process.env.PUPPETCONTROL_RHUBARB || "rhubarb";

  if (extname(input).toLowerCase() !== ".wav") {
    throw new Error("Rhubarb requires a WAV audio file");
  }
  if (extname(output).toLowerCase() !== ".json") {
    throw new Error("Rhubarb output must be a .json file");
  }
  if (output === input) throw new Error("Input and output paths must differ");
  if (!(await stat(input)).isFile()) throw new Error("Audio input must be a file");
  if (options.dialogPath) await access(resolve(options.dialogPath));

  if (!options.overwrite) {
    try {
      await access(output);
      throw new Error("Output already exists; pass --force to overwrite: " + output);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  await mkdir(dirname(output), { recursive: true });
  const temp = output + ".puppetcontrol-" + randomUUID() + ".tmp.json";

  try {
    const args = buildRhubarbArgs(input, temp, options.dialogPath ? resolve(options.dialogPath) : undefined);
    await execFileAsync(binary, args, {
      shell: false,
      windowsHide: true,
      timeout: 240_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const cues = parseRhubarbMouthCuesJson(await readFile(temp, "utf8"));
    if (cues.length === 0) throw new Error("Rhubarb produced no mouth cues");
    if (!options.overwrite) {
      // Prevent replacing an output that was created while Rhubarb ran.
      try {
        await access(output);
        throw new Error("Output appeared while alignment was running: " + output);
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
          throw error;
        }
      }
    }
    await rename(temp, output);
    return {
      valid: true,
      cuesPath: output,
      cueCount: cues.length,
      lengthSeconds: Math.max(...cues.map((cue) => cue.end)),
      shapes: [...new Set(cues.map((cue) => cue.value))],
    };
  } finally {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

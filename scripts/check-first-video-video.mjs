#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(scriptDir, "..");
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_FPS_TOLERANCE = 0.001;
export const DEFAULT_DURATION_TOLERANCE_MS = 50;
export const DEFAULT_FRAME_TOLERANCE = 0;

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseFinitePositive(name, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a finite positive number`);
  }
  return parsed;
}

function parseNonNegative(name, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
  return parsed;
}

function parsePositiveInteger(name, value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(name, value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const options = {
    path: undefined,
    fps: undefined,
    width: undefined,
    height: undefined,
    frames: undefined,
    audio: false,
    fpsTolerance: DEFAULT_FPS_TOLERANCE,
    durationToleranceMs: DEFAULT_DURATION_TOLERANCE_MS,
    frameTolerance: DEFAULT_FRAME_TOLERANCE,
    maxBytes: DEFAULT_MAX_BYTES,
    videoCodec: undefined,
    audioCodec: undefined,
    help: false,
  };
  const seen = new Set();

  const setOnce = (key, option, value) => {
    if (seen.has(key)) throw new Error(`${option} may only be specified once`);
    seen.add(key);
    options[key] = value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--audio") {
      if (seen.has("audio")) throw new Error("--audio may only be specified once");
      seen.add("audio");
      options.audio = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const value = requireValue(argv, i, arg);
      i += 1;
      switch (arg) {
        case "--fps":
          setOnce("fps", arg, parseFinitePositive(arg, value));
          break;
        case "--width":
          setOnce("width", arg, parsePositiveInteger(arg, value));
          break;
        case "--height":
          setOnce("height", arg, parsePositiveInteger(arg, value));
          break;
        case "--frames":
          setOnce("frames", arg, parsePositiveInteger(arg, value));
          break;
        case "--fps-tolerance":
          setOnce("fpsTolerance", arg, parseNonNegative(arg, value));
          break;
        case "--duration-tolerance-ms":
          setOnce("durationToleranceMs", arg, parseNonNegative(arg, value));
          break;
        case "--frame-tolerance":
          setOnce("frameTolerance", arg, parseNonNegativeInteger(arg, value));
          break;
        case "--max-bytes":
          setOnce("maxBytes", arg, parsePositiveInteger(arg, value));
          break;
        case "--video-codec":
          if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error("--video-codec contains invalid characters");
          setOnce("videoCodec", arg, value.toLowerCase());
          break;
        case "--audio-codec":
          if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error("--audio-codec contains invalid characters");
          setOnce("audioCodec", arg, value.toLowerCase());
          break;
        default:
          throw new Error(`unknown option: ${arg}`);
      }
      continue;
    }

    if (options.path !== undefined) {
      throw new Error(`unexpected positional argument: ${arg}`);
    }
    if (arg.includes("\0")) throw new Error("path must not contain a null byte");
    options.path = arg;
  }

  if (options.help) return options;

  for (const key of ["path", "fps", "width", "height", "frames"]) {
    if (options[key] === undefined) {
      throw new Error(`missing required argument: ${key === "path" ? "<path>" : `--${key}`}`);
    }
  }
  if (options.audioCodec && !options.audio) {
    throw new Error("--audio-codec requires --audio");
  }

  return options;
}

export function usage() {
  return `Usage:
  node scripts/check-first-video-video.mjs <path> --fps <n> --width <px> --height <px> --frames <n> [--audio] [options]

Checks an already-exported local MP4 without modifying it.

Required:
  <path>                     MP4 path inside this PuppetControl workspace
  --fps <n>                  Expected video frame rate
  --width <px>               Expected coded width
  --height <px>              Expected coded height
  --frames <n>               Expected decoded video frame count

Audio:
  --audio                    Require exactly one audio stream
                             (without it, require zero audio streams)

Optional stricter/limit checks:
  --fps-tolerance <n>        Absolute FPS tolerance (default: ${DEFAULT_FPS_TOLERANCE})
  --duration-tolerance-ms <n> Duration tolerance vs frames/fps (default: ${DEFAULT_DURATION_TOLERANCE_MS})
  --frame-tolerance <n>      Allowed frame-count difference (default: ${DEFAULT_FRAME_TOLERANCE})
  --max-bytes <n>            Maximum accepted file size (default: ${DEFAULT_MAX_BYTES})
  --video-codec <name>       Require a specific ffprobe video codec name, e.g. h264
  --audio-codec <name>       With --audio, require a specific audio codec name, e.g. aac
  -h, --help                 Show this help

Acceptance is metadata/stream validation only. It does not approve animation or visual quality.
`;
}

export function isPathInsideRoot(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function resolveConfinedVideo(inputPath, maxBytes) {
  const lexicalRoot = resolve(projectRoot);
  const candidate = resolve(lexicalRoot, inputPath);
  if (!isPathInsideRoot(lexicalRoot, candidate)) {
    throw new Error("video path must stay inside the PuppetControl workspace");
  }
  if (extname(candidate).toLowerCase() !== ".mp4") {
    throw new Error("video path must point to an .mp4 file");
  }

  const [realRoot, realCandidate] = await Promise.all([
    realpath(lexicalRoot),
    realpath(candidate),
  ]);
  if (!isPathInsideRoot(realRoot, realCandidate)) {
    throw new Error("video path resolves outside the PuppetControl workspace");
  }

  const info = await stat(realCandidate);
  if (!info.isFile()) throw new Error("video path must point to a regular file");
  if (info.size <= 0) throw new Error("video file is empty");
  if (info.size > maxBytes) {
    throw new Error(`video file is too large: ${info.size} bytes exceeds limit ${maxBytes}`);
  }
  return { path: realCandidate, size: info.size };
}

function toolVersion(command) {
  try {
    const stdout = execFileSync(command, ["-version"], {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 256 * 1024,
    });
    return String(stdout).split(/\r?\n/, 1)[0]?.trim() || `${command} available`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${command} is required but unavailable: ${detail}`);
  }
}

export function parseRate(value) {
  if (typeof value !== "string" || value.length === 0 || value === "N/A") return undefined;
  const slash = value.indexOf("/");
  if (slash >= 0) {
    const numerator = Number(value.slice(0, slash));
    const denominator = Number(value.slice(slash + 1));
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined;
    const rate = numerator / denominator;
    return Number.isFinite(rate) && rate > 0 ? rate : undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseCount(value) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseDuration(value) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function evaluateProbe(probe, expected) {
  const errors = [];
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const videos = streams.filter((stream) => stream?.codec_type === "video");
  const audios = streams.filter((stream) => stream?.codec_type === "audio");

  if (videos.length !== 1) {
    errors.push(`expected exactly one video stream, found ${videos.length}`);
  }
  const video = videos[0];

  const width = Number(video?.width);
  const height = Number(video?.height);
  if (!Number.isSafeInteger(width) || width <= 0) errors.push("ffprobe did not report a valid video width");
  else if (width !== expected.width) errors.push(`width mismatch: expected ${expected.width}, got ${width}`);
  if (!Number.isSafeInteger(height) || height <= 0) errors.push("ffprobe did not report a valid video height");
  else if (height !== expected.height) errors.push(`height mismatch: expected ${expected.height}, got ${height}`);

  const fps = parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate);
  if (fps === undefined) errors.push("ffprobe did not report a usable video frame rate");
  else if (Math.abs(fps - expected.fps) > expected.fpsTolerance) {
    errors.push(`fps mismatch: expected ${expected.fps} ± ${expected.fpsTolerance}, got ${fps}`);
  }

  const frameCount = parseCount(video?.nb_read_frames) ?? parseCount(video?.nb_frames);
  if (frameCount === undefined) errors.push("ffprobe did not report a decoded/container video frame count");
  else if (Math.abs(frameCount - expected.frames) > expected.frameTolerance) {
    errors.push(`frame count mismatch: expected ${expected.frames} ± ${expected.frameTolerance}, got ${frameCount}`);
  }

  const duration = parseDuration(video?.duration) ?? parseDuration(probe?.format?.duration);
  const expectedDuration = expected.frames / expected.fps;
  if (duration === undefined) errors.push("ffprobe did not report a usable video duration");
  else {
    const deltaMs = Math.abs(duration - expectedDuration) * 1000;
    if (deltaMs > expected.durationToleranceMs) {
      errors.push(
        `duration mismatch: expected ${expectedDuration.toFixed(6)}s ± ${expected.durationToleranceMs}ms, got ${duration.toFixed(6)}s`,
      );
    }
  }

  const formatNames = typeof probe?.format?.format_name === "string"
    ? probe.format.format_name.split(",").map((name) => name.trim().toLowerCase())
    : [];
  if (!formatNames.includes("mp4")) {
    errors.push(`container mismatch: expected MP4, ffprobe reported ${probe?.format?.format_name ?? "unknown"}`);
  }

  if (expected.audio) {
    if (audios.length !== 1) errors.push(`expected exactly one audio stream, found ${audios.length}`);
  } else if (audios.length !== 0) {
    errors.push(`expected no audio stream, found ${audios.length}`);
  }

  const videoCodec = typeof video?.codec_name === "string" ? video.codec_name.toLowerCase() : undefined;
  if (expected.videoCodec && videoCodec !== expected.videoCodec) {
    errors.push(`video codec mismatch: expected ${expected.videoCodec}, got ${videoCodec ?? "unknown"}`);
  }

  const audioCodec = audios.length === 1 && typeof audios[0]?.codec_name === "string"
    ? audios[0].codec_name.toLowerCase()
    : undefined;
  if (expected.audioCodec && audioCodec !== expected.audioCodec) {
    errors.push(`audio codec mismatch: expected ${expected.audioCodec}, got ${audioCodec ?? "unknown"}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    observed: {
      width: Number.isSafeInteger(width) ? width : null,
      height: Number.isSafeInteger(height) ? height : null,
      fps: fps ?? null,
      frames: frameCount ?? null,
      durationSeconds: duration ?? null,
      expectedDurationSeconds: expectedDuration,
      videoStreams: videos.length,
      audioStreams: audios.length,
      format: probe?.format?.format_name ?? null,
      videoCodec: videoCodec ?? null,
      audioCodec: audioCodec ?? null,
    },
  };
}

function probeVideo(videoPath) {
  const stdout = execFileSync("ffprobe", [
    "-v", "error",
    "-count_frames",
    "-show_entries",
    "stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_frames,nb_read_frames,duration:format=format_name,duration,size",
    "-of", "json",
    videoPath,
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      return;
    }

    const video = await resolveConfinedVideo(options.path, options.maxBytes);
    const ffmpegVersion = toolVersion("ffmpeg");
    const ffprobeVersion = toolVersion("ffprobe");
    const probe = probeVideo(video.path);
    const result = evaluateProbe(probe, options);

    process.stdout.write(JSON.stringify({
      ok: result.ok,
      checker: "first-video-video",
      path: relative(projectRoot, video.path).replaceAll("\\", "/"),
      sizeBytes: video.size,
      tools: {
        ffmpeg: ffmpegVersion,
        ffprobe: ffprobeVersion,
      },
      expected: {
        fps: options.fps,
        width: options.width,
        height: options.height,
        frames: options.frames,
        audio: options.audio,
        fpsTolerance: options.fpsTolerance,
        durationToleranceMs: options.durationToleranceMs,
        frameTolerance: options.frameTolerance,
        maxBytes: options.maxBytes,
        videoCodec: options.videoCodec ?? null,
        audioCodec: options.audioCodec ?? null,
      },
      ...result,
      note: "Metadata/stream acceptance only; this does not approve animation or visual quality.",
    }, null, 2) + "\n");

    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(JSON.stringify({
      ok: false,
      checker: "first-video-video",
      error: message,
      note: "Metadata/stream acceptance only; this does not approve animation or visual quality.",
    }, null, 2) + "\n");
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;
if (invokedDirectly) {
  await main();
}

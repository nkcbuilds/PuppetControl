export interface FfmpegAudioInput {
  path: string;
  /** Delay audio from the start of the video. */
  startMs: number;
}

export interface FfmpegArgvOptions {
  framesPattern: string;
  outputPath: string;
  fps: number;
  frameCount: number;
  audio?: FfmpegAudioInput;
}

function requirePath(name: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  if (value.includes("\0")) {
    throw new Error(`${name} must not contain a null byte`);
  }
  if (value.startsWith("-")) {
    throw new Error(`${name} must not begin with '-'`);
  }
}

function requirePositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive number`);
  }
}

function formatDecimal(value: number): string {
  return value.toFixed(9).replace(/\.?0+$/, "");
}

/**
 * Build FFmpeg argv for a PNG sequence and at most one mono/stereo audio track.
 *
 * The returned value is an argv array for execFile/spawn with shell disabled;
 * it is deliberately not a shell command string.
 */
export function buildFfmpegArgs(options: FfmpegArgvOptions): string[] {
  requirePath("framesPattern", options.framesPattern);
  requirePath("outputPath", options.outputPath);
  requirePositiveFinite("fps", options.fps);

  if (!Number.isInteger(options.frameCount) || options.frameCount <= 0) {
    throw new Error("frameCount must be a positive integer");
  }

  if (options.audio) {
    requirePath("audio.path", options.audio.path);
    if (!Number.isFinite(options.audio.startMs) || options.audio.startMs < 0) {
      throw new Error("audio.startMs must be a finite non-negative number");
    }
  }

  const fps = formatDecimal(options.fps);
  const durationSeconds = formatDecimal(options.frameCount / options.fps);
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-framerate", fps,
    "-i", options.framesPattern,
  ];

  if (options.audio) {
    const delayMs = formatDecimal(options.audio.startMs);
    args.push(
      "-i", options.audio.path,
      "-filter_complex",
      `[1:a:0]adelay=${delayMs}:all=1,apad=whole_dur=${durationSeconds},atrim=end=${durationSeconds}[audio]`,
      "-map", "0:v:0",
      "-map", "[audio]",
    );
  } else {
    args.push("-map", "0:v:0");
  }

  args.push(
    "-frames:v", String(options.frameCount),
    "-r", fps,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
  );

  if (options.audio) {
    args.push("-c:a", "aac");
  } else {
    args.push("-an");
  }

  args.push("-movflags", "+faststart", options.outputPath);
  return args;
}

export interface VideoOutput {
  width: number;
  height: number;
  /** RGB six-digit background color, for areas outside fitted source. */
  background: string;
}

function checkDimension(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 160 || value > 7680 || value % 2 !== 0) {
    throw new Error(label + " must be an even integer between 160 and 7680");
  }
}

/**
 * Fit the native character canvas inside the presentation frame while retaining
 * aspect ratio. The exported image must not crop heads or stretch faces.
 *
 * This is simple presentation sizing, NOT an animated camera or transition.
 * The 2D camera compositor will add genuine shot changes separately.
 */
export function buildFitVideoFilter(output: VideoOutput): string {
  checkDimension("Output width", output.width);
  checkDimension("Output height", output.height);
  if (!/^#[0-9A-Fa-f]{6}$/.test(output.background)) {
    throw new Error("Background must be a six-digit RGB hex color");
  }
  const { width, height } = output;
  const rgb = "0x" + output.background.slice(1);
  return [
    "scale=w=" + width + ":h=" + height + ":force_original_aspect_ratio=decrease:flags=lanczos",
    "pad=w=" + width + ":h=" + height + ":x=(ow-iw)/2:y=(oh-ih)/2:color=" + rgb,
    "setsar=1",
  ].join(",");
}

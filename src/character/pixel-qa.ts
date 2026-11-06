/**
 * Deterministic pixel-level *triage* for PNG render comparisons.
 *
 * These metrics establish changed pixels and reveal opaque-canvas gaps.
 * They DO NOT measure artistic quality or automatically approve a rig.
 */
import { spawn } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { AvatarWorkflowError, checkedPath, parsePngSize } from "./avatar.js";

const MAX_PNG_BYTES = 30 * 1024 * 1024;
const MAX_RAW_BYTES = 4096 * 4096 * 4;
const PIXEL_DIFFERENCE_THRESHOLD = 10;

export interface PixelRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelComparison {
  width: number;
  height: number;
  region: PixelRegion;
  comparedPixels: number;
  ignoredTransparentPixels: number;
  rgbMeanAbsoluteError: number;
  changedPixels: number;
  changedFraction: number;
  /** Reference-opaque edge pixels that became semi/fully transparent. */
  unexpectedTransparentBorderPixels: number;
  note: string;
}

function validRegion(region: PixelRegion, width: number, height: number): void {
  if ([region.x, region.y, region.width, region.height].some((value) => !Number.isSafeInteger(value)) ||
      region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1 ||
      region.x + region.width > width || region.y + region.height > height) {
    throw new AvatarWorkflowError("PIXEL_QA_REGION_INVALID", "Region must be an integer rectangle within both images.");
  }
}

export function parsePixelRegionArgument(raw: string): PixelRegion {
  if (!/^\d+,\d+,\d+,\d+$/.test(raw)) {
    throw new AvatarWorkflowError("PIXEL_QA_REGION_INVALID", "Use --region x,y,width,height with nonnegative integer values.");
  }
  const [x, y, width, height] = raw.split(",").map(Number);
  if (![x, y, width, height].every((value) => Number.isSafeInteger(value)) || width! < 1 || height! < 1) {
    throw new AvatarWorkflowError("PIXEL_QA_REGION_INVALID", "Region size must be positive and coordinates must be safe integers.");
  }
  return { x: x!, y: y!, width: width!, height: height! };
}

export function compareRgbaPixels(
  reference: Uint8Array, candidate: Uint8Array, width: number, height: number,
  region: PixelRegion = { x: 0, y: 0, width, height },
): PixelComparison {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width * height * 4 > MAX_RAW_BYTES ||
      reference.byteLength !== width * height * 4 || candidate.byteLength !== width * height * 4) {
    throw new AvatarWorkflowError("PIXEL_QA_BUFFER_INVALID", "Both images need matching RGBA buffers and valid bounded dimensions.");
  }
  validRegion(region, width, height);

  let compared = 0;
  let skipped = 0;
  let rgbAbsoluteSum = 0;
  let changed = 0;
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const i = (y * width + x) * 4;
      const refAlpha = reference[i + 3]!;
      const nextAlpha = candidate[i + 3]!;
      // RGB is undefined/invisible when both samples are completely transparent.
      if (refAlpha < 16 && nextAlpha < 16) {
        skipped++;
        continue;
      }
      let maxChannelDelta = 0;
      for (let channel = 0; channel < 3; channel++) {
        const delta = Math.abs(reference[i + channel]! - candidate[i + channel]!);
        rgbAbsoluteSum += delta;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
      }
      if (maxChannelDelta > PIXEL_DIFFERENCE_THRESHOLD ||
          Math.abs(refAlpha - nextAlpha) > PIXEL_DIFFERENCE_THRESHOLD) changed++;
      compared++;
    }
  }

  let unexpectedTransparentBorderPixels = 0;
  // Count each perimeter pixel once (avoid counting corners twice).
  for (let y = 0; y < height; y++) {
    for (const x of (width === 1 ? [0] : [0, width - 1])) {
      const i = (y * width + x) * 4 + 3;
      if (reference[i]! >= 250 && candidate[i]! < 250) unexpectedTransparentBorderPixels++;
    }
  }
  for (let x = 1; x < width - 1; x++) {
    for (const y of (height === 1 ? [0] : [0, height - 1])) {
      const i = (y * width + x) * 4 + 3;
      if (reference[i]! >= 250 && candidate[i]! < 250) unexpectedTransparentBorderPixels++;
    }
  }

  return {
    width, height, region, comparedPixels: compared, ignoredTransparentPixels: skipped,
    rgbMeanAbsoluteError: compared ? Number((rgbAbsoluteSum / (compared * 3)).toFixed(4)) : 0,
    changedPixels: changed, changedFraction: compared ? Number((changed / compared).toFixed(6)) : 0,
    unexpectedTransparentBorderPixels,
    note: "Pixel differences are diagnostics only; visually inspect eyes, face, neck and transitions before approving artwork.",
  };
}

async function pngInfo(path: string, root: string) {
  const file = await checkedPath(root, path);
  const details = await stat(file);
  if (!details.isFile() || details.size < 24 || details.size > MAX_PNG_BYTES) {
    throw new AvatarWorkflowError("PIXEL_QA_PNG_INVALID", "QA images must be PNG files under 30 MB.");
  }
  const handle = await open(file, "r");
  try {
    const header = Buffer.alloc(24);
    const result = await handle.read(header, 0, 24, 0);
    if (result.bytesRead !== 24) throw new AvatarWorkflowError("PIXEL_QA_PNG_INVALID", "Incomplete PNG header.");
    return { file, dimensions: parsePngSize(header) };
  } finally {
    await handle.close();
  }
}

async function decodeRgbaPng(file: string, expectedLength: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new AvatarWorkflowError("PIXEL_QA_DECODE_FAILED", message));
    };
    const child = spawn("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-i", file, "-frames:v", "1", "-an",
      "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1",
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, signal: AbortSignal.timeout(60_000) });
    const chunks: Buffer[] = [];
    let total = 0;
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > expectedLength) return fail("Decoded image exceeds header dimensions.");
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString("utf8").slice(0, 2000 - stderr.length);
    });
    child.on("error", (error) => fail("FFmpeg unavailable or failed: " + error.message));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0 || total !== expectedLength) {
        return fail("PNG decode failed or pixel count differs from header: " + stderr.slice(0, 1000));
      }
      settled = true;
      resolve(Buffer.concat(chunks, total));
    });
  });
}

/** PNG files must remain inside the current workspace; FFmpeg never executes via a shell. */
export async function comparePngFiles(
  referencePath: string, candidatePath: string,
  region?: PixelRegion, root = process.cwd(),
): Promise<PixelComparison> {
  const [reference, candidate] = await Promise.all([
    pngInfo(referencePath, root),
    pngInfo(candidatePath, root),
  ]);
  const { width, height } = reference.dimensions;
  if (candidate.dimensions.width !== width || candidate.dimensions.height !== height) {
    throw new AvatarWorkflowError("PIXEL_QA_SIZE_MISMATCH", "Images must have exactly matching dimensions; no implicit resizing.");
  }
  if (region) validRegion(region, width, height);
  const length = width * height * 4;
  const [first, second] = await Promise.all([
    decodeRgbaPng(reference.file, length),
    decodeRgbaPng(candidate.file, length),
  ]);
  return compareRgbaPixels(first, second, width, height, region);
}

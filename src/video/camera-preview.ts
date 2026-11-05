import type { SceneEvent } from "../scene/schemas.js";

interface NativeResolution {
  width: number;
  height: number;
}

const ZOOM_LEVELS = {
  wide: 1,
  medium: 1.12,
  "close-up": 1.34,
} as const;

function formatNumber(n: number): string {
  return Number(n.toFixed(6)).toString();
}

/**
 * Build a conservative FFmpeg zoompan stage using only schema-validated
 * camera events. Camera "cut" is a boundary marker; it does not itself
 * invent a new shot or promise to disguise a body-pose swap.
 *
 * zoompan d=1 means one output sample for each PNG input frame. The source
 * character is never stretched and the crop stays centered horizontally.
 */
export function buildCameraPreviewFilter(
  events: readonly SceneEvent[],
  fps: number,
  native: NativeResolution,
): string | null {
  if (!Number.isSafeInteger(fps) || fps < 1 || fps > 120) {
    throw new Error("Camera requires a valid integer frame rate");
  }
  for (const [name, value] of Object.entries(native)) {
    if (!Number.isSafeInteger(value) || value < 160 || value > 7680) {
      throw new Error("Invalid camera source " + name);
    }
  }

  const cuts = new Set(events.filter((event) =>
    event.kind === "camera" && event.name === "cut",
  ).map((event) => event.atMs));

  const cameraEvents = events.map((event, index) => ({ event, index }))
    .filter((entry): entry is {
      event: Extract<SceneEvent, { kind: "camera" }>;
      index: number;
    } => entry.event.kind === "camera" && entry.event.name !== "cut")
    .sort((a, b) => a.event.atMs - b.event.atMs || a.index - b.index);

  if (cameraEvents.length === 0) return null;
  if (cameraEvents.length > 25) throw new Error("Too many camera events for a single filter graph");

  let zoom = 1;
  let expression = "1";
  let previousEndFrame = 0;

  for (const { event } of cameraEvents) {
    if (!Number.isSafeInteger(event.atMs) || event.atMs < 0) {
      throw new Error("Invalid camera event timestamp");
    }
    const atFrame = Math.ceil((event.atMs * fps) / 1000);
    if (atFrame < previousEndFrame) {
      throw new Error("Camera moves overlap; separate or shorten the camera events");
    }
    const target = event.name === "punch-in"
      ? Math.min(1.6, zoom + (event.amount ?? 0.08))
      : ZOOM_LEVELS[event.name as keyof typeof ZOOM_LEVELS];

    if (!Number.isFinite(target) || target < 1 || target > 1.6) {
      throw new Error("Camera zoom must be between 1 and 1.6");
    }
    const immediate = cuts.has(event.atMs);
    const durationMs = event.durationMs ?? 350;
    const durationFrames = immediate ? 0 : Math.max(1, Math.ceil(durationMs * fps / 1000));
    const goal = formatNumber(target);

    if (durationFrames === 0) {
      expression = "if(lt(on," + atFrame + ")," + expression + "," + goal + ")";
      previousEndFrame = atFrame;
    } else {
      const fraction = "((on-" + atFrame + ")/" + durationFrames + ")";
      const smooth = "(" + fraction + "*" + fraction + "*(3-2*" + fraction + "))";
      const from = formatNumber(zoom);
      const ramp = "(" + from + "+(" + goal + "-" + from + ")*" + smooth + ")";
      const end = atFrame + durationFrames;
      expression = "if(lt(on," + atFrame + ")," + expression +
        ",if(lt(on," + end + ")," + ramp + "," + goal + "))";
      previousEndFrame = end;
    }
    zoom = target;
  }

  return [
    "zoompan=z='" + expression + "'",
    "x='(iw-iw/zoom)*0.5'",
    // Slightly top-biased crop preserves facial framing for bust characters.
    "y='(ih-ih/zoom)*0.30'",
    "d=1",
    "s=" + native.width + "x" + native.height,
    "fps=" + fps,
  ].join(":");
}

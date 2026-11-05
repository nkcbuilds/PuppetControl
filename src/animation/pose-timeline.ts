import { resolveTransition, type TransitionDecision } from "./transitions.js";
import {
  characterSchema,
  sceneSchema,
  type Character,
  type Scene,
} from "../scene/schemas.js";

export type PoseTimelineErrorCode =
  | "INVALID_SCENE"
  | "INVALID_CHARACTER"
  | "UNKNOWN_ACTOR"
  | "EVENT_UNKNOWN_ACTOR"
  | "DEFAULT_POSE_NOT_APPROVED"
  | "TRANSITION_UNSUPPORTED"
  | "TRANSITION_REQUEST_MISMATCH"
  | "TRANSITION_OVERLAP"
  | "TRANSITION_OUT_OF_BOUNDS"
  | "TRANSITION_UNSAMPLED"
  | "TRANSITION_INVALID"
  | "FRAME_INDEX_OVERFLOW";

export class PoseTimelineError extends Error {
  constructor(
    public readonly code: PoseTimelineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PoseTimelineError";
  }
}

export interface PoseHoldSegment {
  kind: "pose";
  pose: string;
  /** Inclusive sampled frame index. */
  startFrame: number;
  /** Exclusive sampled frame index. */
  endFrame: number;
}

export interface PoseTransitionSegment {
  kind: "transition";
  mode: "interpolate" | "bridge";
  from: string;
  to: string;
  /** Inclusive sampled frame index. */
  startFrame: number;
  /** Exclusive sampled frame index. */
  endFrame: number;
  clip?: string;
}

export type PoseTimelineSegment = PoseHoldSegment | PoseTransitionSegment;

export interface PoseTransitionPoint {
  /** Original scene.events index, before chronological sorting. */
  eventIndex: number;
  atMs: number;
  /** First sampled frame at or after atMs. */
  frame: number;
  /** Exclusive end frame; equals frame for zero-duration decisions such as cuts. */
  endFrame: number;
  decision: TransitionDecision;
}

export interface PoseTimelinePlan {
  sceneId: string;
  actorId: string;
  fps: number;
  durationMs: number;
  frameCount: number;
  segments: PoseTimelineSegment[];
  transitions: PoseTransitionPoint[];
}

function schemaError(prefix: string, issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const first = issues[0];
  if (!first) return prefix;
  const path = first.path.length > 0 ? first.path.map(String).join(".") : "<root>";
  return `${prefix}: ${path}: ${first.message}`;
}

/**
 * Return the first sampled frame whose exact sample time n/fps is >= atMs.
 * Integer millisecond timestamps make this equivalent to ceil(atMs*fps/1000)
 * without accumulating floating-point frame durations.
 */
export function frameBoundaryAtOrAfterMs(milliseconds: number, fps: number): number {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new PoseTimelineError("FRAME_INDEX_OVERFLOW", "Frame timestamp must be a safe non-negative integer");
  }
  if (!Number.isSafeInteger(fps) || fps <= 0) {
    throw new PoseTimelineError("FRAME_INDEX_OVERFLOW", "FPS must be a safe positive integer");
  }
  const product = milliseconds * fps;
  if (!Number.isSafeInteger(product)) {
    throw new PoseTimelineError("FRAME_INDEX_OVERFLOW", "Frame index calculation exceeds safe integer precision");
  }
  const wholeFrames = Math.floor(product / 1000);
  return wholeFrames + (product % 1000 === 0 ? 0 : 1);
}

function pushPose(
  segments: PoseTimelineSegment[],
  pose: string,
  startFrame: number,
  endFrame: number,
): void {
  if (endFrame <= startFrame) return;
  const previous = segments[segments.length - 1];
  if (
    previous?.kind === "pose"
    && previous.pose === pose
    && previous.endFrame === startFrame
  ) {
    previous.endFrame = endFrame;
    return;
  }
  segments.push({ kind: "pose", pose, startFrame, endFrame });
}

function assertKnownEventActors(scene: Scene): void {
  const actors = new Set(scene.actors.map((actor) => actor.id));
  for (let index = 0; index < scene.events.length; index += 1) {
    const event = scene.events[index];
    if (!event || event.kind === "camera" || event.kind === "caption") continue;
    if (!actors.has(event.actor)) {
      throw new PoseTimelineError(
        "EVENT_UNKNOWN_ACTOR",
        `Scene event ${index} refers to unknown actor ${event.actor}`,
      );
    }
  }
}

function hasCameraCutAt(scene: Scene, atMs: number): boolean {
  return scene.allowCameraCuts && scene.events.some((event) =>
    event.kind === "camera" && event.name === "cut" && event.atMs === atMs
  );
}

function assertDecisionMatchesRequest(
  requested: "auto" | "interpolate" | "bridge" | "cut",
  decision: TransitionDecision,
  eventIndex: number,
): void {
  if (requested === "auto" || decision.mode === "unsupported") return;
  if (decision.mode !== requested) {
    throw new PoseTimelineError(
      "TRANSITION_REQUEST_MISMATCH",
      `Pose event ${eventIndex} requested ${requested} but resolved to ${decision.mode}`,
    );
  }
}

/**
 * Compile one actor's pose events into sampled-frame segments.
 *
 * The input is parsed again through the public schemas so callers cannot bypass
 * validation by casting arbitrary data to Scene/Character. Pose events are
 * chronological with original event index as the stable tie-breaker.
 */
export function planPoseTimeline(
  sceneInput: unknown,
  characterInput: unknown,
  actorId: string,
): PoseTimelinePlan {
  const sceneResult = sceneSchema.safeParse(sceneInput);
  if (!sceneResult.success) {
    throw new PoseTimelineError(
      "INVALID_SCENE",
      schemaError("Invalid scene", sceneResult.error.issues),
    );
  }
  const characterResult = characterSchema.safeParse(characterInput);
  if (!characterResult.success) {
    throw new PoseTimelineError(
      "INVALID_CHARACTER",
      schemaError("Invalid character", characterResult.error.issues),
    );
  }

  const scene = sceneResult.data;
  const character: Character = characterResult.data;
  assertKnownEventActors(scene);

  if (!scene.actors.some((actor) => actor.id === actorId)) {
    throw new PoseTimelineError("UNKNOWN_ACTOR", `Actor ${actorId} is not present in scene ${scene.id}`);
  }
  const defaultPose = character.poseFamilies.find((candidate) => candidate.name === character.defaultPose);
  if (!defaultPose?.approved) {
    throw new PoseTimelineError(
      "DEFAULT_POSE_NOT_APPROVED",
      `Character default pose ${character.defaultPose} is not approved`,
    );
  }

  const frameCount = frameBoundaryAtOrAfterMs(scene.durationMs, scene.fps);
  const poseEvents = scene.events
    .map((event, index) => ({ event, index }))
    .filter((entry): entry is {
      event: Extract<Scene["events"][number], { kind: "pose" }>;
      index: number;
    } => entry.event.kind === "pose" && entry.event.actor === actorId)
    .sort((left, right) => left.event.atMs - right.event.atMs || left.index - right.index);

  const segments: PoseTimelineSegment[] = [];
  const transitions: PoseTransitionPoint[] = [];
  let pose = character.defaultPose;
  let cursorFrame = 0;
  let transitionBusyUntilMs = 0;

  for (const { event, index: eventIndex } of poseEvents) {
    if (event.atMs < transitionBusyUntilMs) {
      throw new PoseTimelineError(
        "TRANSITION_OVERLAP",
        `Pose event ${eventIndex} at ${event.atMs}ms overlaps a transition ending at ${transitionBusyUntilMs}ms`,
      );
    }

    const startFrame = frameBoundaryAtOrAfterMs(event.atMs, scene.fps);
    if (startFrame < cursorFrame) {
      throw new PoseTimelineError(
        "TRANSITION_OVERLAP",
        `Pose event ${eventIndex} maps before the previous sampled transition ended`,
      );
    }
    pushPose(segments, pose, cursorFrame, startFrame);

    const allowCameraCut = hasCameraCutAt(scene, event.atMs);
    const decision = resolveTransition(character, pose, event.name, {
      requested: event.transition,
      allowCameraCut,
    });
    assertDecisionMatchesRequest(event.transition, decision, eventIndex);

    if (decision.mode === "unsupported") {
      throw new PoseTimelineError(
        "TRANSITION_UNSUPPORTED",
        `Pose event ${eventIndex} ${pose} -> ${event.name} is unsupported: ${decision.reason}`,
      );
    }
    if (decision.mode === "cut" && !allowCameraCut) {
      throw new PoseTimelineError(
        "TRANSITION_INVALID",
        `Pose event ${eventIndex} resolved to cut without a camera cut at the same timestamp`,
      );
    }
    if (decision.mode === "bridge" && (!decision.clip || decision.durationMs <= 0)) {
      throw new PoseTimelineError(
        "TRANSITION_INVALID",
        `Pose event ${eventIndex} resolved to an invalid bridge`,
      );
    }
    if (decision.durationMs < 0 || !Number.isSafeInteger(decision.durationMs)) {
      throw new PoseTimelineError(
        "TRANSITION_INVALID",
        `Pose event ${eventIndex} resolved to an invalid transition duration`,
      );
    }

    const endMs = event.atMs + decision.durationMs;
    if (!Number.isSafeInteger(endMs)) {
      throw new PoseTimelineError(
        "FRAME_INDEX_OVERFLOW",
        `Pose event ${eventIndex} transition end exceeds safe integer precision`,
      );
    }
    if (endMs > scene.durationMs) {
      throw new PoseTimelineError(
        "TRANSITION_OUT_OF_BOUNDS",
        `Pose event ${eventIndex} transition ends after the scene`,
      );
    }

    const endFrame = frameBoundaryAtOrAfterMs(endMs, scene.fps);
    transitions.push({
      eventIndex,
      atMs: event.atMs,
      frame: startFrame,
      endFrame,
      decision,
    });

    if (decision.durationMs > 0) {
      if (decision.mode !== "interpolate" && decision.mode !== "bridge") {
        throw new PoseTimelineError(
          "TRANSITION_INVALID",
          `Pose event ${eventIndex} has duration but is not an interpolated or bridge transition`,
        );
      }
      if (endFrame <= startFrame) {
        throw new PoseTimelineError(
          "TRANSITION_UNSAMPLED",
          `Pose event ${eventIndex} transition is too brief to occupy a sampled frame at ${scene.fps} fps`,
        );
      }
      const transition: PoseTransitionSegment = {
        kind: "transition",
        mode: decision.mode,
        from: pose,
        to: event.name,
        startFrame,
        endFrame,
      };
      if (decision.mode === "bridge" && decision.clip) transition.clip = decision.clip;
      segments.push(transition);
      cursorFrame = endFrame;
      transitionBusyUntilMs = endMs;
    } else {
      cursorFrame = startFrame;
      transitionBusyUntilMs = event.atMs;
    }

    pose = event.name;
  }

  pushPose(segments, pose, cursorFrame, frameCount);

  let expectedStart = 0;
  for (const segment of segments) {
    if (segment.startFrame !== expectedStart || segment.endFrame <= segment.startFrame) {
      throw new PoseTimelineError("TRANSITION_INVALID", "Pose timeline segments are not contiguous");
    }
    expectedStart = segment.endFrame;
  }
  if (expectedStart !== frameCount) {
    throw new PoseTimelineError("TRANSITION_INVALID", "Pose timeline does not cover every sampled frame");
  }

  return {
    sceneId: scene.id,
    actorId,
    fps: scene.fps,
    durationMs: scene.durationMs,
    frameCount,
    segments,
    transitions,
  };
}

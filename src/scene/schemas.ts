import { z } from "zod";

const identifier = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const milliseconds = z.number().int().nonnegative();
const strength = z.number().min(0).max(1);

export const poseFamilySchema = z.object({
  name: identifier,
  rigId: identifier,
  /** Optional rig override for a separately authored body pose family. */
  modelPath: z.string().trim().min(1).optional(),
  head: z.enum(["shared", "alternate"]).default("shared"),
  approved: z.boolean(),
});

export const transitionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("bridge"),
    from: identifier,
    to: identifier,
    clip: z.string().trim().min(1),
    durationMs: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("cut"),
    from: identifier,
    to: identifier,
  }),
]);

export const characterSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** Imported-image actors bind their approved rig to the exact built artwork and landmark bytes. */
  provenance: z.strictObject({ file: z.literal("avatar-build.json") }).optional(),
  render: z.strictObject({
    backend: z.literal("rev2d"),
    modelPath: z.string().trim().min(1),
    expressionPresets: z.record(z.string(), z.record(z.string(), z.number())),
    /** Controls for multiple poses represented by one deformable rig. */
    posePresets: z.record(z.string(), z.record(z.string(), z.number())).optional(),
  }).optional(),
  id: identifier,
  defaultPose: identifier,
  poseFamilies: z.array(poseFamilySchema).min(1),
  expressions: z.array(identifier).min(1),
  motions: z.array(identifier).default([]),
  transitions: z.array(transitionSchema).default([]),
}).superRefine((actor, ctx) => {
  const poses = new Set(actor.poseFamilies.map((pose) => pose.name));
  if (poses.size !== actor.poseFamilies.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate pose family names", path: ["poseFamilies"] });
  }
  if (!poses.has(actor.defaultPose)) {
    ctx.addIssue({ code: "custom", message: "Default pose must be in poseFamilies", path: ["defaultPose"] });
  }
  if (new Set(actor.expressions).size !== actor.expressions.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate expression names", path: ["expressions"] });
  }
  const transitionPairs = new Set<string>();
  for (const [index, transition] of actor.transitions.entries()) {
    const pair = transition.from + "->" + transition.to;
    if (transitionPairs.has(pair)) {
      ctx.addIssue({ code: "custom", message: "Duplicate transition pair: " + pair, path: ["transitions", index] });
    }
    transitionPairs.add(pair);
    if (!poses.has(transition.from) || !poses.has(transition.to)) {
      ctx.addIssue({
        code: "custom",
        message: "Transition must refer to existing pose family names",
        path: ["transitions", index],
      });
    }
  }
});

const time = { atMs: milliseconds };
const actorEvent = { ...time, actor: identifier };

export const sceneEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...actorEvent,
    kind: z.literal("pose"),
    name: identifier,
    transition: z.enum(["auto", "interpolate", "bridge", "cut"]).default("auto"),
  }),
  z.strictObject({
    ...actorEvent,
    kind: z.literal("expression"),
    name: identifier,
    intensity: strength.default(1),
  }),
  z.strictObject({
    ...actorEvent,
    kind: z.literal("motion"),
    name: identifier,
    intensity: strength.default(1),
  }),
  z.strictObject({
    ...actorEvent,
    kind: z.literal("look"),
    x: z.number().min(-1).max(1),
    y: z.number().min(-1).max(1),
    durationMs: milliseconds.default(250),
  }),
  z.strictObject({
    ...time,
    kind: z.literal("camera"),
    name: z.enum(["wide", "medium", "close-up", "punch-in", "cut"]),
    amount: z.number().min(0).max(1).optional(),
    durationMs: z.number().int().min(0).max(2000).optional(),
  }),
  z.strictObject({
    ...time,
    kind: z.literal("caption"),
    text: z.string().min(1).max(500),
    durationMs: z.number().int().positive(),
  }),
]);

export const sceneSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: identifier,
  durationMs: z.number().int().positive(),
  fps: z.number().int().min(1).max(120),
  resolution: z.strictObject({
    width: z.number().int().min(160).max(7680),
    height: z.number().int().min(160).max(7680),
  }),
  /** Presentation size; the rig still renders at its own native resolution. */
  output: z.strictObject({
    width: z.number().int().min(160).max(7680).refine((v) => v % 2 === 0, "Video width must be even"),
    height: z.number().int().min(160).max(7680).refine((v) => v % 2 === 0, "Video height must be even"),
    background: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#f0eaf4"),
  }).optional(),
  actors: z.array(z.strictObject({
    id: identifier,
    characterPath: z.string().trim().min(1),
  })).min(1),
  audio: z.array(z.strictObject({
    path: z.string().trim().min(1),
    startMs: milliseconds,
    actor: identifier.optional(),
    cuesPath: z.string().trim().min(1).optional(),
  })).max(1).default([]),
  allowCameraCuts: z.boolean().default(false),
  events: z.array(sceneEventSchema).default([]),
}).superRefine((scene, ctx) => {
  if (new Set(scene.actors.map((actor) => actor.id)).size !== scene.actors.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate actor IDs", path: ["actors"] });
  }
  scene.audio.forEach((audio, index) => {
    if (audio.startMs >= scene.durationMs) {
      ctx.addIssue({ code: "custom", message: "Audio must start before scene ends", path: ["audio", index, "startMs"] });
    }
    if (audio.actor && !scene.actors.some((item) => item.id === audio.actor)) {
      ctx.addIssue({ code: "custom", message: "Audio refers to unknown actor", path: ["audio", index, "actor"] });
    }
  });
  scene.events.forEach((event, index) => {
    if (event.atMs >= scene.durationMs) {
      ctx.addIssue({
        code: "custom", message: "Event must occur before scene ends", path: ["events", index, "atMs"],
      });
    }
    if (event.kind === "caption" && event.atMs + event.durationMs > scene.durationMs) {
      ctx.addIssue({
        code: "custom", message: "Caption extends beyond scene duration", path: ["events", index],
      });
    }
  });
});

export type Character = z.infer<typeof characterSchema>;
export type PoseFamily = z.infer<typeof poseFamilySchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type SceneEvent = z.infer<typeof sceneEventSchema>;

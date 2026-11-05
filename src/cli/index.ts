#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { characterSchema } from "../scene/schemas.js";
import { loadAndValidateScene } from "../scene/load.js";
import { encodeFrames, renderRev2DFrames } from "../render/rev2d.js";
import { PreviewUnsupportedError } from "../render/scene-plan.js";
import { alignAudioWithRhubarb } from "../audio/align.js";
import { planPoseTimeline, PoseTimelineError } from "../animation/pose-timeline.js";

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function usage(): never {
  process.stderr.write(
    "PuppetControl CLI (early schema/validation milestone)\n" +
    "Usage:\n" +
    "  puppetctl doctor\n" +
    "  puppetctl character inspect <character.json>\n" +
    "  puppetctl audio align <voice.wav> --out <mouth.json> [--binary rhubarb] [--force]\n" +
    "  puppetctl scene validate <scene.json>\n" +
    "  puppetctl scene plan <scene.json>\n" +
    "  puppetctl scene preview <scene.json>\n" +
    "  puppetctl scene render <scene.json> [--out output.mp4]\n" +
    "  puppetctl --help\n" +
    "\nPreview/render require a configured Rev2D rig; full character compilation is not yet implemented.\n",
  );
  process.exit(2);
}

async function run(): Promise<void> {
  const [first, second, third] = process.argv.slice(2);
  if (first === "--help" || first === "help") {
    process.stdout.write(
      "PuppetControl (experimental)\n" +
      "Available: doctor, character inspect, audio align, scene validate/plan, single-rig scene preview/render.\n" +
      "Not yet available: animated pose bridges, captions, automatic transcription/TTS, character compile.\n",
    );
    return;
  }

  if (first === "doctor") {
    let ffmpegFound = false;
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000 });
      ffmpegFound = true;
    } catch {
      // FFmpeg is optional until the video exporter exists.
    }
    const rev2dFile = resolve(process.env.PUPPETCONTROL_REV2D_ROOT ?? ".cache/rev2d", "bin", "rev2d.js");
    let rev2dAvailable = true;
    try { await access(rev2dFile); } catch { rev2dAvailable = false; }
    print({
      tool: "puppetctl",
      node: process.version,
      ffmpegAvailable: ffmpegFound,
      rev2dAvailable,
      availableFeatures: ["character-inspect", "scene-validate", "transition-policy", "rhubarb-cue-parsing", "rhubarb-align-if-installed", ...(rev2dAvailable ? ["single-rig-preview", "single-rig-voice-render", "pose-family-hard-cut-render", "experimental-shot-framing"] : [])],
      unavailableFeatures: ["animated-pose-bridges", "character-compile", "automatic-transcription", "text-to-speech", "multi-audio-mixing"],
    });
    return;
  }

  if (first === "audio" && second === "align" && third) {
    const flags = process.argv.slice(5);
    const recognized = new Set(["--out", "--binary", "--dialog", "--force"]);
    const values = new Map<string, string>();
    for (let index = 0; index < flags.length; index++) {
      const flag = flags[index];
      if (!flag || !recognized.has(flag) || values.has(flag)) usage();
      if (flag === "--force") {
        values.set(flag, "true");
        continue;
      }
      const value = flags[index + 1];
      if (!value || value.startsWith("--")) usage();
      values.set(flag, value);
      index++;
    }
    const output = values.get("--out");
    if (!output) usage();
    const aligned = await alignAudioWithRhubarb({
      audioPath: third,
      outputPath: output,
      ...(values.has("--binary") ? { binary: values.get("--binary")! } : {}),
      ...(values.has("--dialog") ? { dialogPath: values.get("--dialog")! } : {}),
      overwrite: values.has("--force"),
    });
    print(aligned);
    return;
  }

  if (first === "character" && second === "inspect" && third) {
    const input = await readFile(resolve(third), "utf8");
    const parsed = characterSchema.safeParse(JSON.parse(input) as unknown);
    if (!parsed.success) {
      print({ valid: false, diagnostics: parsed.error.issues });
      process.exitCode = 1;
      return;
    }
    print({
      valid: true,
      id: parsed.data.id,
      defaultPose: parsed.data.defaultPose,
      poseFamilies: parsed.data.poseFamilies,
      expressions: parsed.data.expressions,
      motions: parsed.data.motions,
      transitions: parsed.data.transitions,
      note: "Schema validation does not prove that a visual rig/asset can render.",
    });
    return;
  }

  if (first === "scene" && second === "validate" && third) {
    const result = await loadAndValidateScene(third);
    print(result.valid
      ? { valid: true, scene: result.scene.id, diagnostics: result.check.diagnostics, transitions: result.check.transitions }
      : { valid: false, diagnostics: result.diagnostics });
    if (!result.valid) process.exitCode = 1;
    return;
  }

  if (first === "scene" && second === "plan" && third) {
    const result = await loadAndValidateScene(third);
    if (!result.valid) {
      print({ valid: false, diagnostics: result.diagnostics });
      process.exitCode = 1;
      return;
    }
    const plans = result.scene.actors.map((actor) => ({
      actor: actor.id,
      plan: planPoseTimeline(result.scene, result.characters.get(actor.id), actor.id),
    }));
    print({ valid: true, scene: result.scene.id, plans });
    return;
  }

  if (first === "scene" && (second === "preview" || second === "render") && third) {
    const result = await loadAndValidateScene(third);
    if (!result.valid) {
      print({ valid: false, diagnostics: result.diagnostics });
      process.exitCode = 1;
      return;
    }
    const actor = result.scene.actors[0];
    if (!actor) throw new PreviewUnsupportedError("ACTOR_REQUIRED", "Scene needs one actor.");
    const character = result.characters.get(actor.id);
    if (!character) throw new PreviewUnsupportedError("ACTOR_NOT_LOADED", "Missing character manifest.");

    const frameRoot = resolve(".cache", "puppetcontrol-renders", result.scene.id + "-" + randomUUID());
    const frameResult = await renderRev2DFrames(
      result.scene,
      character,
      resolve(dirname(resolve(third)), actor.characterPath),
      actor.id,
      frameRoot,
      third,
    );
    if (second === "preview") {
      print({ valid: true, kind: "frame-preview", ...frameResult, limitations: ["Preview PNG frames are pre-camera; shot framing is applied on MP4 export. Pose cuts remain hard cuts and no animated bridges exist yet."] });
      return;
    }
    const args = process.argv.slice(5);
    const outputIndex = args.indexOf("--out");
    if (outputIndex !== -1 && !args[outputIndex + 1]) usage();
    if (args.length > 0 && (outputIndex !== 0 || args.length !== 2)) usage();
    const outputFile = args[outputIndex + 1] ?? resolve("outputs", result.scene.id + ".mp4");
    const mp4 = await encodeFrames(frameResult, outputFile);
    print({ valid: true, kind: frameResult.audio ? "voiced-mp4" : "silent-mp4", output: mp4, ...frameResult, limitations: ["Shot framing is experimental; no captions, smooth between-pose bridges or automatic Rhubarb invocation yet."] });
    return;
  }
  usage();
}

run().catch((error: unknown) => {
  print({
    valid: false,
    code: error instanceof PreviewUnsupportedError || error instanceof PoseTimelineError ? error.code : "CLI_UNEXPECTED_ERROR",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

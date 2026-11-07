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
import { AvatarWorkflowError, importAvatar, buildAvatar } from "../character/avatar.js";
import { prepareLandmarkTask, stageLandmarks, acceptLandmarks } from "../character/landmarks.js";
import { proposeCodexLandmarks, codexExecutableForPlatform } from "../character/vision-codex.js";
import { verifyAvatarBuildRecord } from "../character/provenance.js";
import { requestDrawnVariants, statusDrawnVariants, importDrawnVariants } from "../character/drawn-variants.js";

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function usage(): never {
  process.stderr.write(
    "PuppetControl CLI (early schema/validation milestone)\n" +
    "Usage:\n" +
    "  puppetctl doctor\n" +
    "  puppetctl character inspect <character.json>\n" +
    "  puppetctl character import <picture.png> --out <project-dir> --id <character-id>\n" +
    "  puppetctl character build <project-dir> [--force]\n" +
    "  puppetctl character variants request <project-dir> [variant-id ...]\n" +
    "  puppetctl character variants status <project-dir>\n" +
    "  puppetctl character variants import <project-dir> <variant-id ...> [--experimental-short-fade] --reviewed-art\n" +
    "  puppetctl character landmarks assist <project-dir>\n" +
    "  puppetctl character landmarks propose <project-dir> --provider codex\n" +
    "  puppetctl character landmarks stage <project-dir> --proposal <proposal.json>\n" +
    "  puppetctl character landmarks accept <project-dir> --candidate <dir> --reviewed\n" +
    "  puppetctl audio align <voice.wav> --out <mouth.json> [--binary rhubarb] [--force]\n" +
    "  puppetctl scene validate <scene.json>\n" +
    "  puppetctl scene plan <scene.json>\n" +
    "  puppetctl scene preview <scene.json>\n" +
    "  puppetctl scene render <scene.json> [--out output.mp4]\n" +
    "  puppetctl --help\n" +
    "\nPreview/render require a configured Rev2D rig. Single-image imports require reviewed landmarks and explicit approval.\n",
  );
  process.exit(2);
}

async function run(): Promise<void> {
  const [first, second, third] = process.argv.slice(2);
  if (first === "--help" || first === "help") {
    process.stdout.write(
      "PuppetControl (experimental)\n" +
      "Available: doctor, character inspect/import/build, drawn-variant request/status/import, landmark assist/propose/stage/accept, audio align, scene validate/plan, single-rig scene preview/render.\n" +
      "Not yet available: reliable one-click landmark inference, animated pose bridges, captions, automatic transcription/TTS.\n",
    );
    return;
  }

  if (first === "doctor") {
    let codexCliAvailable = false;
    try { execFileSync(codexExecutableForPlatform(process.platform), ["--version"], { stdio: "ignore", timeout: 5000 }); codexCliAvailable = true; } catch { /* optional provider */ }
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
      codexCliAvailable,
      availableFeatures: ["character-inspect", "scene-validate", "transition-policy", "rhubarb-cue-parsing", "rhubarb-align-if-installed", ...(rev2dAvailable ? ["assisted-png-avatar-import", "local-drawn-variants", "agent-landmark-proposal-staging", ...(codexCliAvailable ? ["optional-codex-vision-proposals"] : []), "avatar-review-sheets", "single-rig-preview", "single-rig-voice-render", "pose-family-hard-cut-render", "experimental-shot-framing"] : [])],
      unavailableFeatures: ["animated-pose-bridges", "automatic-landmark-placement", "automatic-transcription", "text-to-speech", "multi-audio-mixing"],
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

  if (first === "character" && second === "import" && third) {
    const flags = process.argv.slice(5);
    if (flags.length !== 4 || flags[0] !== "--out" || flags[2] !== "--id" || !flags[1] || !flags[3]) usage();
    print(await importAvatar(third, flags[1], flags[3]));
    return;
  }

  if (first === "character" && second === "build" && third) {
    const flags = process.argv.slice(5);
    if (flags.length > 1 || (flags.length === 1 && flags[0] !== "--force")) usage();
    print(await buildAvatar(third, flags[0] === "--force"));
    return;
  }

  if (first === "character" && second === "variants" && third) {
    const [project, ...flags] = process.argv.slice(5);
    if (!project) usage();
    if (third === "status" && flags.length === 0) {
      print(await statusDrawnVariants(project));
      return;
    }
    if (third === "request") {
      print(await requestDrawnVariants(project, flags));
      return;
    }
    if (third === "import" && flags.length >= 2 && flags[flags.length - 1] === "--reviewed-art") {
      const requested = flags.slice(0, -1);
      const shortFadeIndex = requested.indexOf("--experimental-short-fade");
      if (shortFadeIndex >= 0 && shortFadeIndex !== requested.length - 1) usage();
      const ids = shortFadeIndex >= 0 ? requested.slice(0, -1) : requested;
      print(await importDrawnVariants(project, ids, process.cwd(), { experimentalShortFade: shortFadeIndex >= 0 }));
      return;
    }
    usage();
  }

  if (first === "character" && second === "landmarks" && third) {
    const [project, ...flags] = process.argv.slice(5);
    if (!project) usage();
    if (third === "assist" && flags.length === 0) {
      print(await prepareLandmarkTask(project));
      return;
    }
    if (third === "propose" && flags.length === 2 && flags[0] === "--provider" && flags[1] === "codex") {
      const result = await proposeCodexLandmarks(project);
      print(result);
      if (!result.valid) process.exitCode = 1;
      return;
    }
    if (third === "stage" && flags.length === 2 && flags[0] === "--proposal" && flags[1]) {
      print(await stageLandmarks(project, flags[1]));
      return;
    }
    if (third === "accept" && flags.length === 3 && flags[0] === "--candidate" &&
        flags[1] && flags[2] === "--reviewed") {
      print(await acceptLandmarks(project, flags[1], true));
      return;
    }
    usage();
  }

  if (first === "character" && second === "inspect" && third) {
    const input = await readFile(resolve(third), "utf8");
    const parsed = characterSchema.safeParse(JSON.parse(input) as unknown);
    if (!parsed.success) {
      print({ valid: false, diagnostics: parsed.error.issues });
      process.exitCode = 1;
      return;
    }
    if (parsed.data.provenance) {
      const verified = parsed.data.render?.modelPath
        ? await verifyAvatarBuildRecord(resolve(third), parsed.data.render.modelPath)
        : { valid: false as const, code: "AVATAR_BUILD_RECORD_INVALID", message: "Missing model path" };
      if (!verified.valid) {
        print({ valid: false, code: verified.code, message: verified.message });
        process.exitCode = 1;
        return;
      }
    }
    print({
      valid: true,
      assetIntegrity: parsed.data.provenance ? "verified" : "not-applicable",
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
    code: error instanceof PreviewUnsupportedError || error instanceof PoseTimelineError || error instanceof AvatarWorkflowError ? error.code : "CLI_UNEXPECTED_ERROR",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

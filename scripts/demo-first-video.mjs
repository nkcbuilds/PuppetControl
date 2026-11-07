#!/usr/bin/env node

/**
 * Reproducible first-video integration demo.
 *
 * The demo never approves user artwork. It copies the pinned MIT-licensed
 * Rev2D Hana sample into an ignored .cache fixture, renders a review PNG, and
 * only marks that ephemeral sample fixture approved when --reviewed-sample is
 * supplied explicitly.
 */

import { execFileSync } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REV2D_SHA = "f144581cdf1f12d781379c4df90d262b8c2dfa3d";
const FPS = 15;
const DURATION_SECONDS = 5;
const WIDTH = 512;
const HEIGHT = 640;
const FRAME_COUNT = FPS * DURATION_SECONDS;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rev2dRoot = join(root, ".cache", "rev2d");
const rev2dModel = join(rev2dRoot, "examples", "hana", "hana.r2d.json");
const rev2dCli = join(rev2dRoot, "bin", "rev2d.js");
const cli = join(root, "dist", "cli", "index.js");
const checker = join(root, "scripts", "check-first-video-video.mjs");

function repoRelative(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      "Usage: node scripts/demo-first-video.mjs [--reviewed-sample]\n\n" +
      "Without --reviewed-sample, only an ignored Hana review fixture is prepared.\n" +
      "After visually reviewing the generated PNG, rerun with --reviewed-sample to\n" +
      "create two 5-second scenes, render both MP4s, and verify them with FFprobe.\n",
    );
    return { help: true, reviewedSample: false };
  }
  const unknown = argv.filter((arg) => arg !== "--reviewed-sample");
  if (unknown.length > 0) throw new Error("Unknown argument: " + unknown[0]);
  return { help: false, reviewedSample: argv.includes("--reviewed-sample") };
}

function execJson(command, args, label, maxBuffer = 32 * 1024 * 1024) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 180_000,
      maxBuffer,
    });
    const parsed = JSON.parse(stdout);
    if (parsed.valid === false || parsed.ok === false) {
      throw new Error(JSON.stringify(parsed));
    }
    return parsed;
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error
      ? String(error.stdout ?? "").trim()
      : "";
    const stderr = error && typeof error === "object" && "stderr" in error
      ? String(error.stderr ?? "").trim()
      : "";
    const detail = [stdout, stderr, error instanceof Error ? error.message : String(error)]
      .filter(Boolean)
      .join("\n");
    throw new Error(label + " failed:\n" + detail);
  }
}

function invokeCli(args) {
  return execJson(process.execPath, [cli, ...args], "puppetctl " + args.join(" "));
}

function invokeChecker(videoPath) {
  return execJson(process.execPath, [
    checker,
    repoRelative(videoPath),
    "--fps", String(FPS),
    "--width", String(WIDTH),
    "--height", String(HEIGHT),
    "--frames", String(FRAME_COUNT),
    "--video-codec", "h264",
  ], "first-video FFprobe acceptance");
}

function assertPinnedRev2D() {
  const actual = execFileSync("git", ["-C", rev2dRoot, "rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  }).trim();
  if (actual !== REV2D_SHA) {
    throw new Error(
      "Pinned Rev2D checkout required. Expected " + REV2D_SHA +
      " but found " + actual + ". Run npm run rig:setup.",
    );
  }
}

function assertBuiltCliHasSceneNew() {
  const help = execFileSync(process.execPath, [cli, "--help"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  if (!help.includes("scene new")) {
    throw new Error("Built CLI does not contain 'scene new'. Run npm run build on the integrated first-video branch.");
  }
}

function renderReviewPng(modelPath, outputPath) {
  return execJson(process.execPath, [
    rev2dCli,
    "render", modelPath,
    "-o", outputPath,
    "--json",
  ], "Rev2D Hana review render");
}

async function createDemoCharacter(characterFile, modelFile, reviewedSample) {
  const template = JSON.parse(
    await readFile(join(root, "examples", "characters", "hana", "character.json"), "utf8"),
  );

  const fixture = {
    ...template,
    id: "hana-first-video-demo",
    defaultPose: "neutral",
    poseFamilies: [{
      name: "neutral",
      rigId: "hana-first-video-demo-neutral",
      head: "shared",
      approved: reviewedSample,
    }],
    transitions: [],
    render: {
      ...template.render,
      modelPath: "hana.r2d.json",
    },
  };

  await copyFile(rev2dModel, modelFile);
  await writeFile(characterFile, JSON.stringify(fixture, null, 2) + "\n", "utf8");
}

async function replaceSceneEvents(sceneFile, events) {
  const scene = JSON.parse(await readFile(sceneFile, "utf8"));
  scene.events = events;
  await writeFile(sceneFile, JSON.stringify(scene, null, 2) + "\n", "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return;

  await Promise.all([access(rev2dModel), access(rev2dCli), access(cli), access(checker)]);
  assertPinnedRev2D();

  const generatedRoot = join(root, ".cache", "first-video-demo");
  await mkdir(generatedRoot, { recursive: true });
  const runDir = await mkdtemp(join(generatedRoot, "run-"));
  const characterDir = join(runDir, "character");
  const scenesDir = join(runDir, "scenes");
  const outputsDir = join(runDir, "outputs");
  await Promise.all([
    mkdir(characterDir, { recursive: true }),
    mkdir(scenesDir, { recursive: true }),
    mkdir(outputsDir, { recursive: true }),
  ]);

  const modelFile = join(characterDir, "hana.r2d.json");
  const characterFile = join(characterDir, "character.json");
  const reviewPng = join(runDir, "hana-review.png");
  await createDemoCharacter(characterFile, modelFile, options.reviewedSample);
  const review = renderReviewPng(modelFile, reviewPng);

  if (!options.reviewedSample) {
    process.stdout.write(JSON.stringify({
      valid: true,
      status: "review-required",
      runDir: repoRelative(runDir),
      reviewPng: repoRelative(reviewPng),
      reviewDimensions: { width: review.width, height: review.height },
      approved: false,
      next: "Visually inspect the review PNG, then rerun: node scripts/demo-first-video.mjs --reviewed-sample",
      note: "Human visual review/consent cannot be technically verified. This fixture is ignored and test-only; no user artwork is approved.",
    }, null, 2) + "\n");
    return;
  }

  assertBuiltCliHasSceneNew();

  const sceneA = join(scenesDir, "hana-scene-a.json");
  const sceneB = join(scenesDir, "hana-scene-b.json");
  const videoA = join(outputsDir, "hana-scene-a.mp4");
  const videoB = join(outputsDir, "hana-scene-b.mp4");

  invokeCli([
    "scene", "new", repoRelative(sceneA),
    "--character", repoRelative(characterFile),
    "--id", "hana-scene-a",
    "--seconds", String(DURATION_SECONDS),
    "--fps", String(FPS),
    "--size", WIDTH + "x" + HEIGHT,
  ]);
  invokeCli([
    "scene", "new", repoRelative(sceneB),
    "--character", repoRelative(characterFile),
    "--id", "hana-scene-b",
    "--seconds", String(DURATION_SECONDS),
    "--fps", String(FPS),
    "--size", WIDTH + "x" + HEIGHT,
  ]);

  await replaceSceneEvents(sceneA, [
    { atMs: 500, actor: "hana-first-video-demo", kind: "expression", name: "happy", intensity: 0.75 },
    { atMs: 1400, actor: "hana-first-video-demo", kind: "look", x: 0.38, y: -0.12, durationMs: 700 },
    { atMs: 3000, actor: "hana-first-video-demo", kind: "expression", name: "confused", intensity: 0.6 },
    { atMs: 3900, actor: "hana-first-video-demo", kind: "look", x: -0.3, y: 0.18, durationMs: 700 },
  ]);
  await replaceSceneEvents(sceneB, [
    { atMs: 400, actor: "hana-first-video-demo", kind: "expression", name: "annoyed", intensity: 0.55 },
    { atMs: 1150, actor: "hana-first-video-demo", kind: "look", x: -0.42, y: 0.12, durationMs: 650 },
    { atMs: 2600, actor: "hana-first-video-demo", kind: "expression", name: "happy", intensity: 0.65 },
    { atMs: 3650, actor: "hana-first-video-demo", kind: "look", x: 0.32, y: -0.2, durationMs: 800 },
  ]);

  const validationA = invokeCli(["scene", "validate", repoRelative(sceneA)]);
  const validationB = invokeCli(["scene", "validate", repoRelative(sceneB)]);
  const renderA = invokeCli(["scene", "render", repoRelative(sceneA), "--out", repoRelative(videoA)]);
  const renderB = invokeCli(["scene", "render", repoRelative(sceneB), "--out", repoRelative(videoB)]);
  const probeA = invokeChecker(videoA);
  const probeB = invokeChecker(videoB);

  process.stdout.write(JSON.stringify({
    valid: true,
    status: "first-video-demo-rendered",
    runDir: repoRelative(runDir),
    fixture: {
      character: repoRelative(characterFile),
      model: repoRelative(modelFile),
      sourceRev2DCommit: REV2D_SHA,
      approved: true,
      scope: "ignored test-only Hana fixture",
      humanReviewTechnicallyVerified: false,
    },
    scenes: [
      {
        scene: repoRelative(sceneA),
        output: repoRelative(videoA),
        validation: validationA,
        render: renderA,
        ffprobe: probeA,
      },
      {
        scene: repoRelative(sceneB),
        output: repoRelative(videoB),
        validation: validationB,
        render: renderB,
        ffprobe: probeB,
      },
    ],
    expected: {
      seconds: DURATION_SECONDS,
      fps: FPS,
      width: WIDTH,
      height: HEIGHT,
      frames: FRAME_COUNT,
      audio: false,
    },
    note: "Both scenes reuse one copied pinned Hana rig. The explicit sample-review flag is not a production approval mechanism and never approves user artwork.",
  }, null, 2) + "\n");
}

await main();

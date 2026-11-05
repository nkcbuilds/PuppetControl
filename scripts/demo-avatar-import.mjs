#!/usr/bin/env node
/**
 * End-to-end local assisted-avatar demo.
 * Generates a source PNG from pinned Rev2D's MIT Hana sample, runs PuppetControl
 * import, installs tested landmark annotations, then builds review sheets.
 *
 * The result intentionally remains unapproved until a visual QA decision.
 * All generated models, textures and source images stay in ignored .cache.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, ".cache/rev2d");
const sha = "f144581cdf1f12d781379c4df90d262b8c2dfa3d";
const actual = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (actual !== sha) throw new Error("Pinned Rev2D checkout required; run npm run rig:setup");

const cli = join(root, "dist", "cli", "index.js");
await access(cli);

function invoke(argv) {
  const stdout = execFileSync(process.execPath, argv, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  if (parsed.valid === false || parsed.ok === false) {
    throw new Error(JSON.stringify(parsed));
  }
  return parsed;
}

const generatedRoot = resolve(root, ".cache/avatar-onboarding");
await mkdir(generatedRoot, { recursive: true });
const demoRoot = await mkdtemp(join(generatedRoot, "repro-"));
const sourceImage = join(demoRoot, "source-original.png");
const projectDir = join(demoRoot, "character");

invoke([
  join(repo, "bin/rev2d.js"),
  "render", join(repo, "examples/hana/hana.r2d.json"),
  "-o", sourceImage, "--json",
]);

const imported = invoke([
  cli, "character", "import", sourceImage,
  "--out", projectDir, "--id", "hana-import",
]);

const landmarks = JSON.parse(
  await readFile(join(root, "examples/avatar-import/hana-landmarks.json"), "utf8"),
);
await writeFile(join(projectDir, "avatar.json"), JSON.stringify(landmarks, null, 2) + "\n");

const built = invoke([cli, "character", "build", projectDir]);

process.stdout.write(JSON.stringify({
  valid: true,
  status: "review-required",
  projectDir,
  copiedSourceSha256: imported.sourceSha256,
  characterManifest: built.characterPath,
  previewScene: built.previewScenePath,
  review: built.review,
  approved: false,
  note: "The imported rig is intentionally unapproved; inspect each review image and correct eyelid artifacts before use in production.",
}, null, 2) + "\n");

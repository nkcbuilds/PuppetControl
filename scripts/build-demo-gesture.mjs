#!/usr/bin/env node
/**
 * Experimental continuous right-arm gesture rig.
 * Derives Rev2D Hana pointing art into one rig with articulated shoulder and
 * elbow controls. The arm rotates behind the blouse at 0, then extends at 1.
 * This remains a stylized two-dimensional animation prototype.
 */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rev2dRoot = join(root, ".cache", "rev2d");
const sha = "f144581cdf1f12d781379c4df90d262b8c2dfa3d";
const head = execFileSync("git", ["-C", rev2dRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== sha) throw new Error("Expected pinned Rev2D checkout " + sha + " but found " + head);

const sourcePath = join(root, "examples", "characters", "hana", "rigs", "pointing.r2d.json");
let input;
try {
  input = JSON.parse(await readFile(sourcePath, "utf8"));
} catch (error) {
  throw new Error("Run npm run demo:poses first: " + String(error));
}
const model = structuredClone(input);
if (model.meta.name !== "hana-pointing") throw new Error("Unexpected source pose");

const armParts = new Set(["posePointSleeve", "posePointArm", "posePointHandCrease"]);
for (const part of model.parts) {
  if (!armParts.has(part.id)) continue;
  // Under the original blouse when lowered; visible outside its silhouette
  // when raised. No alpha fade and no second overlaid static arm.
  part.parent = part.id === "posePointSleeve" ? "demoRightArm" : "demoRightForearm";
  part.z = part.id === "posePointSleeve" ? 10.3 :
    part.id === "posePointArm" ? 9.02 : 9.03;
  // The sleeve is the same fabric as the torso; suppress its static outline
  // to prevent a detached shoulder-contour line while the arm lifts.
  if (part.id === "posePointSleeve") delete part.stroke;
}
if (model.parts.filter((part) => armParts.has(part.id)).length !== armParts.size) {
  throw new Error("Pointing artwork is missing required part IDs");
}

model.meta.name = "hana-arm-raise-gesture";
model.meta.description = "PuppetControl Rev2D Hana animated arm prototype. Param ArmRaise moves the same body art rigidly by a controlled rotation; original face/head/body rig and effects preserved.";
model.parameters.push({
  id: "ArmRaise",
  min: 0,
  max: 1,
  default: 0,
  group: "Body",
  description: "0 points down behind blouse, 1 points right, 0..1 smoothly raises arm",
});
model.parameters.push({
  id: "ElbowExtend",
  min: 0,
  max: 1,
  default: 0,
  group: "Body",
  description: "0 tucked elbow, 1 straightened elbow",
});
model.bones.push({
  id: "demoRightArm",
  parent: "body",
  x: 180,
  y: 134,
  rotation: 0,
  length: 132,
  description: "Screen-right arm pivot near shoulder, child of body bone",
});
model.bones.push({
  id: "demoRightForearm",
  parent: "demoRightArm",
  x: -20,
  y: 50,
  rotation: 0,
  length: 80,
  description: "Screen-right elbow for articulated pointing gesture",
});
model.bindings.push({
  id: "raiseRightArm",
  target: "bone:demoRightArm.rotation",
  params: ["ArmRaise"],
  keys: [
    { at: [0], value: 90 },
    { at: [1], value: 0 },
  ],
});
model.bindings.push({
  id: "extendRightElbow",
  target: "bone:demoRightForearm.rotation",
  params: ["ElbowExtend"],
  keys: [
    { at: [0], value: -50 },
    { at: [1], value: 0 },
  ],
});
const output = join(root, "examples", "characters", "hana", "rigs", "gesture.r2d.json");
await writeFile(output, JSON.stringify(model, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output, source: sourcePath, head, parameters: model.parameters.length, addedBones: ["demoRightArm", "demoRightForearm"] }, null, 2));

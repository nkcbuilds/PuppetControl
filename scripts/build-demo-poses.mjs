#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REV2D_SHA = "f144581cdf1f12d781379c4df90d262b8c2dfa3d";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const rev2dRoot = join(root, ".cache", "rev2d");
const sourcePath = join(rev2dRoot, "examples", "hana", "hana.r2d.json");
const outputDir = join(root, "examples", "characters", "hana", "rigs");

function clone(value) {
  return structuredClone(value);
}

function pathPart(id, d, z, fill, stroke, description, parent = "bodyWarp") {
  return {
    id,
    parent,
    shape: { type: "path", d, detail: 16 },
    fill,
    ...(stroke ? { stroke } : {}),
    z,
    description,
  };
}

function assertPinnedRev2D() {
  const head = execFileSync(
    "git",
    ["-C", rev2dRoot, "rev-parse", "HEAD"],
    { encoding: "utf8", windowsHide: true },
  ).trim();

  if (head !== REV2D_SHA) {
    throw new Error(
      "Refusing to derive demo poses from Rev2D " + head + "; expected pinned " + REV2D_SHA,
    );
  }
}

function assertCompatible(base, derived, poseName) {
  for (const key of ["parameters", "bones", "warps", "bindings", "physics", "animations"]) {
    if (JSON.stringify(derived[key]) !== JSON.stringify(base[key])) {
      throw new Error(poseName + ": " + key + " changed unexpectedly");
    }
  }

  const originalPartCount = base.parts.length;
  for (let index = 0; index < originalPartCount; index += 1) {
    if (JSON.stringify(derived.parts[index]) !== JSON.stringify(base.parts[index])) {
      throw new Error(
        poseName + ": original part " + (base.parts[index]?.id ?? index) + " changed unexpectedly",
      );
    }
  }

  const ids = new Set();
  for (const part of derived.parts) {
    if (!part?.id || ids.has(part.id)) {
      throw new Error(poseName + ": duplicate or missing part id " + String(part?.id));
    }
    ids.add(part.id);
  }
}

function derive(base, poseName, extraParts) {
  const model = clone(base);
  model.meta.name = "hana-" + poseName;
  model.meta.description =
    'PuppetControl demo pose "' + poseName + '", deterministically derived from RevStudio/Rev2D Hana at ' +
    REV2D_SHA +
    ". The original rig, face/head artwork, named parameters, bindings, physics and animations are unchanged; only extra body artwork is added under the existing body rig hierarchy.";
  model.parts = [...model.parts, ...extraParts];
  assertCompatible(base, model, poseName);
  return model;
}

async function main() {
  assertPinnedRev2D();

  const base = JSON.parse(await readFile(sourcePath, "utf8"));
  if (base?.format !== "rev2d" || base?.meta?.name !== "hana" || !Array.isArray(base.parts)) {
    throw new Error("Unexpected Rev2D Hana source at " + sourcePath);
  }

  const blouse = base.parts.find((part) => part.id === "blouse");
  if (!blouse?.fill || !blouse?.stroke) {
    throw new Error("Pinned Hana blouse styling was not found");
  }

  const blouseFill = clone(blouse.fill);
  const blouseStroke = clone(blouse.stroke);
  const skinFill = "#fde7dc";
  const skinStroke = { color: "#c98b82", width: 1.25 };
  const creaseStroke = { color: "#c98b82", width: 1.1 };

  const neutral = derive(base, "neutral", []);

  const pointing = derive(base, "pointing", [
    pathPart(
      "posePointSleeve",
      "M 382 408 C 414 406 444 418 460 438 C 462 448 454 462 438 476 C 418 468 404 450 392 430 L 374 424 Z",
      18,
      clone(blouseFill),
      clone(blouseStroke),
      "Raised sleeve for the pointing pose.",
      "body",
    ),
    pathPart(
      "posePointArm",
      "M 438 438 C 452 432 466 428 481 426 L 502 420 C 508 419 512 422 511 426 C 510 430 506 432 500 433 L 484 437 C 492 438 498 441 501 445 C 503 448 501 452 497 453 C 491 453 485 449 479 447 C 469 453 458 460 448 464 C 440 459 436 449 438 438 Z",
      19,
      skinFill,
      clone(skinStroke),
      "Forearm and hand with an extended index-finger silhouette.",
      "body",
    ),
    pathPart(
      "posePointHandCrease",
      "M 478 438 C 482 440 485 443 487 447 M 455 447 C 462 446 470 445 478 447",
      19.2,
      "transparent",
      clone(creaseStroke),
      "Small hand creases that make the pointing silhouette readable.",
      "body",
    ),
  ]);

  const crossed = derive(base, "arms-crossed", [
    pathPart(
      "poseCrossSleeveLeft",
      "M 116 414 C 136 416 158 430 176 452 C 181 466 176 480 162 490 C 140 476 124 458 108 438 C 108 428 111 420 116 414 Z",
      18,
      clone(blouseFill),
      clone(blouseStroke),
      "Left sleeve lifted inward for crossed arms.",
    ),
    pathPart(
      "poseCrossSleeveRight",
      "M 396 414 C 376 416 354 430 336 452 C 331 466 336 480 350 490 C 372 476 388 458 404 438 C 404 428 401 420 396 414 Z",
      18,
      clone(blouseFill),
      clone(blouseStroke),
      "Right sleeve lifted inward for crossed arms.",
    ),
    pathPart(
      "poseCrossArmBack",
      "M 155 468 C 183 470 222 482 258 494 C 292 506 324 514 349 512 C 356 516 357 525 351 532 C 321 536 286 526 249 514 C 211 502 178 492 151 490 C 144 484 146 474 155 468 Z",
      18.4,
      skinFill,
      clone(skinStroke),
      "Rear forearm crossing the torso from screen-left to screen-right.",
    ),
    pathPart(
      "poseCrossHandBack",
      "M 342 510 C 354 507 365 508 374 513 C 379 517 378 523 373 526 C 365 530 355 530 347 527 L 338 522 Z",
      18.5,
      skinFill,
      clone(skinStroke),
      "Rear hand resting near the opposite elbow.",
    ),
    pathPart(
      "poseCrossArmFront",
      "M 357 470 C 329 473 291 486 256 500 C 222 513 190 522 163 520 C 155 525 155 535 162 541 C 192 544 228 533 264 520 C 302 506 334 494 361 492 C 368 485 366 476 357 470 Z",
      19,
      skinFill,
      clone(skinStroke),
      "Front forearm crossing the torso from screen-right to screen-left.",
    ),
    pathPart(
      "poseCrossHandFront",
      "M 171 517 C 159 515 148 517 139 523 C 135 527 136 533 141 536 C 150 539 160 538 168 534 L 178 528 Z",
      19.1,
      skinFill,
      clone(skinStroke),
      "Front hand resting near the opposite elbow.",
    ),
    pathPart(
      "poseCrossCreases",
      "M 188 491 C 216 499 239 507 261 516 M 322 496 C 296 504 276 511 257 519",
      19.2,
      "transparent",
      clone(creaseStroke),
      "Subtle forearm creases to keep the overlap readable.",
    ),
  ]);

  await mkdir(outputDir, { recursive: true });
  const outputs = [
    ["neutral.r2d.json", neutral],
    ["pointing.r2d.json", pointing],
    ["arms-crossed.r2d.json", crossed],
  ];

  for (const [name, model] of outputs) {
    await writeFile(join(outputDir, name), JSON.stringify(model, null, 2) + "\n", "utf8");
  }

  console.log(
    JSON.stringify(
      {
        source: sourcePath,
        rev2dSha: REV2D_SHA,
        outputDir,
        rigs: outputs.map(([name, model]) => ({
          name,
          modelName: model.meta.name,
          parameterIds: model.parameters.map((parameter) => parameter.id),
          originalParts: base.parts.length,
          totalParts: model.parts.length,
        })),
      },
      null,
      2,
    ),
  );
}

await main();

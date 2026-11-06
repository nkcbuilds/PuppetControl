import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AvatarWorkflowError, checkedPath } from "./avatar.js";
import { composeCandidate, prepareLandmarkTask, stageLandmarks } from "./landmarks.js";

const MAX_OUTPUT_BYTES = 200_000;

/** On Windows, require the native binary; never run an untrusted image prompt through cmd.exe. */
export function codexExecutableForPlatform(platform: NodeJS.Platform): string {
  return platform === "win32" ? "codex.exe" : "codex";
}

/**
 * Codex may consume supplemental stdin even when a positional prompt was
 * supplied. An inherited open pipe hangs the CLI at "Reading additional
 * input from stdin". Explicitly close its stdin and drain output streams.
 */
export function launchVisionSubprocess(
  executable: string, args: string[], cwd: string, timeoutMs = 240_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd, shell: false, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal: AbortSignal.timeout(timeoutMs),
    });
    let lastError = "";
    child.stdout?.resume();
    child.stderr?.on("data", (chunk: Buffer) => {
      lastError = (lastError + chunk.toString("utf8")).slice(-2400);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Codex process exit " + code + ": " + lastError.slice(-650)));
    });
  });
}

/** A successfully exited provider still must write a real bounded JSON response file. */
export async function readVisionOutput(path: string): Promise<string> {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new AvatarWorkflowError("VISION_RESPONSE_MISSING", "Codex completed without writing its response file");
    }
    throw error;
  }
  if (!details.isFile() || details.size > MAX_OUTPUT_BYTES) {
    throw new AvatarWorkflowError("VISION_RESPONSE_TOO_LARGE", "Codex response must be a JSON file below 200 KB");
  }
  return readFile(path, "utf8");
}

export interface CodexVisionArgs {
  root: string;
  source: string;
  grid: string;
  responsePath: string;
  prompt: string;
}

/** Use an explicitly read-only, ephemeral Codex session. No shell injection. */
export function buildCodexVisionArgs(options: CodexVisionArgs): string[] {
  return [
    "exec", options.prompt,
    "--sandbox", "read-only", "--ephemeral",
    "--skip-git-repo-check", "--cd", options.root,
    "--output-last-message", options.responsePath,
    "--image", options.source, options.grid,
  ];
}

/** Reject markdown-wrapped responses, injected commands and stale image hashes. */
export function parseVisionResponse(
  text: string, template: Record<string, unknown>, sourceSha256: string,
): Record<string, unknown> {
  let proposal: unknown;
  try {
    proposal = JSON.parse(text);
  } catch {
    throw new AvatarWorkflowError("VISION_RESPONSE_INVALID", "Vision model must return exactly one JSON object, not Markdown or commentary");
  }
  composeCandidate(template, proposal, sourceSha256);
  return proposal as Record<string, unknown>;
}



/**
 * Repair only unambiguous model-output representation errors. The model may
 * describe vertical bands as {yStart,yEnd}, or iris radii as [rx,ry] even
 * though the pinned Rev2D schema wants [yStart,yEnd] and a scalar radius.
 * These conversions never infer landmarks from scratch or grant approval.
 */
export function normalizeVisionProposal(input: Record<string, unknown>): {
  proposal: Record<string, unknown>;
  changes: string[];
} {
  const proposal = structuredClone(input);
  const changes: string[] = [];
  const landmarks = proposal.landmarks as {
    head?: { neck?: unknown };
    body?: { fade?: unknown };
    face?: { eyes?: Record<string, { iris?: { radius?: unknown } }> };
  } | undefined;
  const normalizeRange = (value: unknown, label: string): unknown => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const v = value as Record<string, unknown>;
      if (Object.keys(v).length === 2 &&
          typeof v.yStart === "number" && Number.isFinite(v.yStart) &&
          typeof v.yEnd === "number" && Number.isFinite(v.yEnd) &&
          v.yStart <= v.yEnd) {
        changes.push(label + ": converted yStart/yEnd object into a two-value range");
        return [v.yStart, v.yEnd];
      }
    }
    return value;
  };
  if (landmarks?.head) landmarks.head.neck = normalizeRange(landmarks.head.neck, "head.neck");
  if (landmarks?.body) landmarks.body.fade = normalizeRange(landmarks.body.fade, "body.fade");
  for (const side of ["imageLeft", "imageRight"]) {
    const iris = landmarks?.face?.eyes?.[side]?.iris;
    if (!iris || !Array.isArray(iris.radius) || iris.radius.length !== 2) continue;
    const [rx, ry] = iris.radius;
    if (typeof rx === "number" && Number.isFinite(rx) && rx > 0 &&
        typeof ry === "number" && Number.isFinite(ry) && ry > 0) {
      iris.radius = Math.min(rx, ry);
      changes.push("face.eyes." + side + ".iris.radius: used smaller radius from two-value ellipse");
    }
  }
  return { proposal, changes };
}

export interface VisionQualityWarning {
  code: string;
  message: string;
}

/**
 * Detect obviously missing controls despite upstream geometry validation.
 * These are conservative review warnings, not an automated quality score.
 */
export function assessVisionProposal(proposal: Record<string, unknown>): VisionQualityWarning[] {
  const warnings: VisionQualityWarning[] = [];
  const landmarks = proposal.landmarks as {
    face?: { eyes?: Record<string, { iris?: { center?: unknown; radius?: unknown } }> };
  } | undefined;
  for (const side of ["imageLeft", "imageRight"]) {
    const iris = landmarks?.face?.eyes?.[side]?.iris;
    const center = iris?.center;
    if (!Array.isArray(center) || center.length !== 2 ||
        center.some((v) => typeof v !== "number" || !Number.isFinite(v)) ||
        typeof iris?.radius !== "number" || !Number.isFinite(iris.radius) || iris.radius <= 0) {
      warnings.push({
        code: "IRIS_LANDMARKS_MISSING",
        message: side + " has no usable iris center/radius; eye gaze may be static or inaccurate",
      });
    }
  }
  return warnings;
}

/** Generate a source-specific prompt with Rev2D geometry fields, not made-up example coordinates. */
export function createCodexVisionPrompt(templateJson: string, width: number, height: number): string {
  const geometry = JSON.parse(templateJson) as {
    landmarks: { face: { eyes: Record<string, Record<string, unknown>> } };
  };
  for (const side of ["imageLeft", "imageRight"]) {
    const eye = geometry.landmarks.face.eyes[side] ?? {};
    geometry.landmarks.face.eyes[side] = {
      opening: [], region: [], ...eye,
      iris: eye.iris ?? { center: null, radius: null },
    };
  }
  return [
    "You are an expert annotation assistant for a Live2D-like character rig.",
    "Visually inspect BOTH attached images. Image 1 is the original cartoon character illustration.",
    "Image 2 is the same image with a source-pixel coordinate grid.",
    "Image dimensions: " + width + "x" + height + " pixels. All coordinates are absolute source pixels.",
    "Task: infer Rev2D avatar geometry with high precision. Do not assume the person is photorealistic.",
    "imageLeft and imageRight mean viewer-left and viewer-right eyes, NOT the character\'s left/right.",
    "Return EXACTLY ONE JSON object, without markdown fences, with this proposal's exact top-level fields.",
    "Fully replace every null/empty placeholder for required head, face, eye, mouth, body positions.",
    "Trace each eye opening INSIDE lash/eyeliner boundaries; opening arrays should have 14-20 coordinate pairs flattened as x,y values.",
    "Eye region arrays must enclose the whole eye/lashes, but avoid overlapping hair and the other eye.",
    "Iris centers and radius must refer to the actual colored iris in each eye. Radii are positive numbers.",
    "Face center/radius follow the exposed face/cheeks; head ellipse surrounds the entire head and hair.",
    "Head pivot should lie at neck. Neck/fade are vertical yStart/yEnd pairs. Mouth area is around lips.",
    "Do NOT invent limbs, unseen hair, file paths, source image fields, commands, or user identity.",
    "Leave optional hair strands and attachments empty if not visually obvious.",
    "This is a proposed annotation: you do NOT have permission to modify project files, accept a proposal or approve a rig.",
    "Do not include prose except short notes inside the JSON.",
    "",
    "PROPOSAL TEMPLATE (replace placeholder geometry with visually inferred numbers; preserve format/hash):",
    JSON.stringify(geometry, null, 2),
  ].join("\n");
}

/**
 * One explicit Codex model invocation. Uses local PNGs as visual inputs,
 * preserves raw output in ignored work files, and attempts to stage for
 * Rev2D validation followed by explicit visual review.
 */
export async function proposeCodexLandmarks(projectPath: string, root = process.cwd()) {
  const project = await checkedPath(root, projectPath);
  const task = await prepareLandmarkTask(project, root);
  const source = await checkedPath(root, join(project, "source.png"));
  const grid = await checkedPath(root, join(project, "work", "grid.png"));
  const templatePath = await checkedPath(root, task.proposalTemplate);
  const specPath = await checkedPath(root, join(project, "avatar.json"));
  const [templateText, specText] = await Promise.all([
    readFile(templatePath, "utf8"), readFile(specPath, "utf8"),
  ]);
  const template = JSON.parse(templateText) as Record<string, unknown>;
  const spec = JSON.parse(specText) as { image: { width: number; height: number } };
  const outputDir = await checkedPath(root, join(project, "work", "vision-proposals"));
  await mkdir(outputDir, { recursive: true });
  const rawFile = await checkedPath(root, join(outputDir, "codex-" + randomUUID() + ".json"));
  const prompt = createCodexVisionPrompt(templateText, spec.image.width, spec.image.height);
  const args = buildCodexVisionArgs({
    root: resolve(root), source, grid, responsePath: rawFile, prompt,
  });

  try {
    await launchVisionSubprocess(codexExecutableForPlatform(process.platform), args, resolve(root));
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === "ENOENT") {
      throw new AvatarWorkflowError(
        "CODEX_CLI_NOT_AVAILABLE",
        process.platform === "win32"
          ? "Native codex.exe is not available on PATH. npm codex.cmd shims are not supported by this read-only, shell-free launcher. Use the manual landmarks assist workflow."
          : "Codex CLI was not found on PATH. Install Codex or use the manual landmarks assist workflow.",
      );
    }
    throw new AvatarWorkflowError(
      "CODEX_VISION_FAILED",
      "Codex vision generation failed; check CLI login/network. " + failure.message.slice(0, 750),
    );
  }

  const responseText = await readVisionOutput(rawFile);
  const rawProposal = parseVisionResponse(responseText, template, task.sourceSha256);
  const normalized = normalizeVisionProposal(rawProposal);
  const parsed = normalized.proposal;
  const qualityWarnings = assessVisionProposal(parsed);
  const proposalFile = await checkedPath(root, join(outputDir, "proposal-" + randomUUID() + ".json"));
  await writeFile(proposalFile, JSON.stringify(parsed, null, 2) + "\n", { flag: "wx" });

  try {
    const staged = await stageLandmarks(project, proposalFile, root);
    return {
      valid: true, status: qualityWarnings.length ? "overlay-review-required-with-warnings" : "overlay-review-required", provider: "codex",
      proposalFile, candidateDir: staged.candidateDir, overlay: staged.overlay,
      qualityWarnings, normalizedFields: normalized.changes, approved: false,
      next: "Inspect the source and candidate overlay. Only accept with --reviewed after genuine visual inspection.",
    };
  } catch (error) {
    if (!(error instanceof AvatarWorkflowError) ||
        error.code !== "REV2D_AVATAR_FAILED") throw error;
    return {
      valid: false, status: "proposal-needs-revision", provider: "codex",
      proposalFile, approved: false, qualityWarnings, normalizedFields: normalized.changes, diagnostics: error.message,
      next: "Rev2D rejected suggested geometry. Open source, correct the proposal JSON and run landmarks stage manually.",
    };
  }
}

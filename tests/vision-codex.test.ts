import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  buildCodexVisionArgs,
  createCodexVisionPrompt,
  parseVisionResponse,
  assessVisionProposal,
  normalizeVisionProposal,
  launchVisionSubprocess,
  codexExecutableForPlatform,
  readVisionOutput,
} from "../src/character/vision-codex.js";

const hash = "b".repeat(64);
const template = {
  format: "puppetcontrol-landmarks-v1",
  sourceSha256: hash,
  landmarks: {
    head: { center: null },
    face: { eyes: {} },
    body: { pivot: null },
    hair: { strands: [] },
    attachments: [],
  },
};
const proposed = {
  ...template,
  landmarks: {
    head: { center: [256, 200], radius: [150, 180] },
    face: { eyes: { imageLeft: {}, imageRight: {} } },
    body: { pivot: [256, 450] },
    hair: { strands: [] },
    attachments: [],
  },
  notes: "Visual proposal. Eyelids require review.",
};

describe("optional Codex vision landmark proposals", () => {
  it("uses a native Windows executable and never invokes cmd.exe for model prompts", () => {
    expect(codexExecutableForPlatform("win32")).toBe("codex.exe");
    expect(codexExecutableForPlatform("linux")).toBe("codex");
    expect(codexExecutableForPlatform("darwin")).toBe("codex");
  });

  it("reports a stable error if Codex exits without a response file", async () => {
    const missing = join(process.cwd(), ".cache", "missing-codex-" + randomUUID() + ".json");
    await expect(readVisionOutput(missing))
      .rejects.toMatchObject({ code: "VISION_RESPONSE_MISSING" });
  });

  it("closes child stdin so the CLI never stalls requesting extra input", async () => {
    await expect(launchVisionSubprocess(
      process.execPath,
      ["-e", "process.stdin.on('end', () => process.exit(0));process.stdin.resume();setTimeout(() => process.exit(42), 1500)"],
      process.cwd(), 2500,
    )).resolves.toBeUndefined();
  });

  it("passes images directly to read-only Codex without approval/sandbox bypass", () => {
    const args = buildCodexVisionArgs({
      root: "S:/PuppetControl", source: "S:/PuppetControl/avatars/test/source.png",
      grid: "S:/PuppetControl/avatars/test/work/grid.png",
      responsePath: "S:/PuppetControl/avatars/test/work/vision-proposals/raw.json",
      prompt: "Describe coordinates",
    });
    expect(args).toContain("--image");
    expect(args).toContain("--output-last-message");
    expect(args).toContain("--ephemeral");
    expect(args.slice(args.indexOf("--sandbox") + 1, args.indexOf("--sandbox") + 2)).toEqual(["read-only"]);
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("workspace-write");
    expect(args[1]).toBe("Describe coordinates");
    expect(args.slice(-2)).toEqual(["S:/PuppetControl/avatars/test/source.png", "S:/PuppetControl/avatars/test/work/grid.png"]);
  });

  it("prompts the model with the original pixel size, both eyes and the proposal template", () => {
    const prompt = createCodexVisionPrompt(JSON.stringify(template), 512, 640);
    expect(prompt).toContain("512x640");
    expect(prompt).toContain("image");
    expect(prompt).toContain("imageLeft");
    expect(prompt).toContain("imageRight");
    expect(prompt).toContain("iris");
    expect(prompt).toContain(hash);
    expect(prompt).toContain("source pixels");
  });

  it("parses a well-formed suggestion but never treats it as approval", () => {
    const parsed = parseVisionResponse(JSON.stringify(proposed), template, hash);
    expect(parsed).toEqual(proposed);
    expect(parsed).not.toHaveProperty("approved");
  });

  it("normalizes explicit y bands and iris ellipse radii without guessing anatomy", () => {
    const irregular = structuredClone(proposed);
    irregular.landmarks.head = { ...irregular.landmarks.head, neck: { yStart: 350, yEnd: 415 } };
    irregular.landmarks.body = { ...irregular.landmarks.body, fade: { yStart: 365, yEnd: 465 } };
    irregular.landmarks.face = { eyes: {
      imageLeft: { iris: { center: [210, 255], radius: [16, 21] } },
      imageRight: { iris: { center: [302, 255], radius: [15, 20] } },
    } };
    const result = normalizeVisionProposal(irregular);
    const changed = result.proposal.landmarks as {
      head: { neck: number[] };
      body: { fade: number[] };
      face: { eyes: { imageLeft: { iris: { radius: number } }; imageRight: { iris: { radius: number } } } };
    };
    expect(changed.head.neck).toEqual([350, 415]);
    expect(changed.body.fade).toEqual([365, 465]);
    expect(changed.face.eyes.imageLeft.iris.radius).toBe(16);
    expect(changed.face.eyes.imageRight.iris.radius).toBe(15);
    expect(result.changes).toHaveLength(4);
    expect(assessVisionProposal(result.proposal)).toEqual([]);
    expect((irregular.landmarks.head as Record<string, unknown>).neck).toEqual({ yStart: 350, yEnd: 415 });
  });

  it("flags irisless proposals even when basic Rev2D geometry might validate", () => {
    const warnings = assessVisionProposal(proposed);
    expect(warnings.map((w) => w.code)).toEqual([
      "IRIS_LANDMARKS_MISSING", "IRIS_LANDMARKS_MISSING",
    ]);
    const eyes = proposed.landmarks.face.eyes as Record<string, unknown>;
    const full = {
      ...proposed,
      landmarks: {
        ...proposed.landmarks,
        face: {
          eyes: {
            ...eyes,
            imageLeft: { iris: { center: [210, 255], radius: 16 } },
            imageRight: { iris: { center: [302, 255], radius: 16 } },
          },
        },
      },
    };
    expect(assessVisionProposal(full)).toEqual([]);
  });

  it("rejects stale image hashes, markdown-wrapped responses and unsafe paths", () => {
    const ticks = String.fromCharCode(96).repeat(3);
    expect(() => parseVisionResponse(ticks + "json\n" + JSON.stringify(proposed) + "\n" + ticks, template, hash))
      .toThrow(/exactly one JSON/);
    expect(() => parseVisionResponse(JSON.stringify({
      ...proposed,
      sourceSha256: "c".repeat(64),
    }), template, hash)).toThrow(/does not match/);
    expect(() => parseVisionResponse(JSON.stringify({
      ...proposed,
      landmarks: { ...proposed.landmarks, image: { file: "../../sensitive.png" } },
    }), template, hash)).toThrow(/only landmark geometry/);
    expect(() => parseVisionResponse(JSON.stringify({
      ...proposed,
      command: "echo unsafe",
    }), template, hash)).toThrow(/Unexpected proposal property/);
  });
});

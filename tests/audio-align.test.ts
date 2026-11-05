import { describe, expect, it } from "vitest";
import { buildRhubarbArgs } from "../src/audio/align.js";

describe("Rhubarb local command builder", () => {
  it("uses bounded argv with no shell and explicit JSON shape output", () => {
    expect(buildRhubarbArgs("a file; $(echo hi).wav", "out.tmp.json")).toEqual([
      "--exportFormat", "json",
      "--extendedShapes", "GHX",
      "--output", "out.tmp.json",
      "--",
      "a file; $(echo hi).wav",
    ]);
  });
  it("supports supplied transcript without shell interpretation", () => {
    const argv = buildRhubarbArgs("voice.wav", "cue.json", "dialog text.txt");
    expect(argv).toContain("--dialogFile");
    expect(argv).toContain("dialog text.txt");
    expect(argv.at(-1)).toBe("voice.wav");
  });
  it("rejects null-byte or empty input", () => {
    expect(() => buildRhubarbArgs("", "out.json")).toThrow();
    expect(() => buildRhubarbArgs("in.wav", "out\0.json")).toThrow();
  });
});

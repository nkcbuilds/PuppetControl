import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadAndValidateScene } from "../src/scene/load.js";

describe("loadAndValidateScene", () => {
  it("loads a real example scene plus a linked character manifest", async () => {
    const result = await loadAndValidateScene(resolve("examples/scenes/intro.json"));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.characters.get("maya")?.id).toBe("maya");
      expect(result.check.transitions.map((decision) => decision.mode))
        .toEqual(["interpolate", "interpolate", "bridge"]);
    }
  });

  it("reports a missing source file without throwing", async () => {
    const result = await loadAndValidateScene("nonexistent.scene.json");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics[0]?.code).toBe("SCENE_READ_FAILED");
    }
  });
});

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { characterSchema, sceneSchema, type Character, type Scene } from "./schemas.js";
import { validateSceneCapabilities, type Diagnostic, type SceneValidation } from "./validate.js";
import { verifyAvatarBuildRecord, checkAvatarPoseCoverage } from "../character/provenance.js";
import { checkedPath } from "../character/avatar.js";
import { verifyCueBinding } from "../audio/cue-provenance.js";

async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text) as unknown;
}

export type LoadResult =
  | { valid: true; scene: Scene; characters: Map<string, Character>; check: SceneValidation }
  | { valid: false; diagnostics: Diagnostic[] };

export async function loadAndValidateScene(filePath: string, options: { root?: string } = {}): Promise<LoadResult> {
  const absolutePath = options.root ? await checkedPath(options.root, resolve(filePath)) : resolve(filePath);
  let raw: unknown;
  try {
    raw = await readJson(absolutePath);
  } catch (error) {
    return {
      valid: false,
      diagnostics: [{ severity: "error", code: "SCENE_READ_FAILED", path: absolutePath, message: String(error) }],
    };
  }

  const parsed = sceneSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      diagnostics: parsed.error.issues.map((issue) => ({
        severity: "error" as const,
        code: "SCENE_SCHEMA_INVALID",
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const characters = new Map<string, Character>();
  const diagnostics: Diagnostic[] = [];
  for (const [index, audio] of parsed.data.audio.entries()) {
    if (!audio.bindingPath) continue; // Legacy scenes remain supported.
    if (!audio.cuesPath) {
      diagnostics.push({ severity: "error", code: "CUE_BINDING_MISSING_OR_INVALID",
        path: "audio." + index, message: "Bound audio requires Rhubarb cuesPath." });
      continue;
    }
    const directory = dirname(absolutePath);
    const verified = await verifyCueBinding(
      resolve(directory, audio.path), resolve(directory, audio.cuesPath),
      resolve(directory, audio.bindingPath),
    );
    if (!verified.valid) diagnostics.push({
      severity: "error", code: verified.code,
      path: "audio." + index + ".bindingPath", message: verified.message,
    });
  }
  for (const actor of parsed.data.actors) {
    const characterFile = options.root
      ? await checkedPath(options.root, resolve(dirname(absolutePath), actor.characterPath))
      : resolve(dirname(absolutePath), actor.characterPath);
    try {
      const character = characterSchema.safeParse(await readJson(characterFile));
      if (!character.success) {
        for (const issue of character.error.issues) {
          diagnostics.push({
            severity: "error", code: "CHARACTER_SCHEMA_INVALID",
            path: "actors." + actor.id + "." + issue.path.join("."),
            message: issue.message,
          });
        }
      } else {
        if (character.data.provenance) {
          const coverage = checkAvatarPoseCoverage(character.data);
          if (!coverage.valid) {
            diagnostics.push({
              severity: "error", code: coverage.code,
              path: "actors." + actor.id + ".provenance", message: coverage.message,
            });
            continue;
          }
          const expectedModel = character.data.render?.modelPath;
          const verified = expectedModel
            ? await verifyAvatarBuildRecord(characterFile, expectedModel)
            : { valid: false as const, code: "AVATAR_BUILD_RECORD_INVALID", message: "Imported character requires a configured model" };
          if (!verified.valid) {
            diagnostics.push({
              severity: "error", code: verified.code,
              path: "actors." + actor.id + ".provenance", message: verified.message,
            });
            continue;
          }
        }
        characters.set(actor.id, character.data);
      }
    } catch (error) {
      diagnostics.push({
        severity: "error", code: "CHARACTER_LOAD_FAILED", path: characterFile,
        message: String(error),
      });
    }
  }

  if (diagnostics.length) return { valid: false, diagnostics };

  const check = validateSceneCapabilities(parsed.data, characters);
  if (!check.valid) return { valid: false, diagnostics: check.diagnostics };
  return { valid: true, scene: parsed.data, characters, check };
}

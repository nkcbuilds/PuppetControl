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

function invalid(code: string, path: string, message: string): Diagnostic {
  return { severity: "error", code, path, message };
}

export async function loadAndValidateScene(
  filePath: string,
  options: { root?: string } = {},
): Promise<LoadResult> {
  // A custom root must constrain *all* scene inputs, not merely the scene
  // manifest and actors. Path checks also resolve existing symlink ancestors.
  let absolutePath: string;
  try {
    absolutePath = options.root ? await checkedPath(options.root, resolve(filePath)) : resolve(filePath);
  } catch (error) {
    return {
      valid: false,
      diagnostics: [invalid("SCENE_PATH_OUTSIDE_WORKSPACE", filePath, String(error))],
    };
  }

  let raw: unknown;
  try {
    raw = await readJson(absolutePath);
  } catch (error) {
    return {
      valid: false,
      diagnostics: [invalid("SCENE_READ_FAILED", absolutePath, String(error))],
    };
  }

  const parsed = sceneSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      diagnostics: parsed.error.issues.map((issue) =>
        invalid("SCENE_SCHEMA_INVALID", issue.path.join("."), issue.message)),
    };
  }

  const characters = new Map<string, Character>();
  const diagnostics: Diagnostic[] = [];
  const sceneDir = dirname(absolutePath);

  for (const [index, audio] of parsed.data.audio.entries()) {
    const audioPath = "audio." + index;
    let source = resolve(sceneDir, audio.path);
    let cuesFile = audio.cuesPath ? resolve(sceneDir, audio.cuesPath) : undefined;
    let bindingFile = audio.bindingPath ? resolve(sceneDir, audio.bindingPath) : undefined;
    if (options.root) {
      try {
        source = await checkedPath(options.root, source);
        if (cuesFile) cuesFile = await checkedPath(options.root, cuesFile);
        if (bindingFile) bindingFile = await checkedPath(options.root, bindingFile);
      } catch (error) {
        diagnostics.push(invalid("AUDIO_PATH_OUTSIDE_WORKSPACE", audioPath, String(error)));
        continue;
      }
    }
    if (!bindingFile) continue; // Older scenes without exact-byte binding still work.
    if (!cuesFile) {
      diagnostics.push(invalid("CUE_BINDING_MISSING_OR_INVALID", audioPath,
        "Bound audio requires Rhubarb cuesPath"));
      continue;
    }
    const verified = await verifyCueBinding(source, cuesFile, bindingFile);
    if (!verified.valid) diagnostics.push(invalid(
      verified.code, audioPath + ".bindingPath", verified.message));
  }

  for (const actor of parsed.data.actors) {
    let characterFile = resolve(sceneDir, actor.characterPath);
    try {
      if (options.root) characterFile = await checkedPath(options.root, characterFile);
      const character = characterSchema.safeParse(await readJson(characterFile));
      if (!character.success) {
        for (const issue of character.error.issues) {
          diagnostics.push(invalid("CHARACTER_SCHEMA_INVALID",
            "actors." + actor.id + "." + issue.path.join("."), issue.message));
        }
        continue;
      }
      if (character.data.provenance) {
        const coverage = checkAvatarPoseCoverage(character.data);
        if (!coverage.valid) {
          diagnostics.push(invalid(coverage.code, "actors." + actor.id + ".provenance", coverage.message));
          continue;
        }
        const expectedModel = character.data.render?.modelPath;
        const verified = expectedModel
          ? await verifyAvatarBuildRecord(characterFile, expectedModel)
          : { valid: false as const, code: "AVATAR_BUILD_RECORD_INVALID",
              message: "Imported character requires a configured model" };
        if (!verified.valid) {
          diagnostics.push(invalid(verified.code, "actors." + actor.id + ".provenance", verified.message));
          continue;
        }
      }
      characters.set(actor.id, character.data);
    } catch (error) {
      diagnostics.push(invalid("CHARACTER_LOAD_FAILED", "actors." + actor.id,
        "Could not load character from its scoped path: " + String(error)));
    }
  }

  if (diagnostics.length) return { valid: false, diagnostics };

  const check = validateSceneCapabilities(parsed.data, characters);
  if (!check.valid) return { valid: false, diagnostics: check.diagnostics };
  return { valid: true, scene: parsed.data, characters, check };
}

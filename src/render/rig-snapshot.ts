/**
 * Materialize a provenance-checked, private *per-render* copy of an imported
 * Rev2D rig and its texture files.
 *
 * No renderer is allowed to reopen the original model/texture paths after this
 * step. Copies are verified against the approved source/spec/rig/texture record
 * before Rev2D is invoked. The snapshot stays in the ignored frame directory.
 *
 * This excludes accidental/ordinary concurrent source replacement, but does
 * NOT promise resistance to a malicious process with write access to the
 * snapshot directory itself.
 */
import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { copyFile, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { checkedPath, PINNED_REV2D_SHA, AvatarWorkflowError } from "../character/avatar.js";
import { AVATAR_BUILD_RECORD, avatarBuildRecordSchema } from "../character/provenance.js";

const MAX_SINGLE_ASSET_BYTES = 35 * 1024 * 1024;
const MAX_ASSETS = 1028;

function canonicalAssetPath(path: string): boolean {
  return !!path && !isAbsolute(path) && !path.includes("\\") &&
    !path.includes(":") && !path.startsWith("/") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

async function digestFile(filename: string, maxBytes = MAX_SINGLE_ASSET_BYTES): Promise<string> {
  const file = await stat(filename);
  if (!file.isFile() || file.size < 1 || file.size > maxBytes) {
    throw new AvatarWorkflowError("AVATAR_ASSETS_STALE",
      "A source or snapshot asset is missing, empty or exceeds its size limit");
  }
  const h = createHash("sha256");
  for await (const chunk of createReadStream(filename)) h.update(chunk as Buffer);
  return h.digest("hex");
}

export interface VerifiedRigSnapshot {
  modelPath: string;
  snapshotDirectory: string;
  fileCount: number;
}

export async function snapshotImportedRig(
  characterFile: string,
  expectedModel: string,
  snapshotDirectory: string,
  root = process.cwd(),
): Promise<VerifiedRigSnapshot> {
  const project = await realpath(dirname(await checkedPath(root, resolve(characterFile))));
  const recordFile = await checkedPath(project, join(project, AVATAR_BUILD_RECORD));
  const record = avatarBuildRecordSchema.parse(
    JSON.parse(await readFile(recordFile, "utf8")) as unknown,
  );
  if (record.backendCommit !== PINNED_REV2D_SHA ||
      record.model.path !== expectedModel.replaceAll("\\", "/") ||
      record.source.path !== "source.png" || record.spec.path !== "avatar.json" ||
      !record.textures.every((item) => item.path.startsWith("textures/"))) {
    throw new AvatarWorkflowError("AVATAR_BUILD_RECORD_INVALID",
      "Build record does not describe the expected Rev2D model and canonical source assets");
  }

  const entries = [record.source, record.spec, record.model, ...record.textures];
  if (entries.length > MAX_ASSETS || entries.some((item) => !canonicalAssetPath(item.path)) ||
      new Set(entries.map((item) => item.path)).size !== entries.length) {
    throw new AvatarWorkflowError("AVATAR_BUILD_RECORD_INVALID",
      "Build record contains invalid, duplicate or excessive asset references");
  }

  // Verify the model's texture list agrees with the record *before* copying it.
  // The snapshot copy itself is hashed again below, so a source swap in between
  // cannot silently produce a different renderer asset set.
  const sourceModel = await checkedPath(project, join(project, record.model.path));
  const modelInfo = await stat(sourceModel);
  if (!modelInfo.isFile() || modelInfo.size < 1 || modelInfo.size > 20_000_000) {
    throw new AvatarWorkflowError("AVATAR_ASSETS_STALE", "Model missing or exceeds the 20 MB rig limit");
  }
  const model = JSON.parse(await readFile(sourceModel, "utf8")) as {
    textures?: Array<{ path?: unknown }>;
  };
  if (!Array.isArray(model.textures)) {
    throw new AvatarWorkflowError("AVATAR_TEXTURE_LIST_INVALID", "Imported rig has no valid textures");
  }
  const texturePaths = model.textures.map((item) => {
    const raw = item?.path;
    const name = typeof raw === "string" && raw.startsWith("./") ? raw.slice(2) : raw;
    if (typeof name !== "string" || !canonicalAssetPath(name) || !name.startsWith("textures/")) {
      throw new AvatarWorkflowError("AVATAR_TEXTURE_LIST_INVALID", "Rig has a noncanonical texture path");
    }
    return name;
  });
  const unique = [...new Set(texturePaths)].sort();
  if (JSON.stringify(unique) !== JSON.stringify(record.textures.map((x) => x.path).sort())) {
    throw new AvatarWorkflowError("AVATAR_TEXTURE_LIST_INVALID",
      "Rig texture references do not match the provenance record");
  }

  const rootReal = await realpath(root);
  const dst = await checkedPath(rootReal, resolve(snapshotDirectory));
  // Every render gets a new UUID-containing output directory; do not accept
  // or overwrite an existing directory or any preexisting snapshot files.
  await mkdir(dst);
  const snapshotReal = await realpath(dst);
  await checkedPath(rootReal, snapshotReal);
  for (const item of entries) {
    const from = await checkedPath(project, join(project, item.path));
    const out = await checkedPath(snapshotReal, join(snapshotReal, item.path));
    await mkdir(dirname(out), { recursive: true });
    await copyFile(from, out, constants.COPYFILE_EXCL);
    const copiedHash = await digestFile(out);
    if (copiedHash !== item.sha256) {
      throw new AvatarWorkflowError("AVATAR_ASSETS_STALE",
        "Source art, rig or texture bytes changed while preparing verified render inputs");
    }
  }
  const modelPath = await checkedPath(snapshotReal, join(snapshotReal, expectedModel));
  const diff = relative(snapshotReal, modelPath);
  if (diff === ".." || diff.startsWith(".." + sep)) {
    throw new AvatarWorkflowError("AVATAR_ASSETS_STALE", "Snapshot model escaped its private directory");
  }
  return { modelPath, snapshotDirectory: snapshotReal, fileCount: entries.length };
}

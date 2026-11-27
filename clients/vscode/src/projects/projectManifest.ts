/**
 * Records which server project (and which AI project type) a workspace folder belongs to, in
 * the folder's app manifest (`.builderforce/builderforce.json`, `MANIFEST_PATH`). The file may
 * already hold an app manifest, so the fields are MERGED into it: every other member is kept,
 * and a file that is not a JSON object is never overwritten.
 *
 * The runtime's validator does not reject unknown top-level members; the editor schema
 * (`scripts/manifest-editor-schema.mjs`) declares these two so a versioned manifest carrying
 * them is not flagged.
 */
import { MANIFEST_PATH } from "../composerCommands/manifestLocation";
import { inFolder, type ComposerWorkspacePort, type WorkspaceFolderRef } from "../composerCommands/workspacePort";

export interface ProjectManifestFields {
  projectId: number;
  projectType: string;
}

/** What the merge needs from the workspace: the slice of `ComposerWorkspacePort` it reads and writes. */
export type ManifestFilePort = Pick<ComposerWorkspacePort, "readText" | "writeText">;

export type MergeResult = { ok: true; text: string } | { ok: false; reason: "not-an-object" };

/** The manifest text with `fields` merged in; `existing` undefined (or blank) starts a new file. */
export function mergeProjectManifest(existing: string | undefined, fields: ProjectManifestFields): MergeResult {
  let base: Record<string, unknown> = {};
  if (existing !== undefined && existing.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch {
      return { ok: false, reason: "not-an-object" };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "not-an-object" };
    base = parsed as Record<string, unknown>;
  }
  return { ok: true, text: `${JSON.stringify({ ...base, projectId: fields.projectId, projectType: fields.projectType }, null, 2)}\n` };
}

/**
 * Merge `fields` into the folder's manifest and write it. Returns the merge refusal when the
 * existing file is not a JSON object (nothing is written); a write the workspace refuses rejects.
 */
export async function writeProjectManifest(
  port: ManifestFilePort,
  folder: WorkspaceFolderRef,
  fields: ProjectManifestFields,
): Promise<MergeResult> {
  const file = inFolder(folder, MANIFEST_PATH);
  const merged = mergeProjectManifest(await port.readText(file), fields);
  if (merged.ok) await port.writeText(file, merged.text);
  return merged;
}

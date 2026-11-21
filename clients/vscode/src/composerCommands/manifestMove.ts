/**
 * `/manifest move` (PRD 49): move a folder's legacy root manifest (`builderforce.json` or
 * `bfwc.app.json`) to `.builderforce/builderforce.json`, the only place the extension and the
 * runtime write it. It is the ONE action every "this manifest is at the folder root" reply
 * offers (`legacyManifestAction`).
 *
 * - Refused when `.builderforce/builderforce.json` already exists: nothing is ever overwritten.
 * - Refused when either path is a symbolic link or leads outside the folder (`writeContainment.ts`).
 * - Moved only on a modal approval; the move itself never replaces a file (`port.move`).
 *
 * It is also the ONE place the stale `"$schema": "<APP_MANIFEST_SCHEMA_URL>"` older versions wrote
 * is removed (`manifestSchema.ts`): a moved file loses it, and a folder with no root manifest whose
 * `.builderforce/builderforce.json` still carries it is offered its removal (`staleSchemaAction`,
 * which `/launch` offers). Only that exact top-level value goes; the rest of the text is untouched.
 */
import type { ComposerCommandExecutor } from "./dispatch";
import { MANIFEST_COMMAND_ID, MANIFEST_MOVE_ACTION } from "./entries";
import type { ComposerCommandText } from "./labels";
import { findFolderManifest, LEGACY_MANIFEST_FILES, MANIFEST_PATH } from "./manifestLocation";
import { APP_MANIFEST_SCHEMA_URL, withoutStaleSchema } from "./manifestSchema";
import type { ComposerReply, ComposerReplyAction } from "./reply";
import { chooseFolder, inFolder, TargetExistsError, type ComposerWorkspacePort, type WorkspaceFolderRef } from "./workspacePort";
import { writeRefusedReply } from "./writeContainment";

const MOVE_COMMAND = `/${MANIFEST_COMMAND_ID} ${MANIFEST_MOVE_ACTION}`;

/** The reply action that runs `/manifest move`. */
export function legacyManifestAction(text: ComposerCommandText): ComposerReplyAction {
  return { label: text.manifestMoveAction, command: MOVE_COMMAND };
}

/** The reply action that removes the canonical manifest's stale `$schema` (also `/manifest move`). */
export function staleSchemaAction(text: ComposerCommandText): ComposerReplyAction {
  return { label: text.manifestSchemaRemoveAction, command: MOVE_COMMAND };
}

export interface ManifestMoveDeps {
  port: ComposerWorkspacePort;
  text: ComposerCommandText;
}

/** No root manifest: remove the canonical file's stale `$schema` on approval, else there is nothing to move. */
async function repairCanonical(port: ComposerWorkspacePort, text: ComposerCommandText, folder: WorkspaceFolderRef): Promise<ComposerReply> {
  const target = inFolder(folder, MANIFEST_PATH);
  const current = await port.readText(target);
  const repaired = current === undefined ? undefined : withoutStaleSchema(current);
  if (repaired === undefined) return { kind: "text", tone: "info", lines: [text.manifestMoveNone(folder.name, LEGACY_MANIFEST_FILES)] };
  const refused = await port.checkWrites([target]);
  if (refused.length > 0) return writeRefusedReply(text, refused);
  const approved = await port.confirm(text.manifestSchemaRemoveQuestion(MANIFEST_PATH, APP_MANIFEST_SCHEMA_URL, folder.name), text.manifestSchemaRemove);
  if (!approved) return { kind: "text", tone: "info", lines: [text.manifestSchemaKept] };
  // Changed since it was read (an edit in another editor): that edit is never overwritten.
  if ((await port.readText(target)) !== current) return { kind: "text", tone: "error", lines: [text.manifestSchemaChanged(MANIFEST_PATH)] };
  await port.writeText(target, repaired);
  return { kind: "text", tone: "info", lines: [text.manifestSchemaRemoved(MANIFEST_PATH)] };
}

export function manifestMoveExecutor({ port, text }: ManifestMoveDeps): ComposerCommandExecutor {
  return async () => {
    const folder = await chooseFolder(port, text.pickFolder);
    if (!folder) return { kind: "text", tone: "info", lines: [text.noFolderChosen] };
    const source = await findFolderManifest(port, folder, LEGACY_MANIFEST_FILES);
    if (!source) return repairCanonical(port, text, folder);
    const target = inFolder(folder, MANIFEST_PATH);
    if (await port.exists(target)) {
      // A leftover root file beside the canonical one is never moved over it — but the canonical
      // file's stale `$schema` (the action `/launch` offers) is still removed.
      if (withoutStaleSchema((await port.readText(target)) ?? "") !== undefined) return repairCanonical(port, text, folder);
      return { kind: "text", tone: "error", lines: [text.manifestMoveExists(source.relative, MANIFEST_PATH)] };
    }
    // Refused before the question: a link (either end) is never moved through.
    const refused = await port.checkWrites([source.file, target]);
    if (refused.length > 0) return writeRefusedReply(text, refused);
    const sourceText = await port.readText(source.file);
    const repaired = sourceText === undefined ? undefined : withoutStaleSchema(sourceText);
    const question = text.manifestMoveQuestion(source.relative, MANIFEST_PATH, folder.name);
    const approved = await port.confirm(
      repaired === undefined ? question : `${question} ${text.manifestSchemaDropNote(APP_MANIFEST_SCHEMA_URL)}`,
      text.manifestMove,
    );
    if (!approved) return { kind: "text", tone: "info", lines: [text.manifestMoveDeclined] };
    try {
      await port.move(source.file, target);
    } catch (error) {
      // The target appeared after the check (another window, a sync): refused exactly as up front, nothing replaced.
      if (error instanceof TargetExistsError) return { kind: "text", tone: "error", lines: [text.manifestMoveExists(source.relative, MANIFEST_PATH)] };
      throw error;
    }
    const moved = text.manifestMoved(source.relative, MANIFEST_PATH);
    // The moved file is rewritten only when it is still exactly what was read and shown.
    if (repaired === undefined) return { kind: "text", tone: "info", lines: [moved] };
    if ((await port.readText(target)) !== sourceText) return { kind: "text", tone: "info", lines: [moved, text.manifestSchemaChanged(MANIFEST_PATH)] };
    await port.writeText(target, repaired);
    return { kind: "text", tone: "info", lines: [moved, text.manifestSchemaRemoved(MANIFEST_PATH)] };
  };
}

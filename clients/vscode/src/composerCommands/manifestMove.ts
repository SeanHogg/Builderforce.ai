/**
 * `/manifest move` (PRD 49): move a folder's legacy root manifest (`builderforce.json` or
 * `bfwc.app.json`) to `.builderforce/builderforce.json`, the only place the extension and the
 * runtime write it. It is the ONE action every "this manifest is at the folder root" reply
 * offers (`legacyManifestAction`).
 *
 * - Refused when `.builderforce/builderforce.json` already exists: nothing is ever overwritten.
 * - Refused when either path is a symbolic link or leads outside the folder (`writeContainment.ts`).
 * - Moved only on a modal approval; the move itself never replaces a file (`port.move`).
 */
import type { ComposerCommandExecutor } from "./dispatch";
import { MANIFEST_COMMAND_ID, MANIFEST_MOVE_ACTION } from "./entries";
import type { ComposerCommandText } from "./labels";
import { findFolderManifest, LEGACY_MANIFEST_FILES, MANIFEST_PATH } from "./manifestLocation";
import type { ComposerReplyAction } from "./reply";
import { chooseFolder, inFolder, type ComposerWorkspacePort } from "./workspacePort";
import { writeRefusedReply } from "./writeContainment";

/** The reply action that runs `/manifest move`. */
export function legacyManifestAction(text: ComposerCommandText): ComposerReplyAction {
  return { label: text.manifestMoveAction, command: `/${MANIFEST_COMMAND_ID} ${MANIFEST_MOVE_ACTION}` };
}

export interface ManifestMoveDeps {
  port: ComposerWorkspacePort;
  text: ComposerCommandText;
}

export function manifestMoveExecutor({ port, text }: ManifestMoveDeps): ComposerCommandExecutor {
  return async () => {
    const folder = await chooseFolder(port, text.pickFolder);
    if (!folder) return { kind: "text", tone: "info", lines: [text.noFolderChosen] };
    const source = await findFolderManifest(port, folder, LEGACY_MANIFEST_FILES);
    if (!source) return { kind: "text", tone: "info", lines: [text.manifestMoveNone(folder.name, LEGACY_MANIFEST_FILES)] };
    const target = inFolder(folder, MANIFEST_PATH);
    if (await port.exists(target)) return { kind: "text", tone: "error", lines: [text.manifestMoveExists(source.relative, MANIFEST_PATH)] };
    // Refused before the question: a link (either end) is never moved through.
    const refused = await port.checkWrites([source.file, target]);
    if (refused.length > 0) return writeRefusedReply(text, refused);
    const approved = await port.confirm(text.manifestMoveQuestion(source.relative, MANIFEST_PATH, folder.name), text.manifestMove);
    if (!approved) return { kind: "text", tone: "info", lines: [text.manifestMoveDeclined] };
    await port.move(source.file, target);
    return { kind: "text", tone: "info", lines: [text.manifestMoved(source.relative, MANIFEST_PATH)] };
  };
}

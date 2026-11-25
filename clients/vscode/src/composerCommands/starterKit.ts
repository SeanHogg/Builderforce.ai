/**
 * `/starter-kit <kit> [--with <extra,...>]` (PRD 31 §W11): `composeKit` from the
 * `ide-templates` part registry, written into a workspace folder.
 *
 * - A kit with issues (a fragment conflict, a part that needs another) writes NOTHING.
 * - A folder holding anything besides `.git` / `.vscode` / `.builderforce` (the folder the
 *   extension itself creates) needs a modal approval first, which names every file that would
 *   be overwritten. Declined ⇒ nothing is written. Only the emptiness test ignores those
 *   folders: a kit file already there is still a conflict.
 * - A path that is a symbolic link, or leads outside the folder, writes NOTHING and is
 *   named in the reply (`writeContainment.ts`). Every path is checked first; a write that
 *   still fails partway (the folder changed meanwhile) names the file and every file
 *   already written.
 * - A legacy root manifest (`builderforce.json` / `bfwc.app.json`) is named in the approval and
 *   the reply: the kit's `.builderforce/builderforce.json` supersedes it (delete it, or cancel and
 *   `/manifest move` it to keep it).
 * - In a remote extension host the reply offers no `/launch` (it cannot run there).
 */
import { composeKit } from "@builderforce/ide-templates/kits";
import type { ComposerCommandExecutor } from "./dispatch";
import type { ComposerCommandText } from "./labels";
import { messageOf } from "../shared/messageOf";
import { chooseFolder, inFolder, launchFollowUp, type ComposerWorkspacePort } from "./workspacePort";
import { WriteRefusedError, writeRefusedReply } from "./writeContainment";
import { findFolderManifest, LEGACY_MANIFEST_FILES, MANIFEST_PATH, WORKSPACE_DIR } from "./manifestLocation";

/**
 * Entries a fresh folder may already hold: version control, editor settings and the extension's
 * own folder (`.builderforce/`: its hooks and directives — and the kit's manifest goes there too).
 */
const IGNORED_ENTRIES = new Set([".git", ".vscode", WORKSPACE_DIR]);
/** How many conflicting paths the approval names before eliding the rest. */
const MAX_LISTED_CONFLICTS = 20;

export interface StarterKitDeps {
  port: ComposerWorkspacePort;
  text: ComposerCommandText;
}

export function starterKitExecutor({ port, text }: StarterKitDeps): ComposerCommandExecutor {
  return async (args) => {
    const kitId = String(args.kit);
    const extras = Array.isArray(args.with) ? args.with : typeof args.with === "string" ? [args.with] : [];
    const kit = composeKit(kitId, extras);
    if (kit.issues.length > 0) {
      return { kind: "text", tone: "error", lines: [text.kitIssues, ...kit.issues.map(text.kitIssue)] };
    }
    const folder = await chooseFolder(port, text.pickFolder);
    if (!folder) return { kind: "text", tone: "info", lines: [text.noFolderChosen] };

    const paths = Object.keys(kit.files);
    // Every path is checked BEFORE anything is written or asked: one refused path writes none.
    const refused = await port.checkWrites(paths.map((file) => inFolder(folder, file)));
    if (refused.length > 0) return writeRefusedReply(text, refused);
    const occupied = (await port.listDir(folder.path)).some((name) => !IGNORED_ENTRIES.has(name));
    // Checked even in an "empty" folder: a kit file inside an ignored folder (`.builderforce/builderforce.json`) is still a conflict.
    const conflicts: string[] = [];
    for (const file of paths) if (await port.exists(inFolder(folder, file))) conflicts.push(file);
    // A legacy root manifest stops being read once the kit's `.builderforce/builderforce.json` exists: said before and after.
    const legacy = await findFolderManifest(port, folder, LEGACY_MANIFEST_FILES);
    const superseded = legacy ? [text.kitSupersedesLegacy(legacy.relative, MANIFEST_PATH)] : [];
    if (occupied || conflicts.length > 0) {
      const listed = conflicts.length > MAX_LISTED_CONFLICTS
        ? [...conflicts.slice(0, MAX_LISTED_CONFLICTS), "…"]
        : conflicts;
      const [question, approve] = conflicts.length > 0
        ? [text.kitConflicts(folder.name, paths.length, listed), text.kitOverwrite]
        : [text.kitNonEmpty(folder.name, paths.length), text.kitWrite];
      const approved = await port.confirm([question, ...superseded].join(" "), approve);
      if (!approved) return { kind: "text", tone: "info", lines: [text.kitDeclined(folder.name)] };
    }

    const written: string[] = [];
    for (const file of paths) {
      try {
        await port.writeText(inFolder(folder, file), kit.files[file]!);
      } catch (error) {
        // A write refused (or failing) partway: name the file, and every file already written.
        const reason = error instanceof WriteRefusedError ? text.writeRefusedReason : messageOf(error);
        return { kind: "text", tone: "error", lines: [text.kitStopped(file, reason, written)] };
      }
      written.push(file);
    }
    const next = launchFollowUp(port, text);
    return {
      kind: "text",
      tone: "info",
      lines: [
        text.kitWritten(kitId, paths.length, folder.name),
        text.services(Object.keys(kit.manifest.services)),
        text.resources(Object.keys(kit.manifest.resources ?? {})),
        ...superseded,
        next.line,
      ],
      ...(next.actions ? { actions: next.actions } : {}),
    };
  };
}

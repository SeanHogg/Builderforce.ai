/**
 * `/starter-kit <kit> [--with <extra,...>]` (PRD 31 §W11): `composeKit` from the
 * `ide-templates` part registry, written into a workspace folder.
 *
 * - A kit with issues (a fragment conflict, a part that needs another) writes NOTHING.
 * - A folder holding anything besides `.git` / `.vscode` needs a modal approval first,
 *   which names every file that would be overwritten. Declined ⇒ nothing is written.
 */
import { composeKit } from "@builderforce/ide-templates/kits";
import type { ComposerCommandExecutor } from "./dispatch";
import type { ComposerCommandText } from "./labels";
import { chooseFolder, inFolder, type ComposerWorkspacePort } from "./workspacePort";
import { LAUNCH_COMMAND_ID } from "./entries";

/** Entries a fresh folder may already hold: version control and editor settings. */
const IGNORED_ENTRIES = new Set([".git", ".vscode"]);
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
      return { kind: "text", tone: "error", lines: [text.kitIssues, ...kit.issues.map((issue) => issue.message)] };
    }
    const folder = await chooseFolder(port, text.pickFolder);
    if (!folder) return { kind: "text", tone: "info", lines: [text.noFolderChosen] };

    const paths = Object.keys(kit.files);
    const occupied = (await port.listDir(folder.path)).some((name) => !IGNORED_ENTRIES.has(name));
    if (occupied) {
      const conflicts: string[] = [];
      for (const file of paths) if (await port.exists(inFolder(folder, file))) conflicts.push(file);
      const listed = conflicts.length > MAX_LISTED_CONFLICTS
        ? [...conflicts.slice(0, MAX_LISTED_CONFLICTS), "…"]
        : conflicts;
      const approved = conflicts.length > 0
        ? await port.confirm(text.kitConflicts(folder.name, paths.length, listed), text.kitOverwrite)
        : await port.confirm(text.kitNonEmpty(folder.name, paths.length), text.kitWrite);
      if (!approved) return { kind: "text", tone: "info", lines: [text.kitDeclined(folder.name)] };
    }

    for (const file of paths) await port.writeText(inFolder(folder, file), kit.files[file]!);
    return {
      kind: "text",
      tone: "info",
      lines: [
        text.kitWritten(kitId, paths.length, folder.name),
        text.services(Object.keys(kit.manifest.services)),
        text.resources(Object.keys(kit.manifest.resources ?? {})),
        text.launchHint,
      ],
      action: { label: `/${LAUNCH_COMMAND_ID}`, command: `/${LAUNCH_COMMAND_ID}` },
    };
  };
}

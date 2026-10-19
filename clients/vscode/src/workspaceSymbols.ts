/**
 * The editor's definition index — the VS Code configuration of the ONE shared
 * `WorkspaceSymbolIndex` (`@builderforce/agent-tools/node-symbols`, also behind the
 * on-prem runtime), backing `find_symbol` / `file_outline` for the open folder.
 *
 * What the editor adds over the defaults: the snapshot lives in the workspace's own
 * `.builderforce/` (beside the scan's map), the walk skips what `search_code` skips, and
 * the full stat walk is rare because the extension's file watcher reports every change
 * as it happens (`markSymbolFileChanged`) — the walk is only the backstop for changes a
 * watcher cannot see.
 *
 * Pure Node (no `vscode` import), so the capability provider and its tests can use it.
 */

import * as path from "path";
import { sharedSymbolIndex, SYMBOL_INDEX_SKIP_DIRS, type WorkspaceSymbolIndex } from "@builderforce/agent-tools/node-symbols";
import { SKIP_DIRS } from "./workspaceSearch";

/** Watcher-backed, so the full re-walk is a 10-minute backstop rather than per query. */
const FULL_REFRESH_MS = 10 * 60_000;

const skipDirs: ReadonlySet<string> = new Set([...SYMBOL_INDEX_SKIP_DIRS, ...SKIP_DIRS]);

/** The process-wide definition index for the workspace folder at `root`. */
export function workspaceSymbolIndex(root: string): WorkspaceSymbolIndex {
  return sharedSymbolIndex(root, {
    skipDirs,
    cachePath: path.join(root, ".builderforce", "symbols.json"),
    fullRefreshMs: FULL_REFRESH_MS,
  });
}

/** How many files the grounding section will name before it stops listing. */
const GROUNDING_FILE_CAP = 60;
/** How many symbols one file contributes to that line. */
const GROUNDING_SYMBOLS_PER_FILE = 6;
/** Hard cap on the section, so a large index cannot crowd the rest of the prompt out. */
const GROUNDING_CHARS = 3_500;

/**
 * A bounded view of the fresh definition index, for the run's grounding.
 *
 * `find_symbol` already reads `.builderforce/symbols.json`, but only once the model
 * asks. Loading it here means the turn starts with the index warm and a sample of
 * what it holds, instead of discovering the index exists by guessing a tool call.
 * The full index is not injected — a workspace snapshot is megabytes, and the
 * sample plus `find_symbol` is how a turn should navigate it.
 *
 * Best-effort: a walk that fails degrades to no section, never a failed turn.
 */
export async function symbolIndexGrounding(root: string): Promise<string> {
  if (!root) return "";
  try {
    const files = await workspaceSymbolIndex(root).filesUnder();
    if (files.length === 0) return "";
    const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    let symbolCount = 0;
    const lines: string[] = [];
    for (const file of ordered) {
      symbolCount += file.symbols.length;
      if (lines.length >= GROUNDING_FILE_CAP || file.symbols.length === 0) continue;
      const preferred = file.symbols.filter((s) => s.exported);
      const shown = (preferred.length > 0 ? preferred : file.symbols).slice(0, GROUNDING_SYMBOLS_PER_FILE);
      lines.push(`- ${file.path}: ${shown.map((s) => `${s.kind} ${s.name}`).join(", ")}`);
    }
    const more = ordered.length - lines.length;
    const body = [
      "## Symbol index",
      `Fresh definition index (\`.builderforce/symbols.json\`): ${ordered.length} files, ${symbolCount} symbols. Loaded before this run — call \`find_symbol\` for a name not listed below.`,
      ...lines,
      more > 0 ? `- … (${more} more files in the index)` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return body.length > GROUNDING_CHARS ? `${body.slice(0, GROUNDING_CHARS)}\n- …` : body;
  } catch {
    return "";
  }
}

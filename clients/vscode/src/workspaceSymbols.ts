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

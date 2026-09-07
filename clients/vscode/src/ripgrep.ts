/**
 * Where the editor finds a ripgrep binary for `search_code`.
 *
 * VS Code ships one (`@vscode/ripgrep`, the engine behind its own Search view), so on
 * every editor install there is a fast, ignore-aware searcher already on disk — the
 * extension only has to know where. A `rg` on PATH is the second choice; nothing found
 * means `search_code` falls back to walking the tree itself (see `workspaceSearch.ts`).
 *
 * Resolved ONCE per extension-host session and memoised: probing the filesystem or
 * spawning `rg --version` on every search would cost more than the search.
 *
 * No hard `vscode` import: the app root is read through a guarded `require` so this
 * module (and everything that imports it — the tool catalog, the run host) stays
 * loadable under vitest, where there is no VS Code host.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * The candidate paths of the ripgrep VS Code bundles, under the editor's `appRoot`.
 * Two layouts exist: a plain `node_modules` tree (older builds) and the
 * `node_modules.asar.unpacked` layout (builds that pack the app into an asar and
 * unpack native binaries beside it). Exported for the unit test.
 */
export function bundledRipgrepCandidates(appRoot: string | undefined, platform: NodeJS.Platform = process.platform): string[] {
  if (!appRoot) return [];
  const bin = platform === "win32" ? "rg.exe" : "rg";
  return [
    path.join(appRoot, "node_modules", "@vscode", "ripgrep", "bin", bin),
    path.join(appRoot, "node_modules.asar.unpacked", "@vscode", "ripgrep", "bin", bin),
  ];
}

/** The editor's install root, or undefined outside a VS Code host (tests, the harness). */
function vscodeAppRoot(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const host = require("vscode") as { env?: { appRoot?: string } };
    return host.env?.appRoot;
  } catch {
    return undefined;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Is `rg` runnable from PATH? Probed once; a missing binary is the common case. */
async function ripgrepOnPath(): Promise<boolean> {
  try {
    await execFileAsync("rg", ["--version"], { windowsHide: true, timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

let resolved: Promise<string | null> | undefined;

/**
 * The ripgrep binary to run, resolved once: the one VS Code ships, else `rg` on PATH,
 * else null (walk the tree instead). `appRoot` is injectable for tests; production
 * reads it from the host.
 */
export function findRipgrep(appRoot: string | undefined = vscodeAppRoot()): Promise<string | null> {
  if (!resolved) {
    resolved = (async () => {
      for (const candidate of bundledRipgrepCandidates(appRoot)) {
        if (await exists(candidate)) return candidate;
      }
      return (await ripgrepOnPath()) ? "rg" : null;
    })();
  }
  return resolved;
}

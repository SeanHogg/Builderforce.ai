/**
 * The on-prem definition index — the runtime's configuration of the ONE shared
 * `WorkspaceSymbolIndex` (`@builderforce/agent-tools/node-symbols`, also behind the VS
 * Code workspace), backing `find_symbol` / `file_outline` and, without Builderforce
 * Desktop, `repo_map` (`on-prem-semantic.ts`).
 *
 * One configuration, here, because the shared index is created once per root for the
 * whole process: whichever caller asks first fixes its options, so every on-prem caller
 * must ask through this module or a later one silently gets the earlier one's settings.
 *
 * Definitions are read by tree-sitter where a grammar loads (the regex extractor for the
 * rest). The wasm ships in the published package at `dist/tree-sitter/`
 * (`scripts/copy-tree-sitter-wasm.ts`); a source checkout without a build resolves it
 * from agent-tools' own `web-tree-sitter` / `tree-sitter-wasms`.
 */

import fs from "node:fs";
import { join, resolve } from "node:path";
import { symbolSnapshotLocation } from "@builderforce/agent-tools/node-index-layout";
import {
  sharedSymbolIndex,
  treeSitterSymbolExtractor,
  type SymbolExtractor,
  type WorkspaceSymbolIndex,
} from "@builderforce/agent-tools/node-symbols";
import { nodeWatchPort } from "@builderforce/agent-tools/node-watch-port";
import { resolveBuilderForceAgentsPackageRootSync } from "../infra/builderforce-root.js";
import { onPremRootId } from "./knowledge/index/onPremRootId.js";
import { TREE_SITTER_DIST_DIR } from "./tree-sitter-dist.js";

/**
 * The shipped wasm directory, when this install has one (`dist/tree-sitter/tree-sitter.wasm`
 * under the package root). Undefined ⇒ the extractor resolves the wasm from its packages.
 */
export function onPremTreeSitterDir(opts: { moduleUrl?: string; argv1?: string; cwd?: string } = {}): string | undefined {
  try {
    const root = resolveBuilderForceAgentsPackageRootSync({
      moduleUrl: opts.moduleUrl ?? import.meta.url,
      argv1: opts.argv1 ?? process.argv[1],
      cwd: opts.cwd ?? process.cwd(),
    });
    if (!root) return undefined;
    const dir = join(root, "dist", TREE_SITTER_DIST_DIR);
    return fs.existsSync(join(dir, "tree-sitter.wasm")) ? dir : undefined;
  } catch {
    return undefined;
  }
}

let extractor: SymbolExtractor | undefined;

/** Tree-sitter where a grammar loads, the line-regex extractor everywhere else. */
function onPremExtractor(): SymbolExtractor {
  if (!extractor) {
    const wasmDir = onPremTreeSitterDir();
    extractor = treeSitterSymbolExtractor(wasmDir ? { wasmDir } : {});
  }
  return extractor;
}

/** Roots whose index already follows the change feed (one subscription per root, for the process). */
const followed = new Map<string, () => void>();

/** The process-wide definition index for the working tree at `root`. Persisted in the shared
 *  local index layout (`.builderforce/index/<stem>.symbols.json`, named by the knowledge root id),
 *  and fed by the one process-wide Node change feed the gateway's code index rides too. */
export function onPremSymbolIndex(root: string): WorkspaceSymbolIndex {
  const abs = resolve(root);
  const index = sharedSymbolIndex(abs, {
    ...symbolSnapshotLocation(abs, onPremRootId(abs)),
    extractor: onPremExtractor(),
  });
  if (!followed.has(abs)) {
    try {
      // When the host drops the subscription (its watcher died for good), forget it so a later call re-subscribes.
      followed.set(abs, index.follow(nodeWatchPort(), () => { followed.delete(abs); }));
    } catch {
      // Remembered as not-following so a root that cannot be watched is not retried on every call.
      followed.set(abs, () => undefined);
      // A filesystem without recursive watch keeps the stat-walk backstop and write-time markDirty.
    }
  }
  return index;
}

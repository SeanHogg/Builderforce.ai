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
import {
  sharedSymbolIndex,
  treeSitterSymbolExtractor,
  type SymbolExtractor,
  type WorkspaceSymbolIndex,
} from "@builderforce/agent-tools/node-symbols.js";
import { IGNORED_DIRS } from "../builderforce/shared-tools/node-code-tools.js";
import { resolveBuilderForceAgentsPackageRootSync } from "../infra/builderforce-root.js";
import { TREE_SITTER_DIST_DIR } from "./tree-sitter-dist.js";

/** Directories the index never walks — the SAME ignore set the on-prem searcher uses. */
const ON_PREM_INDEX_SKIP_DIRS: ReadonlySet<string> = new Set(IGNORED_DIRS);

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

/** The process-wide definition index for the working tree at `root`. Persisted beside the
 *  on-prem search index. */
export function onPremSymbolIndex(root: string): WorkspaceSymbolIndex {
  const abs = resolve(root);
  return sharedSymbolIndex(abs, {
    skipDirs: ON_PREM_INDEX_SKIP_DIRS,
    cachePath: join(abs, ".builderForceAgents", "symbols.json"),
    extractor: onPremExtractor(),
  });
}

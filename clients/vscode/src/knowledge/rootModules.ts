/**
 * A root's path aliases and module listing (`ModuleResolution`) for the extract paths that run outside a review — the
 * live stale-marking watcher and the run delta — read through agent-tools' ONE helper (`rootModuleResolution`) and kept
 * per root until an alias config (`tsconfig.json` / `jsconfig.json`) under it is created, changed or deleted
 * ({@link noteAliasConfigChanged}, fed by the knowledge folder watcher). The listing walks names only (no file is
 * hashed); a file created later is seen by the next load.
 */

import {
  createFsDirectorySource, NO_MODULE_ALIASES, rootModuleResolution, type ModuleResolution,
} from "@builderforce/agent-tools/knowledge";
import { vscodeKnowledgeFs } from "./knowledgeFs";
import { onAliasConfigChanged } from "./aliasConfigEvents";

const held = new Map<string, { rootPath: string; modules: Promise<ModuleResolution> }>();

/** The root's {@link ModuleResolution}, loaded once and reused until one of its alias configs changes. */
export function rootModules(root: { rootId: string; rootPath: string; title: string }): Promise<ModuleResolution> {
  const hit = held.get(root.rootId);
  if (hit) return hit.modules;
  // Names only: `skipHashAbove: 0` lists every file without reading it (the configs are read on their own).
  const source = createFsDirectorySource({ fs: vscodeKnowledgeFs(), rootPath: root.rootPath, rootId: root.rootId, title: root.title, skipHashAbove: 0 });
  const modules = rootModuleResolution(source).catch((): ModuleResolution => ({ aliases: NO_MODULE_ALIASES }));
  held.set(root.rootId, { rootPath: root.rootPath, modules });
  return modules;
}

onAliasConfigChanged((path) => {
  for (const [rootId, h] of held) if (path === h.rootPath || path.startsWith(`${h.rootPath}/`)) held.delete(rootId);
});

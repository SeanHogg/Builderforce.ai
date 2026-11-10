/**
 * "An alias config changed": the knowledge folder watcher (`knowledgeFs`) reports a `tsconfig.json` / `jsconfig.json`
 * created, changed or deleted, and the caches of a root's path aliases (`rootModules`, the symbols answer's
 * `ModuleAliasCache`) forget the roots above it. No vscode import: the caches stay testable.
 */

const listeners = new Set<(path: string) => void>();

/** Whether an absolute path names an alias config. */
export function isAliasConfigFile(path: string): boolean {
  return /(?:^|[\\/])(?:tsconfig|jsconfig)\.json$/i.test(path);
}

/** Tells every cache that the alias config at `path` (absolute) changed. */
export function noteAliasConfigChanged(path: string): void {
  const p = path.replace(/\\/g, "/");
  for (const l of listeners) {
    try { l(p); } catch { /* a cache that cannot forget keeps its entry until its own check */ }
  }
}

/** Hears every alias config change (absolute, `/`-separated); returns the unsubscribe. */
export function onAliasConfigChanged(cb: (path: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

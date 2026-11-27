/**
 * `WatchPort` — THE change feed of a workspace root (platform duplication audit §2.5.6).
 * A host fills it once (VS Code from its `FileSystemWatcher`, Node from `fs.watch` —
 * `node-watch-port.ts`), and every index over the root consumes it: the definition index
 * marks the reported files dirty, the code index drops its warm snapshot. Pure: no host API.
 */

export interface WatchPort {
  /**
   * Call `onChange` with the absolute paths that changed under `root`, until the returned
   * function is called. Paths are under the `root` the caller passed (re-based when the host
   * watches the root through a link). A change that cannot be named is reported as `root`
   * itself — the subscriber must treat that as "anything may have changed". Throws when the
   * host cannot watch `root` — a caller then falls back to its own staleness check.
   * `onLost` is called when the host drops this subscription (its watcher died and could not be
   * re-created): the caller then re-subscribes on its next use.
   */
  subscribe(root: string, onChange: (absPaths: string[]) => void, onLost?: () => void): () => void;
}

/** Whether `abs` is inside `<root>/.builderforce/` — the indexes' own generated files, whose writes are never a source change. */
export function isIndexStatePath(root: string, abs: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const prefix = `${norm(root)}/.builderforce`;
  const target = norm(abs);
  const fold = (s: string): string => (/^[a-z]:/i.test(s) ? s.toLowerCase() : s);
  const [head, path] = [fold(prefix), fold(target)];
  return path === head || path.startsWith(`${head}/`);
}

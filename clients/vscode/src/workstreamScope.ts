/**
 * Write SCOPES for workstreams that run side by side in one working tree.
 *
 * Children that run concurrently share the user's checkout. Two of them editing the same
 * file would each read, change and write it back, and the second write would silently
 * discard the first. So a writable fan-out gives every workstream the paths it OWNS,
 * refuses to start when two workstreams' paths overlap, and refuses any write a child
 * aims outside its own. Reads stay unrestricted: understanding the code is not a conflict.
 *
 * A scope entry is a workspace-relative file or directory. `src/auth` owns
 * `src/auth/login.ts` and everything else beneath it, never `src/authz.ts`. Pure.
 */

/** Workspace-relative, forward slashes, no leading `./` and no trailing slash. */
export function normalizeScopePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

/** Whether `path` falls inside one of `scope`'s entries. */
export function inScope(path: string, scope: readonly string[]): boolean {
  const p = normalizeScopePath(path);
  return scope.some((entry) => {
    const s = normalizeScopePath(entry);
    return s === "" || p === s || p.startsWith(`${s}/`);
  });
}

/**
 * The first pair of workstreams whose scopes overlap, or null when every pair is
 * disjoint. Two entries overlap when one is the other or lies beneath it.
 */
export function overlappingScopes(
  scopes: ReadonlyArray<{ label: string; paths: readonly string[] }>,
): { a: string; b: string; path: string } | null {
  for (let i = 0; i < scopes.length; i++) {
    for (let j = i + 1; j < scopes.length; j++) {
      for (const path of scopes[i]!.paths) {
        if (inScope(path, scopes[j]!.paths) || scopes[j]!.paths.some((q) => inScope(q, [path]))) {
          return { a: scopes[i]!.label, b: scopes[j]!.label, path: normalizeScopePath(path) };
        }
      }
    }
  }
  return null;
}

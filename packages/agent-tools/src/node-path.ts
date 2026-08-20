/**
 * `@builderforce/agent-tools/node-path` — the ONE workspace-containment path resolver
 * shared by the two on-prem capability providers (`agent-runtime`'s
 * `node-capability-provider.ts` and the VS Code extension's `localCapabilities.ts`).
 *
 * ## Why this is a SEPARATE subpath, not part of the package index
 *
 * The package root (`@builderforce/agent-tools`) is imported by the Cloudflare Worker and
 * must stay node-builtin-free. This module imports `node:path` — deliberately, because a
 * pure-string reimplementation cannot get Windows drive-absolute (`C:\…`), UNC (`\\srv\…`)
 * and mixed-separator paths right, which is exactly the class of bug a hand-rolled escape
 * check ships. So it lives behind its own export condition: only Node surfaces import it,
 * the Worker bundle never reaches it, and there is still exactly ONE implementation of the
 * "resolve a relative path under a root, reject any escape" rule across the codebase.
 *
 * Two entry points because the two call sites report failure differently and both are
 * correct for their contract: a capability provider that returns a typed
 * `{ ok: false, error }` result wants {@link resolveInsideRoot} (`null` on escape), a tool
 * handler whose framework converts a throw into a tool error wants
 * {@link resolveInsideRootOrThrow}. The CONTAINMENT DECISION is shared; only the reporting
 * style differs.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";

/** Thrown by {@link resolveInsideRootOrThrow} when a path leaves the workspace root. */
export class PathEscapesRootError extends Error {
  constructor(readonly requestedPath: string) {
    super(`path escapes the workspace: ${requestedPath}`);
    this.name = "PathEscapesRootError";
  }
}

/**
 * Resolve `relPath` inside `root`, rejecting an escape (a path that resolves outside the
 * root, whether by `..` traversal or by being absolute elsewhere).
 *
 * Returns the absolute path, or `null` when the path leaves the root. The root itself
 * resolves to the root (a valid "list scope" target).
 *
 * An ABSOLUTE `relPath` is resolved on its own rather than joined to the root — on POSIX
 * `resolve(root, "/etc/passwd")` already yields `/etc/passwd`, so the two are equivalent;
 * spelling it out keeps the intent legible. Either way the containment check below is what
 * rejects it.
 */
export function resolveInsideRoot(root: string, relPath: string): string | null {
  const rootResolved = resolve(root);
  const abs = isAbsolute(relPath) ? resolve(relPath) : resolve(rootResolved, relPath);
  const rel = relative(rootResolved, abs);
  if (rel === "" || rel === ".") {
    return abs; // the root itself
  }
  // `relative()` returns an absolute path when the two live on different Windows drives
  // (or different UNC shares), which is an escape even though it starts with no "..".
  if (rel.startsWith("..") || rel.split(sep).includes("..") || isAbsolute(rel)) {
    return null;
  }
  return abs;
}

/** True when `relPath` resolves inside `root` (the boolean form of {@link resolveInsideRoot}). */
export function isInsideRoot(root: string, relPath: string): boolean {
  return resolveInsideRoot(root, relPath) !== null;
}

/**
 * {@link resolveInsideRoot}, but throwing instead of returning `null` — for call sites
 * whose framework turns a throw into the tool error. Also validates that a path was
 * supplied at all, since these call sites receive unvalidated model-supplied arguments.
 *
 * @throws {PathEscapesRootError} when the path leaves the root.
 */
export function resolveInsideRootOrThrow(root: string, relPath: unknown): string {
  if (typeof relPath !== "string") {
    throw new Error("a 'path' string is required");
  }
  const abs = resolveInsideRoot(root, relPath);
  if (abs === null) {
    throw new PathEscapesRootError(relPath);
  }
  return abs;
}

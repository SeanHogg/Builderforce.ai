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

import { statSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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
  if (rel.split(sep).includes("..") || isAbsolute(rel)) {
    return null;
  }
  return abs;
}

/** True when `relPath` resolves inside `root` (the boolean form of {@link resolveInsideRoot}). */
export function isInsideRoot(root: string, relPath: string): boolean {
  return resolveInsideRoot(root, relPath) !== null;
}

/**
 * True when `target` (resolved against the process cwd when relative) is `root` or lies under it — the plain
 * "is X inside Y" check for two paths the caller already holds. Lexical only: see {@link resolveInsideRootReal}
 * when the target may pass through a link. (`..foo` is a name, not a traversal; Windows case differences are
 * `path.relative`'s to settle.)
 */
export function isPathInside(root: string, target: string): boolean {
  return isInsideRoot(root, resolve(target));
}

export interface RealResolveOptions {
  /** A target that does not exist is refused (default: accepted, so `write_file` can create a new file). */
  mustExist?: boolean;
  /** The root itself is a valid target (default true; a caller that wants a FILE under the root passes false). */
  allowRoot?: boolean;
}

const isMissing = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

/** True when `p` is itself a symbolic link / junction (false when it does not exist). */
async function isLink(p: string): Promise<boolean> {
  try {
    return (await lstat(p)).isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/**
 * The real path of `abs`, or of its nearest EXISTING ancestor with the missing tail re-appended (so a file that
 * does not exist yet still resolves through the real directory it will be created in). `null` when a missing
 * component is a dangling link — its destination is unknown, so it cannot be vouched for.
 */
async function realOfNearest(abs: string): Promise<{ real: string; exists: boolean } | null> {
  const tail: string[] = [];
  let current = abs;
  for (;;) {
    try {
      const real = await realpath(current);
      return { real: tail.length ? join(real, ...tail.reverse()) : real, exists: tail.length === 0 };
    } catch (error) {
      if (!isMissing(error)) throw error;
      if (await isLink(current)) return null;
      const parent = dirname(current);
      if (parent === current) return { real: join(current, ...tail.reverse()), exists: false };
      tail.push(basename(current));
      current = parent;
    }
  }
}

/**
 * {@link resolveInsideRoot} that ALSO follows links: the lexical check first, then the REAL path of the target
 * (links resolved; for a target that does not exist yet, of its nearest existing ancestor) must sit inside the
 * REAL path of the root — so a link or junction inside the workspace that points outside it is refused, which no
 * lexical check can see. Returns the lexical absolute path (the one callers show and compare), `null` when refused.
 *
 * A root that does not exist has nothing in it to link out of, so the lexical answer stands. Any other
 * filesystem error (permissions, I/O) propagates: "could not tell" is never answered "inside".
 */
export async function resolveInsideRootReal(root: string, relPath: string, opts: RealResolveOptions = {}): Promise<string | null> {
  const abs = resolveInsideRoot(root, relPath);
  if (abs === null) return null;
  const rootResolved = resolve(root);
  if (opts.allowRoot === false && abs === rootResolved) return null;
  let realRoot: string;
  try {
    realRoot = await realpath(rootResolved);
  } catch (error) {
    if (isMissing(error)) return opts.mustExist ? null : abs;
    throw error;
  }
  const target = await realOfNearest(abs);
  if (target === null) return null;
  if (opts.mustExist && !target.exists) return null;
  if (opts.allowRoot === false && target.real === realRoot) return null;
  return resolveInsideRoot(realRoot, target.real) === null ? null : abs;
}

/** {@link resolveInsideRootReal}, throwing {@link PathEscapesRootError} (and the "a 'path' string is required" error) like {@link resolveInsideRootOrThrow}. */
export async function resolveInsideRootRealOrThrow(root: string, relPath: unknown, opts: RealResolveOptions = {}): Promise<string> {
  if (typeof relPath !== "string") {
    throw new Error("a 'path' string is required");
  }
  const outcome = await tryResolveInsideRootReal(root, relPath, opts);
  if (outcome.ok) return outcome.abs;
  throw outcome.reason === "escapes" ? new PathEscapesRootError(relPath) : new PathUnverifiableError(relPath, outcome.cause);
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

/**
 * The directory a SHELL command runs in: `relative` (the tool's workspace-relative `cwd`, already
 * validated) under `root`, or `root` itself when none is named. A path that leaves the root, or
 * that is not a directory, is refused with the reason — the working directory is the host's to
 * honour, so the host is also the one that keeps it inside the workspace. ONE rule for every
 * node shell (the on-prem host's, the prefetch exec shell, the editor's).
 */
export function resolveShellCwd(root: string, relative?: string): { ok: true; dir: string } | { ok: false; error: string } {
  if (!relative || relative === ".") return { ok: true, dir: resolve(root) };
  const dir = resolveInsideRoot(root, relative);
  if (dir === null) return { ok: false, error: `'${relative}' is outside the workspace, so no command was run there` };
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return { ok: false, error: `the directory '${relative}' does not exist in the workspace` };
  }
  return { ok: true, dir };
}

/** Outcome of {@link tryResolveInsideRootReal}: a typed result instead of a throw. */
export type RealResolveOutcome =
  | { ok: true; abs: string }
  | { ok: false; reason: "escapes"; error: string }
  | { ok: false; reason: "unverifiable"; error: string; cause: unknown };

/** A root-relative, host-path-free sentence for a path whose containment could not be checked. */
function unverifiableMessage(relPath: string, cause: unknown): string {
  const code = (cause as NodeJS.ErrnoException | undefined)?.code;
  return `'${relPath}' could not be verified inside the workspace${code ? ` (${code})` : ""}`;
}

/**
 * {@link resolveInsideRootReal} for the providers that return `{ ok: false, error }` instead of throwing: an
 * escape is `reason: "escapes"`, and a filesystem error (permissions, I/O) is `reason: "unverifiable"` whose
 * `error` names only the root-relative path and the errno code — never the host's absolute path — with the
 * original error in `cause` for the caller's report sink. "Could not tell" is still never answered "inside".
 */
export async function tryResolveInsideRootReal(root: string, relPath: string, opts: RealResolveOptions = {}): Promise<RealResolveOutcome> {
  try {
    const abs = await resolveInsideRootReal(root, relPath, opts);
    return abs === null
      ? { ok: false, reason: "escapes", error: `'${relPath}' is outside the workspace` }
      : { ok: true, abs };
  } catch (cause) {
    return { ok: false, reason: "unverifiable", error: unverifiableMessage(relPath, cause), cause };
  }
}

/** Thrown by {@link resolveInsideRootRealOrThrow} when containment could not be verified; the message carries no host path. */
export class PathUnverifiableError extends Error {
  constructor(readonly requestedPath: string, readonly cause: unknown) {
    super(unverifiableMessage(requestedPath, cause));
    this.name = "PathUnverifiableError";
  }
}

import { reportCaughtError } from '../observability/caughtErrorReporter';
import { isR2SameObjectRateLimit, retryTransient } from '../../infrastructure/shared/retryTransient';
/**
 * workspaceStore — THE canonical access layer for a project's IDE workspace in R2.
 *
 * "Read files from a directory, update them, save them" was previously inline
 * `bucket.get/put/delete` calls scattered through route handlers, with no path
 * validation, no missing-vs-empty distinction, and no server-side content
 * contract — which is how a workspace could silently end up with 0-byte files
 * and cross-wired content (package.json's JSON in vite.config.js, JS source in
 * index.html) that only surfaced when Vite crashed at Run. This module owns the
 * whole contract in one tested place:
 *
 *   • Keys: `ide/projects/{projectId}/{path}` — path VALIDATED (no `..`, no
 *     absolute/backslash paths, no control chars, no empty segments) so a
 *     malformed path can neither escape the prefix nor create garbage keys.
 *   • Reads distinguish MISSING (null) from EMPTY ('') — callers must not treat
 *     "we never wrote this" as "the file is blank".
 *   • Writes enforce the same structural content contract the frontend guard
 *     enforces ({@link validateWorkspaceContent}): a `.json` file must be JSON,
 *     a JS/TS file must not be a JSON object/array or an HTML document, an
 *     `.html` file must start with markup. The client already guards; the server
 *     enforcing it too means NO caller (agent, script, direct API use) can
 *     persist cross-wired content again.
 *
 * `contentGuardParity.test.ts` pins this validator to the frontend's
 * `fileContentGuard` over a shared vector set, since the two runtimes cannot
 * share a module (see the template-parity note in projectTemplate.ts).
 */
import { IDE_PREFIX } from '../project/projectTemplate';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export type PathValidation = { ok: true } | { ok: false; reason: string };

/** Longest path we accept — far above anything legitimate, below R2's key cap. */
const MAX_PATH_LENGTH = 512;

/**
 * Validate a workspace-relative file path. Rejects anything that could escape
 * the project prefix, collide with another key space, or produce a key that can
 * never round-trip: empty, absolute (`/x`), backslashes, `.`/`..` segments,
 * empty segments (`a//b`), trailing slash (that's a "directory", not a file),
 * control characters, and overlong paths.
 */
export function validateWorkspacePath(path: string): PathValidation {
  if (typeof path !== 'string' || path.length === 0) return { ok: false, reason: 'Path is required' };
  if (path.length > MAX_PATH_LENGTH) return { ok: false, reason: `Path exceeds ${MAX_PATH_LENGTH} characters` };
  if (path.startsWith('/')) return { ok: false, reason: 'Path must be workspace-relative (no leading /)' };
  if (path.endsWith('/')) return { ok: false, reason: 'Path must name a file, not a directory' };
  if (path.includes('\\')) return { ok: false, reason: 'Use forward slashes in paths' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(path)) return { ok: false, reason: 'Path contains control characters' };
  for (const segment of path.split('/')) {
    if (segment === '') return { ok: false, reason: 'Path contains an empty segment' };
    if (segment === '.' || segment === '..') return { ok: false, reason: 'Path traversal segments (./..) are not allowed' };
  }
  return { ok: true };
}

/** The R2 key prefix for a project's workspace. Trailing slash is load-bearing:
 *  it is what keeps project 1's listing from matching project 12's keys. */
export function workspacePrefix(projectId: number): string {
  return `${IDE_PREFIX}projects/${projectId}/`;
}

/** The full R2 key for a validated workspace path. Throws on an invalid path so
 *  a bad key can never be constructed by accident — validate first at the edge. */
export function workspaceKey(projectId: number, path: string): string {
  const valid = validateWorkspacePath(path);
  if (!valid.ok) throw new Error(`Invalid workspace path: ${valid.reason}`);
  return workspacePrefix(projectId) + path;
}

// ---------------------------------------------------------------------------
// Content contract (server-side twin of frontend/src/lib/fileContentGuard.ts)
// ---------------------------------------------------------------------------

export type ContentValidation = { ok: true } | { ok: false; reason: string };

/** JS/TS source extensions that must never contain raw JSON data or an HTML doc. */
const JS_TS_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']);

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Structural content contract for a workspace file. Only unambiguous,
 * machine-checkable rules — no fuzzy language heuristics (false-positive risk):
 *   - `.json`/`.jsonl` must parse as JSON (per line for jsonl);
 *   - `.html`/`.htm` must begin with markup (`<`);
 *   - JS/TS source must be neither a top-level JSON object/array nor an HTML
 *     document — real source never satisfies either, so this only ever rejects
 *     another file's content written to the wrong path.
 * Empty/whitespace-only content is allowed (blank file creation).
 */
export function validateWorkspaceContent(path: string, content: string): ContentValidation {
  const trimmed = content.trim();
  if (trimmed === '') return { ok: true };
  const ext = extensionOf(path);

  if (ext === 'json') {
    try {
      JSON.parse(content);
    } catch (e) {
      return { ok: false, reason: `${path} must be valid JSON (${(e as Error).message})` };
    }
  }

  if (ext === 'jsonl' || ext === 'ndjson') {
    const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    for (let i = 0; i < lines.length; i++) {
      try {
        JSON.parse(lines[i] as string);
      } catch {
        return { ok: false, reason: `${path} must be JSON-per-line — line ${i + 1} is not valid JSON` };
      }
    }
  }

  if (ext === 'html' || ext === 'htm') {
    if (trimmed[0] !== '<') {
      return { ok: false, reason: `${path} must be HTML markup (starting with '<')` };
    }
  }

  if (JS_TS_EXTS.has(ext)) {
    if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
      return { ok: false, reason: `${path} is an HTML document, not ${ext.toUpperCase()} source` };
    }
    try {
      const parsed = JSON.parse(content);
      if (parsed !== null && typeof parsed === 'object') {
        return { ok: false, reason: `${path} looks like JSON data, not ${ext.toUpperCase()} source` };
      }
    } catch (error) {
      /* not JSON → real source → fine */
    
      reportCaughtError(error, { source: "application/ide/workspaceStore.ts", operation: "validateWorkspaceContent" });
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

export interface WorkspaceEntry {
  path: string;
  size: number;
}

export type WriteResult =
  | { ok: true }
  | { ok: false; status: 400 | 422; reason: string };

/** List every file in the project's workspace (path + size). */
export async function listWorkspaceFiles(bucket: R2Bucket, projectId: number): Promise<WorkspaceEntry[]> {
  const prefix = workspacePrefix(projectId);
  const listed = await bucket.list({ prefix });
  return (listed.objects ?? []).map((o) => ({ path: o.key.slice(prefix.length), size: o.size }));
}

/**
 * Read one file. Returns `null` when the object does not exist — distinct from
 * `''` (a real empty file). Invalid paths read as missing rather than throwing:
 * a GET can't corrupt anything, and 404 is the honest answer for a key that can
 * never exist.
 */
export async function readWorkspaceFile(bucket: R2Bucket, projectId: number, path: string): Promise<string | null> {
  if (!validateWorkspacePath(path).ok) return null;
  const obj = await bucket.get(workspacePrefix(projectId) + path);
  if (!obj) return null;
  return obj.text();
}

/**
 * Read one file as BYTES, for a caller that has to move it somewhere else
 * unchanged — publishing the workspace as a static site, chiefly.
 *
 * Separate from {@link readWorkspaceFile} rather than replacing it: text is what
 * every editing path wants, and decoding an image to a string to re-encode it on
 * the way out corrupts it silently. Returns the R2 body stream rather than a
 * buffer so a large asset never has to be resident.
 */
export async function readWorkspaceObject(
  bucket: R2Bucket,
  projectId: number,
  path: string,
): Promise<{ body: ReadableStream; size: number } | null> {
  if (!validateWorkspacePath(path).ok) return null;
  const obj = await bucket.get(workspacePrefix(projectId) + path);
  if (!obj) return null;
  return { body: obj.body, size: obj.size };
}

/**
 * An editor autosaving while an agent writes the same file trips R2's
 * same-object rate limit routinely. Retried via the shared transient-retry
 * helper; every other failure still propagates on the first attempt.
 */
const withSameObjectRetry = <T>(operation: () => Promise<T>): Promise<T> =>
  retryTransient(operation, isR2SameObjectRateLimit);

/**
 * Write one file, enforcing the path AND content contracts. This is the single
 * chokepoint for user/agent workspace writes — the route delegates here, so no
 * caller can persist a traversal path or cross-wired content.
 */
export async function writeWorkspaceFile(
  bucket: R2Bucket,
  projectId: number,
  path: string,
  content: string,
): Promise<WriteResult> {
  const validPath = validateWorkspacePath(path);
  if (!validPath.ok) return { ok: false, status: 400, reason: validPath.reason };
  const validContent = validateWorkspaceContent(path, content);
  if (!validContent.ok) return { ok: false, status: 422, reason: validContent.reason };
  // Keep the version this write is about to destroy. Done HERE, at the single
  // chokepoint, so every writer is covered by construction — the editor, the
  // canvas build tools, an agent, the scaffold self-heal — rather than each one
  // remembering to snapshot.
  await captureWorkspaceVersion(bucket, projectId, path);
  await withSameObjectRetry(() => bucket.put(workspacePrefix(projectId) + path, content));
  return { ok: true };
}

/**
 * ── FILE HISTORY ────────────────────────────────────────────────────────────
 *
 * An autonomous agent editing a working app WILL eventually break it, and until
 * now there was nothing to go back to: `writeWorkspaceFile` overwrote in place
 * and the previous content was gone. Every competing prompt-to-app product treats
 * one-click revert as mandatory for exactly this reason.
 *
 * ── THE KEY SHAPE, AND WHY TIMESTAMP-FIRST ──────────────────────────────────
 * `ide/history/projects/<id>/<epochMs>/<path>`.
 *
 * The obvious alternative — path first, then timestamp — makes listing ONE
 * file's versions a clean prefix scan and is wrong: workspace paths nest, so
 * `…/src/App.jsx/<ts>` and `…/src/App.jsx.bak/<ts>` are fine but `…/src/<ts>`
 * and `…/src/App.jsx/<ts>` are not distinguishable from a listing of `…/src/`.
 * Timestamp-first has no such collision because a timestamp segment can never be
 * a path segment. Listing a single file's versions is then a filter over a set
 * that is bounded anyway by {@link MAX_HISTORY_VERSIONS}.
 */
const HISTORY_ROOT = 'ide/history/projects/';

/** Versions kept per project. Older ones are pruned on the next write. */
export const MAX_HISTORY_VERSIONS = 100;

function historyPrefix(projectId: number): string {
  return `${HISTORY_ROOT}${projectId}/`;
}

export interface WorkspaceVersion {
  /** Workspace-relative path this version is of. */
  path: string;
  /** Epoch ms the version was superseded — i.e. when it stopped being current. */
  at: number;
  size: number;
}

/** Split a history key back into its `{ at, path }`. Null when it is malformed. */
function parseHistoryKey(key: string, prefix: string): WorkspaceVersion | null {
  const rest = key.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const at = Number(rest.slice(0, slash));
  const path = rest.slice(slash + 1);
  if (!Number.isFinite(at) || !path) return null;
  return { path, at, size: 0 };
}

/**
 * Copy the CURRENT content of `path` into history, then prune.
 *
 * A no-op when the file does not exist yet — creating a file destroys nothing, so
 * there is nothing to keep, and recording an empty "before" would make the undo
 * list claim a version that never existed.
 */
export async function captureWorkspaceVersion(bucket: R2Bucket, projectId: number, path: string): Promise<void> {
  // BEST-EFFORT, deliberately. Archiving is a safety net for the save; it must
  // never become a reason the save itself fails. A user whose edit is rejected
  // because its undo copy could not be written has lost the very work the undo
  // existed to protect.
  try {
    const existing = await bucket.get(workspacePrefix(projectId) + path);
    if (!existing) return;
    // The BODY, not the text: history has to round-trip an image or a font as
    // faithfully as it does a source file, and decoding bytes to a string to
    // re-encode them is how a binary asset gets silently corrupted.
    await withSameObjectRetry(() => bucket.put(`${historyPrefix(projectId)}${Date.now()}/${path}`, existing.body));
    await pruneWorkspaceHistory(bucket, projectId);
  } catch (error) {
    reportCaughtError(error, { source: 'application/ide/workspaceStore.ts', operation: 'captureWorkspaceVersion' });
  }
}

/** Drop the oldest versions beyond {@link MAX_HISTORY_VERSIONS}. */
async function pruneWorkspaceHistory(bucket: R2Bucket, projectId: number): Promise<void> {
  const prefix = historyPrefix(projectId);
  const listed = await bucket.list({ prefix });
  const objects = listed.objects ?? [];
  if (objects.length <= MAX_HISTORY_VERSIONS) return;
  // R2 lists lexicographically, and epoch-ms keys of equal width sort
  // chronologically — but a clock that crosses a digit boundary would break that,
  // so sort on the parsed value rather than trusting key order.
  const withTime = objects
    .map((object) => ({ key: object.key, at: parseHistoryKey(object.key, prefix)?.at ?? 0 }))
    .sort((a, b) => a.at - b.at);
  for (const stale of withTime.slice(0, withTime.length - MAX_HISTORY_VERSIONS)) {
    await bucket.delete(stale.key);
  }
}

/**
 * Versions available to restore, newest first. `path` narrows to one file; omit it
 * for the whole project (which is what "undo what that prompt did" reads).
 */
export async function listWorkspaceHistory(
  bucket: R2Bucket,
  projectId: number,
  path?: string,
): Promise<WorkspaceVersion[]> {
  const prefix = historyPrefix(projectId);
  const listed = await bucket.list({ prefix });
  return (listed.objects ?? [])
    .flatMap((object) => {
      const parsed = parseHistoryKey(object.key, prefix);
      if (!parsed) return [];
      if (path && parsed.path !== path) return [];
      return [{ ...parsed, size: object.size }];
    })
    .sort((a, b) => b.at - a.at);
}

/** Read one archived version's content, or null when it is not there. */
export async function readWorkspaceVersion(
  bucket: R2Bucket,
  projectId: number,
  path: string,
  at: number,
): Promise<string | null> {
  if (!validateWorkspacePath(path).ok) return null;
  const object = await bucket.get(`${historyPrefix(projectId)}${at}/${path}`);
  return object ? object.text() : null;
}

/**
 * Restore an archived version as the current file.
 *
 * Goes back through {@link writeWorkspaceFile}, which means the restore itself is
 * captured into history first — so undoing a restore is the same action again,
 * and a mistaken revert is not a one-way door.
 */
export async function restoreWorkspaceVersion(
  bucket: R2Bucket,
  projectId: number,
  path: string,
  at: number,
): Promise<WriteResult> {
  const content = await readWorkspaceVersion(bucket, projectId, path, at);
  if (content == null) return { ok: false, status: 400, reason: 'That version is no longer available.' };
  return writeWorkspaceFile(bucket, projectId, path, content);
}

/**
 * Write one BINARY file — an icon, a rendered asset, anything that is not text.
 *
 * Separate from {@link writeWorkspaceFile} because the content contract that
 * function enforces is a TEXT contract: "a .json must parse", "an .html must
 * start with `<`". Those checks are meaningless against a PNG and would reject
 * every real one. The path contract is identical and still enforced here, so this
 * is a narrower validator rather than an escape hatch — and it exists precisely
 * so that generating a binary asset does not become a reason to call `bucket.put`
 * directly and bypass path validation altogether.
 *
 * A caller with text should use {@link writeWorkspaceFile}; there is no reason to
 * reach for this one and lose the content checks.
 */
export async function writeWorkspaceBinary(
  bucket: R2Bucket,
  projectId: number,
  path: string,
  bytes: Uint8Array,
  contentType?: string,
): Promise<WriteResult> {
  const validPath = validateWorkspacePath(path);
  if (!validPath.ok) return { ok: false, status: 400, reason: validPath.reason };
  await withSameObjectRetry(() =>
    bucket.put(workspacePrefix(projectId) + path, bytes as unknown as ArrayBuffer, {
      ...(contentType ? { httpMetadata: { contentType } } : {}),
    }),
  );
  return { ok: true };
}

/** Delete one file. Invalid paths are a no-op (the key can't exist). */
export async function deleteWorkspaceFile(bucket: R2Bucket, projectId: number, path: string): Promise<void> {
  if (!validateWorkspacePath(path).ok) return;
  await withSameObjectRetry(() => bucket.delete(workspacePrefix(projectId) + path));
}

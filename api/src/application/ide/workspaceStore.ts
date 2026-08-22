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
 *     enforces ({@link validateFileContentForPath}): a `.json` file must be JSON,
 *     a JS/TS file must not be a JSON object/array or an HTML document, an
 *     `.html` file must start with markup. The client already guards; the server
 *     enforcing it too means NO caller (agent, script, direct API use) can
 *     persist cross-wired content again.
 *
 * The content contract itself is `@builderforce/ide-file-contract` — one module
 * the Worker and the browser both import, so the client cannot learn a rule the
 * server has not (it used to be a hand-kept copy on each side).
 */
import {
  validateFileContentForPath,
  type FileContentValidation,
} from '@builderforce/ide-file-contract';
import { isScaffoldPath } from '@builderforce/ide-templates';
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
// Content contract
// ---------------------------------------------------------------------------

/**
 * The structural content contract lives in `@builderforce/ide-file-contract` —
 * ONE module the Worker and the browser both import, so the client cannot check
 * a rule the server does not enforce (or vice versa). It used to be a hand-kept
 * copy per runtime pinned by a vector-parity test.
 *
 * The validation RESULT shape keeps a workspace-local alias because the
 * path-and-size rule below returns it too.
 */
export type ContentValidation = FileContentValidation;

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

export interface WorkspaceEntry {
  path: string;
  size: number;
}

/**
 * The ZERO-BYTE SCAFFOLD rule, enforced on top of the content contract.
 *
 * {@link validateFileContentForPath} deliberately allows an empty body — creating a
 * blank file is legitimate. It is NOT legitimate at a path a starter scaffold
 * owns. A Mobile project was found with all five scaffold paths present in R2 at
 * size 0; the writer was never identified, and neither the creation seed nor the
 * file-list self-heal repaired them because both treat "present" as "seeded"
 * unless it is also empty at the moment they happen to look.
 *
 * So instead of naming the writer, the invariant is closed at the one place every
 * writer passes — the editor's mount-time onChange, file-create, an agent tool, a
 * canvas build tool, a script hitting `PUT /files/*` directly. Emptying a
 * scaffold file is refused with 422; deleting it is still allowed (the seed
 * re-creates it), and writing real content is untouched.
 *
 * Kept out of `@builderforce/ide-file-contract` because that module is a pure
 * CONTENT-FORMAT contract keyed on the extension; this is a path+size rule that
 * depends on which paths a starter scaffold owns.
 */
export function validateScaffoldNotEmptied(path: string, isEmpty: boolean): ContentValidation {
  if (!isEmpty || !isScaffoldPath(path)) return { ok: true };
  return {
    ok: false,
    reason: `${path} is a starter-scaffold file and cannot be written empty — delete it instead, or write its real content`,
  };
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
  const validContent = validateFileContentForPath(path, content);
  if (!validContent.ok) return { ok: false, status: 422, reason: validContent.reason };
  const scaffoldOk = validateScaffoldNotEmptied(path, content.trim() === '');
  if (!scaffoldOk.ok) return { ok: false, status: 422, reason: scaffoldOk.reason };
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
 * The stamp an archived version is filed under, which only ever moves FORWARD.
 *
 * The key is `<epochMs>/<path>`, so two archives of the same file inside ONE
 * millisecond produce the same key and the second `put` silently overwrites the
 * first — a version vanishes from the undo chain exactly when edits come fastest,
 * which is the autonomous-agent case this history exists for. `Date.now()` has
 * millisecond resolution; an agent rewriting a file does not have millisecond
 * pauses. Save-then-immediately-revert loses its "before" the same way.
 *
 * So: the wall clock, except when the clock has not advanced since the last
 * archive, in which case one tick past it. `at` still reads as "when this version
 * was superseded", nudged forward only far enough to stay distinct; the ORDERING
 * it is actually used for (prune oldest, list newest-first) becomes exact, and the
 * drift is bounded by how many archives share a millisecond.
 *
 * Per-isolate, deliberately: two isolates archiving the same path in the same
 * millisecond is the concurrent-write race {@link withSameObjectRetry} already
 * governs, and a coordinated counter would cost a round-trip on every save.
 */
let lastArchiveAt = 0;
function nextArchiveStamp(): number {
  lastArchiveAt = Math.max(Date.now(), lastArchiveAt + 1);
  return lastArchiveAt;
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
    await withSameObjectRetry(() => bucket.put(`${historyPrefix(projectId)}${nextArchiveStamp()}/${path}`, existing.body));
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
  // Same zero-byte scaffold rule as the text path — a 0-length upload at
  // `package.json` is the exact state that broke Run, whatever content-type it
  // arrived under.
  const scaffoldOk = validateScaffoldNotEmptied(path, bytes.length === 0);
  if (!scaffoldOk.ok) return { ok: false, status: 422, reason: scaffoldOk.reason };
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

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
    } catch {
      /* not JSON → real source → fine */
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
  await bucket.put(workspacePrefix(projectId) + path, content);
  return { ok: true };
}

/** Delete one file. Invalid paths are a no-op (the key can't exist). */
export async function deleteWorkspaceFile(bucket: R2Bucket, projectId: number, path: string): Promise<void> {
  if (!validateWorkspacePath(path).ok) return;
  await bucket.delete(workspacePrefix(projectId) + path);
}

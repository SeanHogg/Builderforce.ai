/**
 * What every browser `DirectorySource` shares (PRD 38 §4.7): root ids, content hashing,
 * and — from agent-tools, the same as the editor's and on-prem's walker — the skip list,
 * path normalising and the document shape memory reads. The adapters (the web's VFS and
 * Cloud Drive, a folder upload, a File System Access folder) differ only in where bytes
 * come from.
 *
 * The listing hash is the CONTENT hash (SHA-256 of the UTF-8 text) wherever the content is
 * local, so the extracted cache on the API (`PUT …/knowledge/extracted/:hash`) is shared
 * across hosts. A file the plan skips anyway (binary by extension, over the size cap) is
 * not read for it; its hash is taken from its metadata instead.
 */

import { DEFAULT_MAX_FILE_BYTES, isBinaryPath, sha256Hex } from '@seanhogg/builderforce-memory/knowledge';
import { rootIdFor } from '@builderforce/agent-tools/knowledge';

export { isSkippedPath, normalizePath, textDocument } from '@builderforce/agent-tools/knowledge';

/**
 * `<host>:<kind>:<…parts>` — a reviewed root's id (`knowledge_scopes.root_id`), by THE
 * root-id rule (`rootIdFor`): the host prefix (`web`, `rovr`) says who can re-read it; the
 * browser's folder id is the kind (how) and its parts.
 */
export function hostRootId(host: string, kind: string, ...parts: Array<string | number>): string {
  return rootIdFor({ host, folderId: [kind, ...parts.map(String)].join(':') });
}

/** The kind segment of a root id (`upload`, `folder`, `vfs`, `drive`), or undefined. */
export function rootKindOf(rootId: string): string | undefined {
  return rootId.split(':')[1];
}

/** Whether the file's CONTENT is worth reading for its hash (the plan would include it). */
export function hashesByContent(path: string, size: number): boolean {
  return !isBinaryPath(path) && size <= DEFAULT_MAX_FILE_BYTES;
}

export function contentHash(text: string): string {
  return sha256Hex(text);
}

/**
 * The same content hash through the platform's SubtleCrypto (off the JS thread for large
 * files). Equal to {@link contentHash} for the same text — both hash its UTF-8 bytes — so
 * a host may use either and still share the extracted cache.
 */
export async function subtleContentHash(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return contentHash(text);
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function metadataHash(...parts: Array<string | number | undefined>): string {
  return sha256Hex(parts.map((p) => String(p ?? '')).join('\u0000'));
}

/** UTF-8 byte length (the size cap is in bytes). */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Sorted by path, so every listing is deterministic. */
export function byPath<T>(entries: Iterable<[string, T]>): Array<[string, T]> {
  return [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A knowledge path that degrades instead of failing (no drive listing, no IndexedDB, a
 * live refresh that missed) still says so — once, through the HOST's reporter (the web's
 * Quality feed, Rovr's error reports) — and the caller carries on with its stated fallback.
 */
export type KnowledgeDegradedReporter = (what: string, error: unknown, context?: Record<string, unknown>) => void;

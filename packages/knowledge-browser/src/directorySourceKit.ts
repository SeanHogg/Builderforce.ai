/**
 * What every browser `DirectorySource` shares (PRD 38 §4.7): root ids, content hashing,
 * and — from agent-tools, the same as the editor's and on-prem's walker — the skip list,
 * path normalising and the document shape memory reads. The adapters (the web's VFS and
 * Cloud Drive, a folder upload, a File System Access folder) differ only in where bytes
 * come from.
 *
 * The listing hash is the CONTENT hash (memory's EOL-normalized `contentHash` of the bytes) wherever the content is
 * local, so the extracted bodies the pack carries (`…/knowledge/sync`, keyed by hash) are
 * shared across hosts. A file the plan skips anyway (binary by extension, over the size cap) is
 * not read for it; its hash is taken from its metadata instead.
 */

import { contentHash, DEFAULT_MAX_FILE_BYTES, isBinaryPath, isDocumentPath, sha256Hex, type DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import { rootIdFor } from '@builderforce/agent-tools/knowledge';

/**
 * A `DirectorySource` that DECLARES its `list()` hashes are {@link textContentHash} of the text `read()` returns (upload, File System
 * Access and the in-memory VFS; never a Cloud Drive's metadata hash). A byte-readable one lists a pdf/office file (`hashesByBytes`)
 * by {@link bytesHash} of its bytes instead, which the review's `withDocumentText` re-checks with the same function. `hashOf` alone proves nothing about what `list()` hashed,
 * so the review worker trusts only this declared kind.
 */
export type ContentHashedSource = DirectorySource & { readonly hashKind: 'content' };

/**
 * A page source that can hand out a file's RAW BYTES. Text extraction of a pdf/office file is NOT done by the source: the review
 * worker reads the bytes through the proxy (`READ_BYTES`) and runs `withDocumentText` itself, off the UI thread. A review that
 * runs in-thread (no Worker) wraps the source once, in `runReview`. So no page source applies `withDocumentText`.
 */
export type ByteReadableSource = DirectorySource & {
  /**
   * The file's raw bytes, in a buffer the CALLER owns: a fresh `Uint8Array` over its own `ArrayBuffer` (never a view into a
   * cache or a shared buffer). `reviewWorkerClient` transfers that buffer to the worker, which detaches it on the page.
   */
  readBytes(path: string, signal?: AbortSignal): Promise<Uint8Array>;
};

export const isByteReadable = (source: DirectorySource): source is ByteReadableSource =>
  typeof (source as { readBytes?: unknown }).readBytes === 'function';

/** Whether `source` declares content hashes (and can re-hash the text it read). */
export const isContentHashed = (source: DirectorySource): boolean =>
  (source as { hashKind?: unknown }).hashKind === 'content' && typeof source.hashOf === 'function';

export { isSkippedPath, normalizePath, textDocument, withDocumentText } from '@builderforce/agent-tools/knowledge';

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

const utf8 = new TextEncoder();

/** Memory's ONE content hash (`contentHash`, EOL-normalized, PRD 41 §B2) of a text's UTF-8 bytes: what a content-hashed source lists a text file with and its `hashOf` re-checks with. */
export function textContentHash(text: string): string {
  return contentHash(utf8.encode(text));
}

/**
 * A pdf/office file's listing hash is over its BYTES (its text is extracted by the review, and the "changed since plan" check
 * re-hashes the bytes it read with {@link bytesHash} — `withDocumentText`'s `hashBytes`). Only a document the plan would read.
 */
export function hashesByBytes(path: string, size: number): boolean {
  return isDocumentPath(path) && size <= DEFAULT_MAX_FILE_BYTES;
}

/** Memory's `contentHash` of a file's bytes: THE byte hash a content-hashed source lists documents with and `withDocumentText` re-checks with. */
export function bytesHash(bytes: Uint8Array): string {
  return contentHash(bytes);
}

/** SHA-256 through the platform's SubtleCrypto as lowercase hex, or undefined where there is none. */
async function subtleSha256Hex(bytes: Uint8Array): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  const digest = await subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Bytes holding no CR hash identically raw and under memory's EOL rule, so SubtleCrypto may hash them; any other is memory's `contentHash`. */
const CR = 0x0d;

/**
 * The same content hash through the platform's SubtleCrypto (off the JS thread for large
 * files). Equal to {@link textContentHash} for the same text, so a host may use either and
 * still share the extracted cache. Text holding a CR is hashed by memory itself (no copy of its EOL rule here).
 */
export async function subtleContentHash(text: string): Promise<string> {
  return subtleBytesHash(utf8.encode(text));
}

/**
 * {@link bytesHash} through SubtleCrypto, for a page-side `list()`: a pure-JS SHA-256 of a large pdf/office file blocks the
 * page thread (~100 ms per 2 MB). Equal to `bytesHash` for the same bytes, so the review worker's sync re-check
 * (`hashOf` must be sync) still matches the listing hash.
 */
export async function subtleBytesHash(bytes: Uint8Array): Promise<string> {
  return (bytes.indexOf(CR) < 0 ? await subtleSha256Hex(bytes) : undefined) ?? bytesHash(bytes);
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

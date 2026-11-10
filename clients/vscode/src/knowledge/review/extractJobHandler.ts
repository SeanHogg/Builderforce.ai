/**
 * What an extraction does with one job (PRD 41 A8), in a worker thread or, when the pool is down, in
 * the extension host: memory's pure `extractJob` over the SAME pack list the host's review composes
 * (`reviewPacks`, agent-tools — code before docs). ONE code path, so a pooled and an in-thread review
 * extract the same bytes.
 *
 * Packs are not serializable, so the worker builds its own. The one thing a job cannot carry on its own
 * is the host's warm symbol index, so the main thread puts a hit in the job as plain data
 * (`HostExtractJob.symbols`). ONE symbol rule on both paths: an index HIT uses the index's symbols, a MISS
 * uses the pack's regex extractor. (A tree-sitter miss path cannot exist in-thread: the pack's
 * `symbolsOf` is synchronous and tree-sitter loads asynchronously.) `sectionsOnly` jobs read no symbols.
 */

import { readFile } from "node:fs/promises";
import * as nodePath from "node:path";
import type { CodeSymbol } from "@builderforce/agent-tools";
import { documentDoc, reviewPacks } from "@builderforce/agent-tools/knowledge";
import { DEFAULT_MAX_FILE_BYTES, ExtractFailed, extractJob, isBinaryText, isDocumentPath, reasonOf, type ExtractJob, type ExtractJobResult } from "@seanhogg/builderforce-memory/knowledge";
import { nodeContentHash } from "../nodeSha256";

/** PRD 41 A10 rule 2: a worker's read of its file gives up after 5 s (a `timeout` failure, never a stalled run). */
export const READ_TIMEOUT_MS = 5_000;
/** A pdf/office file reads and parses slower: its read gets 60 s, as the source's `readTimeoutMs` does (memory adds that to the pool deadline). */
export const DOCUMENT_READ_TIMEOUT_MS = 60_000;

/**
 * A job that makes the WORKER read the file (PRD 41 A10 rule 8): `rootPath` + `path` name it and `hash` is the
 * planned hash, VERIFIED against the bytes read (a mismatch throws "changed since plan"). A job that is `readByPool` (memory) has no `doc` at all.
 */
export interface ReadFrom { rootPath: string; path: string; hash: string }

/** Memory's job plus the index's definitions of the file, when the index holds it, plus an optional read-in-the-worker. */
export type HostExtractJob = ExtractJob & { symbols?: readonly CodeSymbol[]; readFrom?: ReadFrom };

/** What a host job returns: memory's result; `binary` ⇒ the file is binary text and nothing was extracted (the step is `skipped: binary`). */
export type HostExtractResult = ExtractJobResult & { binary?: true };

/** The file of a `readFrom` job as a document (hashed and decoded from the SAME bytes). Throws `timeout`, `too large`, `changed since plan`, or the read's own error; a path outside the root is refused. */
async function readDocument(job: HostExtractJob, from: ReadFrom, timeoutMs: number, signal?: AbortSignal) {
  const root = nodePath.resolve(from.rootPath);
  const abs = nodePath.resolve(root, from.path);
  if (abs !== root && !abs.startsWith(root + nodePath.sep)) throw new Error("path outside the review root");
  let bytes: Uint8Array;
  try {
    const deadline = AbortSignal.timeout(isDocumentPath(from.path) ? Math.max(timeoutMs, DOCUMENT_READ_TIMEOUT_MS) : timeoutMs);
    bytes = await readFile(abs, { signal: signal ? AbortSignal.any([deadline, signal]) : deadline });
  } catch (error) {
    const name = (error as { name?: string } | undefined)?.name;
    throw name === "TimeoutError" || name === "AbortError" ? new Error("timeout") : error;
  }
  if (bytes.byteLength > DEFAULT_MAX_FILE_BYTES) throw new Error("too large");
  // Hash FIRST, with the listing's ONE content hash (memory's EOL-normalized `contentHash`, as `createFsDirectorySource` lists):
  // a stale plan must not store an extract under the wrong hash.
  if (nodeContentHash(bytes) !== from.hash) throw new Error("changed since plan");
  // The shared bytes → document rule (agent-tools `documentDoc`): a pdf/office file is the text of its content, anything else UTF-8.
  // `from.path` is the spelling read from disk; the document is the file's identity, `job.path`.
  return documentDoc(job.rootId, job.path, bytes, signal);
}

export async function handleExtractJob(job: HostExtractJob, readTimeoutMs: number = READ_TIMEOUT_MS, signal?: AbortSignal): Promise<HostExtractResult> {
  const symbols = job.sectionsOnly ? undefined : job.symbols;
  let ready: ExtractJob = job;
  if (job.readFrom) {
    const doc = await readDocument(job, job.readFrom, readTimeoutMs, signal);
    if (doc.content.kind === "text" && isBinaryText(doc.content.text)) return { extracted: [], binary: true };
    // The job's source becomes the document the worker read, at the planned hash.
    const { readByPool: _unread, doc: _stale, ...base } = job;
    ready = { ...base, doc, hash: job.readFrom.hash } as ExtractJob;
  }
  // Host setup (the packs, the symbol lookup) and a malformed job fail as plain errors: they say nothing about the file, so they are transient.
  const packs = reviewPacks(symbols ? { symbolsOf: () => symbols } : {});
  if (!ready.doc) throw new Error(`extract job for ${ready.path} carries no document (readByPool needs a reading worker)`);
  // The read above fails TRANSIENTLY too (a lock, a timeout, a changed file). Only a throw from the parser or extractor itself is the PROVEN-final
  // failure: it is marked, so the review records a terminal answer instead of retrying forever.
  try {
    return extractJob(ready, packs);
  } catch (error) {
    throw new ExtractFailed(reasonOf(error), { cause: error });
  }
}

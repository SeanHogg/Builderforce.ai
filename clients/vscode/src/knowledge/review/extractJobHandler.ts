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
import { existsSync } from "node:fs";
import { cappedFileFacts, documentDoc, moduleFileCandidates, reviewPacks, type ModuleAliases, type ModuleResolution } from "@builderforce/agent-tools/knowledge";
import { extractFileFacts, FILE_FACTS_REVISION, hasFileFacts } from "@builderforce/agent-tools/node-file-facts";
import { treeSitterLanguageOf } from "@builderforce/agent-tools/node-tree-sitter";
import { DEFAULT_MAX_FILE_BYTES, ExtractFailed, extractJob, isBinaryText, isDocumentPath, reasonOf, type ExtractJob, type ExtractJobResult, type FileFacts } from "@seanhogg/builderforce-memory/knowledge";
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

/**
 * Memory's job plus the index's definitions of the file, when the index holds it, plus an optional read-in-the-worker.
 * `factsOnly` (PRD 41 §B3): the job wants the file's raw FileFacts v3 and nothing else — the background indexer's and the
 * run delta's facts ride the SAME pool and worker as the review's extraction: `readFrom` reads the file from disk,
 * `factsText` carries a side's text instead; `wasmDir` is where the worker loads grammars.
 */
export type HostExtractJob = ExtractJob & {
  symbols?: readonly CodeSymbol[]; readFrom?: ReadFrom; aliases?: ModuleAliases; factsOnly?: true; factsText?: string; wasmDir?: string;
};

/** Module paths found (or not) on a root's disk, per root: a worker answers `exists` for many jobs of one review. */
const diskModules = new Map<string, Map<string, boolean>>();
const MAX_DISK_MODULES = 20_000;

/**
 * The root's aliases (the job's, read once per review by the runner) with module existence answered from the root's
 * disk: the worker sees the files the review lists. Without a root on disk, the first alias target is taken.
 */
function jobModules(job: HostExtractJob): ModuleResolution | undefined {
  if (!job.aliases) return undefined;
  const root = job.readFrom ? nodePath.resolve(job.readFrom.rootPath) : undefined;
  if (!root) return { aliases: job.aliases };
  let known = diskModules.get(root);
  if (!known) diskModules.set(root, (known = new Map()));
  if (known.size > MAX_DISK_MODULES) known.clear();
  return {
    aliases: job.aliases,
    exists: (modulePath) => {
      let hit = known!.get(modulePath);
      if (hit === undefined) {
        hit = moduleFileCandidates(modulePath).some((p) => {
          const abs = nodePath.resolve(root, p);
          return abs.startsWith(root + nodePath.sep) && existsSync(abs);
        });
        known!.set(modulePath, hit);
      }
      return hit;
    },
  };
}

/**
 * What a host job returns: memory's result; `binary` ⇒ the file is binary text and nothing was extracted (the step is `skipped: binary`).
 * A `factsOnly` job answers `fileFacts` (absent when the file has no fact grammar) with `extracted: []`.
 */
export type HostExtractResult = ExtractJobResult & { binary?: true; fileFacts?: FileFacts };

/**
 * A `factsOnly` job: the file's RAW FileFacts (imports as specifiers: the host resolves them against its listing, never the
 * worker against a disk). Only a path with a fact grammar is read; its RAW bytes (never a pdf/office text extraction) at
 * the job's hash — verified, then handed on with that hash so nothing is hashed twice. `factsText` (a run delta's side text,
 * not on disk) is extracted as is. A file past the cap is CAPPED (present, empty), never a failure retried forever.
 */
async function factsJob(job: HostExtractJob, readTimeoutMs: number, signal?: AbortSignal): Promise<HostExtractResult> {
  if (!hasFileFacts(job.path)) return { extracted: [] };
  const opts = { contentHash: job.hash, ...(job.wasmDir ? { wasmDir: job.wasmDir } : {}) };
  let bytes: Uint8Array;
  if (job.factsText !== undefined) bytes = new TextEncoder().encode(job.factsText);
  else if (job.readFrom) {
    bytes = await readBytes(job.readFrom, readTimeoutMs, signal);
    if (nodeContentHash(bytes) !== job.readFrom.hash) throw new Error("changed since plan");
    if (bytes.byteLength > DEFAULT_MAX_FILE_BYTES) return { extracted: [], fileFacts: cappedFileFacts(treeSitterLanguageOf(job.path)!, job.readFrom.hash, FILE_FACTS_REVISION) };
  } else throw new Error(`facts job for ${job.path} carries no readFrom and no text`);
  // `facts_grammar_unavailable` stays a plain (transient) error: the host leaves the file un-applied and retries it.
  const fileFacts = await extractFileFacts(job.path, bytes, opts);
  return { extracted: [], ...(fileFacts ? { fileFacts } : {}) };
}

/** A `readFrom` file's raw bytes. Throws `timeout` or the read's own error; a path outside the root is refused. */
async function readBytes(from: ReadFrom, timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array> {
  const root = nodePath.resolve(from.rootPath);
  const abs = nodePath.resolve(root, from.path);
  if (abs !== root && !abs.startsWith(root + nodePath.sep)) throw new Error("path outside the review root");
  try {
    const deadline = AbortSignal.timeout(isDocumentPath(from.path) ? Math.max(timeoutMs, DOCUMENT_READ_TIMEOUT_MS) : timeoutMs);
    return await readFile(abs, { signal: signal ? AbortSignal.any([deadline, signal]) : deadline });
  } catch (error) {
    const name = (error as { name?: string } | undefined)?.name;
    throw name === "TimeoutError" || name === "AbortError" ? new Error("timeout") : error;
  }
}

/** The file of a `readFrom` job as a document (hashed and decoded from the SAME bytes). Throws `timeout`, `too large`, `changed since plan`, or the read's own error; a path outside the root is refused. */
async function readDocument(job: HostExtractJob, from: ReadFrom, timeoutMs: number, signal?: AbortSignal) {
  const bytes = await readBytes(from, timeoutMs, signal);
  if (bytes.byteLength > DEFAULT_MAX_FILE_BYTES) throw new Error("too large");
  // Hash FIRST, with the listing's ONE content hash (memory's EOL-normalized `contentHash`, as `createFsDirectorySource` lists):
  // a stale plan must not store an extract under the wrong hash.
  if (nodeContentHash(bytes) !== from.hash) throw new Error("changed since plan");
  // The shared bytes → document rule (agent-tools `documentDoc`): a pdf/office file is the text of its content, anything else UTF-8.
  // `from.path` is the spelling read from disk; the document is the file's identity, `job.path`.
  return documentDoc(job.rootId, job.path, bytes, signal);
}

export async function handleExtractJob(job: HostExtractJob, readTimeoutMs: number = READ_TIMEOUT_MS, signal?: AbortSignal): Promise<HostExtractResult> {
  if (job.factsOnly) return factsJob(job, readTimeoutMs, signal);
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
  const modules = jobModules(job);
  const packs = reviewPacks({ ...(symbols ? { symbolsOf: () => symbols } : {}), ...(modules ? { modules } : {}) });
  if (!ready.doc) throw new Error(`extract job for ${ready.path} carries no document (readByPool needs a reading worker)`);
  // The read above fails TRANSIENTLY too (a lock, a timeout, a changed file). Only a throw from the parser or extractor itself is the PROVEN-final
  // failure: it is marked, so the review records a terminal answer instead of retrying forever.
  try {
    return extractJob(ready, packs);
  } catch (error) {
    throw new ExtractFailed(reasonOf(error), { cause: error });
  }
}

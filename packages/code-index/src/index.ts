import { watch, type FSWatcher } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { extname } from "node:path";
import type { RepoReadCapability, SemanticSearchResult } from "@builderforce/agent-tools";
import { toPosixPath } from "@builderforce/agent-tools/glob";
import { gitIgnoredMatcher } from "@builderforce/agent-tools/node-git-ignore";
import { resolveInsideRoot, resolveInsideRootReal, toPosixRel } from "@builderforce/agent-tools/node-path";
import { treeSitterSymbolExtractor } from "@builderforce/agent-tools/node-tree-sitter";
import { DEFAULT_REPO_MAP_LIMITS, isMapCandidate } from "@builderforce/repo-map";
import {
  createKnowledgeIndex,
  loadKnowledgeIndex,
  sha256Hex,
  type EmbedderPort,
  type IndexDoc,
} from "@seanhogg/builderforce-memory/knowledge";
import { codeChunks, type CodeChunk } from "./chunk.js";
import { codeIndexStorage, type CodeFileRecord, type StoredCodeIndex } from "./storage.js";

export type { EmbedderPort } from "@seanhogg/builderforce-memory/knowledge";
export { workspaceCodeEmbedder } from "./embedder.js";

interface SearchInput {
  root: string;
  files: RepoReadCapability;
  query: string;
  scope?: string;
  extension?: string;
  limit: number;
  rebuild?: boolean;
  lexicalOnly?: boolean;
  wasmDir?: string;
  embedder?: EmbedderPort;
  waitForIndexMs?: number;
}

const MAX_SNIPPET_CHARS = 4_000;
const MAX_WARM_ROOTS = 4;
const WATCH_REFRESH_MS = 60_000;
const limits = DEFAULT_REPO_MAP_LIMITS;
const workspaceBudget = { ...limits, maxChunks: 20_000 };
export const codeIndexBenchmarkBudget = { ...limits, maxFiles: 25_000, maxTotalBytes: 192 * 1024 ** 2, maxChunks: 200_000 };
const parsers = new Map<string | undefined, ReturnType<typeof treeSitterSymbolExtractor>>();
const pending = new Map<string, Promise<CodeSnapshot | undefined | null>>();
const warm = new Map<string, WarmCodeSnapshot>();

interface CodeSnapshot {
  snapshot: StoredCodeIndex;
  active?: ReturnType<typeof loadKnowledgeIndex>;
}

interface WarmCodeSnapshot extends CodeSnapshot {
  watcher: FSWatcher;
  deadline: number;
  binding: string;
}

const chunkId = (record: CodeFileRecord, chunk: CodeChunk): string =>
  JSON.stringify([record.path, record.hash, chunk.startLine, chunk.endLine, chunk.symbol ?? ""]);
const snippetOf = (lines: readonly string[], chunk: CodeChunk): string =>
  lines.slice(chunk.startLine - 1, chunk.endLine).join("\n");
const embedderId = (embedder: EmbedderPort | undefined): string =>
  embedder ? JSON.stringify([embedder.fingerprint, embedder.dims]) : "";

function parser(wasmDir: string | undefined) {
  let current = parsers.get(wasmDir);
  if (!current) {
    current = treeSitterSymbolExtractor({ ...(wasmDir ? { wasmDir } : {}) });
    parsers.set(wasmDir, current);
  }
  return current;
}

async function sourceFile(root: string, path: string) {
  // The caller has already canonicalized the root. Comparing the target's real
  // relative path to the listed path rejects symlinks without re-resolving the root.
  const resolved = resolveInsideRoot(root, path);
  if (!resolved || toPosixRel(root, await realpath(resolved)) !== path) return undefined;
  const stats = await lstat(resolved);
  if (!stats.isFile() || !isMapCandidate(path, stats.size)) return undefined;
  return {
    size: stats.size,
    stamp: JSON.stringify([stats.size, stats.mtimeMs, stats.ctimeMs, stats.ino]),
    async text() {
      const bytes = await readFile(resolved);
      if (bytes.length > limits.maxFileBytes || bytes.includes(0)) return undefined;
      return bytes.toString("utf-8");
    },
  };
}

function chunkDocs(record: CodeFileRecord, lines: readonly string[]): IndexDoc[] {
  return record.chunks.map((chunk) => ({
    id: chunkId(record, chunk),
    text: `${record.path}\n${chunk.symbol ?? ""}\n${snippetOf(lines, chunk)}`,
    keys: [record.path, record.path.split("/").at(-1)!, ...(chunk.symbol ? [chunk.symbol] : [])],
  }));
}

function load(snapshot: StoredCodeIndex | undefined, embedder: EmbedderPort | undefined) {
  if (!snapshot) return undefined;
  try {
    const index = loadKnowledgeIndex(snapshot.index, embedder);
    return snapshot.records.every((record) => record.chunks.every((chunk) => index.has(chunkId(record, chunk))))
      ? index
      : undefined;
  } catch {
    return undefined;
  }
}

async function refresh(input: Omit<SearchInput, "query" | "limit">, root: string, old?: StoredCodeIndex, budget = workspaceBudget) {
  const fingerprint = embedderId(input.embedder);
  const stored = load(old, undefined);
  const index = stored ?? createKnowledgeIndex();
  const before = new Map((stored ? old!.records : []).map((record) => [record.path, record]));

  const lexicalScope = input.scope ? await resolveInsideRootReal(root, input.scope, { mustExist: true }) : undefined;
  if (input.scope && !lexicalScope) throw new Error("Search path is unavailable in the workspace");
  const scope = lexicalScope ? await realpath(lexicalScope) : undefined;
  const selected = scope ? relativePath(root, scope) : undefined;
  const fileScope = scope ? (await lstat(scope)).isFile() : false;
  const listing = fileScope
    ? { ok: true, paths: [selected!] }
    : await input.files.listFiles(selected, "**/*", { unbounded: true });
  if (!listing.ok) throw new Error("Workspace files could not be listed");

  const ignored = await gitIgnoredMatcher(root);
  const extension = input.extension?.replace(/^\./, "").toLowerCase();
  const paths = [...new Set((listing.paths ?? []).map((path) => path.replace(/\\/g, "/")))]
    .filter((path) => (!selected || path === selected || path.startsWith(`${selected}/`))
      && (!extension || extname(path).slice(1).toLowerCase() === extension)
      && isMapCandidate(path, 0) && !ignored(path)).sort();
  const records: CodeFileRecord[] = [];
  const newDocs: IndexDoc[] = [];
  let bytes = 0;
  let chunkCount = 0;
  let partial = "truncated" in listing && listing.truncated === true || paths.length > budget.maxFiles;
  let changed = !stored;
  for (const path of paths.slice(0, budget.maxFiles)) {
    const source = await sourceFile(root, path).catch(() => undefined);
    if (!source) { partial = true; continue; }
    if (bytes + source.size > budget.maxTotalBytes) { partial = true; break; }
    bytes += source.size;
    const previous = before.get(path);
    let record = previous;
    let lines: string[] | undefined;
    if (!record || record.stamp !== source.stamp) {
      const content = await source.text().catch(() => undefined);
      if (content === undefined) { partial = true; continue; }
      const hash = sha256Hex(content);
      if (previous?.hash === hash) {
        record = { ...previous, stamp: source.stamp };
      } else {
        lines = content.split(/\r?\n/);
        const chunks = codeChunks(lines, await parser(input.wasmDir).extractSpans(path, content));
        record = { path, stamp: source.stamp, hash, chunks };
      }
    }
    if (chunkCount + record.chunks.length > budget.maxChunks) { partial = true; break; }
    chunkCount += record.chunks.length;
    if (lines) {
      if (previous) index.remove(previous.chunks.map((chunk) => chunkId(previous, chunk)));
      newDocs.push(...chunkDocs(record, lines));
    }
    changed ||= record !== previous;
    before.delete(path);
    records.push(record);
  }
  for (const record of before.values()) index.remove(record.chunks.map((chunk) => chunkId(record, chunk)));
  changed ||= before.size > 0;
  // Upsert lexically first. A cold/unreachable embedding provider never prevents
  // a usable lexical snapshot from being written.
  await index.upsert(newDocs);
  let active = index;
  let bound = changed ? "" : (old?.fingerprint ?? "");
  if (input.embedder && (changed || fingerprint !== bound)) {
    try {
      const dense = loadKnowledgeIndex(index.serialize(), input.embedder);
      await dense.compact();
      active = dense;
      bound = fingerprint;
      changed = true;
    } catch {
      active = loadKnowledgeIndex(index.serialize());
    }
  }
  const snapshot = changed || partial !== old?.partial
    ? { records, fingerprint: bound, index: active.serialize(), partial }
    : old!;
  return { snapshot, active };
}

async function sharedSnapshot(input: SearchInput, root: string) {
  const storage = await codeIndexStorage(root).catch(() => undefined);
  if (!storage) return undefined;
  const lock = await storage.lock();
  if (!lock) {
    const previous = await storage.read();
    return previous ? { snapshot: { ...previous, partial: true }, fresh: false } : null;
  }
  try {
    const previous = await storage.read();
    const { snapshot } = await refresh(input, root, input.rebuild ? undefined : previous);
    const stillOwner = () => lock.isFresh?.() ?? true;
    if (snapshot !== previous) await storage.write(snapshot, stillOwner);
    return { snapshot, fresh: stillOwner() };
  } finally {
    await lock.release();
  }
}

function evictWarm(root: string) {
  warm.get(root)?.watcher.close();
  warm.delete(root);
}

async function readSharedIndex(input: SearchInput, root: string): Promise<CodeSnapshot | undefined | null> {
  const existing = warm.get(root);
  const binding = embedderId(input.embedder);
  if (!input.rebuild && existing && existing.deadline > Date.now() && existing.binding === binding) {
    warm.delete(root);
    warm.set(root, existing);
    return existing;
  }
  if (existing) evictWarm(root);
  const building = pending.get(root);
  if (building) return building.then((result) => result && { snapshot: result.snapshot });

  let invalidated = false;
  let watcher: FSWatcher | undefined;
  const invalidate = () => {
    invalidated = true;
    if (warm.get(root)?.watcher === watcher) evictWarm(root);
  };
  try {
    watcher = watch(root, { recursive: true, persistent: false }, (_event, file) => {
      // The root index and its lock are generated under a directory the scanner skips.
      if (!file || !/^\.builderforce(?:[\\/]|$)/i.test(file)) invalidate();
    });
    watcher.on("error", invalidate);
  } catch {
    // Filesystems without recursive watch can still use the shared on-disk snapshot.
  }

  const build = (async () => {
    try {
      const result = await sharedSnapshot(input, root);
      if (!result) return result;
      const { snapshot } = result;
      const active = load(snapshot, snapshot.fingerprint === binding ? input.embedder : undefined);
      if (watcher && result.fresh && active && !invalidated) {
        warm.set(root, { snapshot, active, watcher, binding, deadline: Date.now() + WATCH_REFRESH_MS });
        if (warm.size > MAX_WARM_ROOTS) evictWarm(warm.keys().next().value!);
      }
      return { snapshot, ...(active ? { active } : {}) };
    } finally {
      pending.delete(root);
      if (watcher && warm.get(root)?.watcher !== watcher) watcher.close();
    }
  })();
  pending.set(root, build);
  return build;
}

async function sharedIndexForQuery(input: SearchInput, root: string) {
  const build = readSharedIndex(input, root);
  if (input.waitForIndexMs === undefined) return build;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, input.waitForIndexMs, null);
  });
  try {
    return await Promise.race([build, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Both Node hosts read the same root snapshot, with one writer across processes. */
export async function searchWorkspaceCodeIndex(input: SearchInput): Promise<SemanticSearchResult & { indexedFiles?: number }> {
  if (input.query.length > 10_000) throw new Error("The workspace search query exceeds 10000 characters");
  const root = await realpath(input.root);
  const stored = !input.scope && !input.extension ? await sharedIndexForQuery(input, root) : undefined;
  if (stored === null) return { ok: true, query: input.query, results: [], total: 0, indexing: true };
  // A scoped search builds its candidate set from the scope before ranking, so
  // global matches cannot crowd out an in-scope hit. It never replaces the root snapshot.
  return searchSnapshot(input, root, stored ?? await refresh(input, root));
}

/** Build a larger in-memory snapshot for matched-corpus comparisons. Never use the shared workspace cache. */
export async function benchmarkWorkspaceCodeIndex(input: Omit<SearchInput, "query" | "limit">) {
  const root = await realpath(input.root);
  const prepared = await refresh(input, root, undefined, codeIndexBenchmarkBudget);
  return {
    paths: prepared.snapshot.records.map((record) => record.path),
    chunks: prepared.snapshot.records.reduce((sum, record) => sum + record.chunks.length, 0),
    partial: prepared.snapshot.partial,
    search(query: string, limit: number) {
      return searchSnapshot({ ...input, query, limit }, root, prepared);
    },
  };
}

async function searchSnapshot(
  input: SearchInput, root: string, { snapshot, active: prepared }: CodeSnapshot,
): Promise<SemanticSearchResult & { indexedFiles?: number }> {
  const active = prepared ?? load(snapshot, snapshot.fingerprint === embedderId(input.embedder) ? input.embedder : undefined);
  if (!active) throw new Error("The workspace code index could not be read");
  const hits = await active.search(input.query, {
    k: input.limit,
    ...(input.lexicalOnly ? { tiers: ["exact", "lexical"] } : {}),
  }).catch(() =>
    active.search(input.query, { k: input.limit, tiers: ["exact", "lexical"] }),
  );
  const rows = new Map(snapshot.records.flatMap((record) =>
    record.chunks.map((chunk) => [chunkId(record, chunk), { record, chunk }] as const),
  ));
  const content = new Map<string, string[] | undefined>();
  const results = [];
  for (const hit of hits) {
    const row = rows.get(hit.id);
    if (!row) continue;
    const { record, chunk } = row;
    if (!content.has(record.path)) {
      const source = await sourceFile(root, record.path).catch(() => undefined);
      const text = await source?.text().catch(() => undefined);
      content.set(record.path, text !== undefined && sha256Hex(text) === record.hash ? text.split(/\r?\n/) : undefined);
    }
    const lines = content.get(record.path);
    if (lines) results.push({
      path: record.path,
      ...chunk,
      snippet: snippetOf(lines, chunk).slice(0, MAX_SNIPPET_CHARS),
      score: hit.score,
      source: hit.tier === "dense" ? "embedding" as const : "keyword" as const,
    });
  }
  return { ok: true, query: input.query, results, total: results.length, indexedFiles: snapshot.records.length,
    partial: snapshot.partial || results.length !== hits.length };
}

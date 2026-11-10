/**
 * The map's class and function levels, host side: the definitions in some files of a root.
 * The stored graph holds files only (symbols would multiply its size), so when the person goes
 * inside a package the view asks for the symbols of that package's top files.
 *
 * The request comes from the webview, so nothing in it is trusted:
 *   - the file list is validated and capped HERE (the host's cap is the only cap);
 *   - a ref is decoded with `sourcePathOf` (never URL-decoded) and must be a code file the symbol
 *     extractor understands BEFORE it is stat'ed or read, so `.env`, keys, markdown and sql never are;
 *   - the path must be safe and reach no link (`knowledgeFixPaths.ts`), and be a regular file under the size cap,
 *     read through a bounded read, so a FIFO, a directory or a growing file cannot hang or flood the host.
 * Definitions come from agent-tools' ONE symbol extractor, which names each member's container; each record carries
 * the symbol-level edges that start at it (`extractSymbolRelations`, resolved across the answer's files by {@link withRelations}),
 * so the view attaches extends/implements/composes/uses/calls per record as it loads a file (PRD 43 P0b). The file → file
 * rollup of the same edges is in the stored graph (agent-tools `codeRollup`), for the bands that load no symbol.
 *
 * Repeats are cheap: answers are cached per file (path, mtime, size), and {@link SymbolsGate} lets one call
 * per root run at a time and hands identical requests the answer already on its way.
 */

import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { extractSymbolRelations, extractSymbols, isSymbolIndexable, MAX_CALL_SITES_PER_EDGE, type CodeSymbol, type SymbolRelation } from "@builderforce/agent-tools";
import {
  aliasCandidates, isAliasSpecifier, isCodePath, ModuleAliasCache, moduleFileCandidates, NO_MODULE_ALIASES, PACKAGE_MODULE_DIR, resolveImportPath,
  sourcePathOf, type AliasConfigPorts, type ModuleAliases,
} from "@builderforce/agent-tools/knowledge";
import { UNTIMED, type LoadTimer } from "./knowledgeLoadTrace";
import { onAliasConfigChanged } from "./aliasConfigEvents";
import { assertInsideRoot } from "./knowledgeFixPaths";
import type { KnowledgeSymbolRecord, KnowledgeSymbolRelation } from "./knowledgeProtocol";
import { isSafeRelative } from "./safePath";

export const MAX_SYMBOL_FILES = 200;
export const MAX_SYMBOL_FILE_BYTES = 512 * 1024;
export const MAX_SYMBOL_TOTAL_BYTES = 8 * 1024 * 1024;
/** A ref longer than this is not a ref of ours. */
export const MAX_REF_LENGTH = 4096;
/** Files whose answers stay cached. */
export const SYMBOL_CACHE_FILES = 2000;

/** The disk, injected so the rules are tested without one. */
export interface SymbolFilePorts {
  guard(root: string, rel: string): Promise<void>;
  stat(path: string): Promise<{ size: number; isFile: boolean; mtimeMs: number }>;
  /** At most `maxBytes` of the file as text; null when the file is longer than that. */
  read(path: string, maxBytes: number): Promise<string | null>;
}

export const nodeSymbolPorts: SymbolFilePorts = {
  guard: assertInsideRoot,
  async stat(path) {
    const s = await stat(path);
    return { size: s.size, isFile: s.isFile(), mtimeMs: s.mtimeMs };
  },
  async read(path, maxBytes) {
    const handle = await open(path, "r");
    try {
      // One byte past the limit tells a file that grew since the stat from one that fits.
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
      return bytesRead > maxBytes ? null : buffer.toString("utf8", 0, bytesRead);
    } finally {
      await handle.close();
    }
  },
};

/** The file refs a request names, made safe to iterate: an array of distinct strings of sane length, at most {@link MAX_SYMBOL_FILES}. */
export function cleanFileRefs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const refs = (input.slice(0, MAX_SYMBOL_FILES * 2) as unknown[]).filter((r): r is string => typeof r === "string" && r.length > 0 && r.length <= MAX_REF_LENGTH);
  return [...new Set(refs)].slice(0, MAX_SYMBOL_FILES);
}

/** A least-recently-used cache of one file's answer, keyed by what makes it stale (path, mtime, size). */
export class SymbolCache<V = FileSymbols> {
  private readonly entries = new Map<string, V>();
  constructor(private readonly max: number = SYMBOL_CACHE_FILES) {}

  static key(rootPath: string, fileRef: string, mtimeMs: number, size: number): string {
    return `${rootPath}\0${fileRef}\0${mtimeMs}\0${size}`;
  }

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (hit) { this.entries.delete(key); this.entries.set(key, hit); }
    return hit;
  }

  set(key: string, records: V): void {
    this.entries.delete(key);
    this.entries.set(key, records);
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * A file's records. The extractor names each member's container; the member's parent is that container's
 * record in the same file (the nearest one at or above it), else the file. A ref is `#Container.name@line`,
 * unique even when two classes each have a `run`. Pure.
 */
export function recordsOfFile(fileRef: string, symbols: readonly CodeSymbol[]): KnowledgeSymbolRecord[] {
  const refOf = (s: CodeSymbol): string => `${fileRef}#${s.container ? `${s.container}.` : ""}${s.name}@${s.line}`;
  const containers = new Map<string, CodeSymbol[]>();
  for (const s of symbols) if (!s.container) (containers.get(s.name) ?? containers.set(s.name, []).get(s.name)!).push(s);
  return symbols.map((s) => {
    const owners = s.container ? containers.get(s.container) : undefined;
    const owner = owners ? [...owners].reverse().find((o) => o.line <= s.line) ?? owners[0] : undefined;
    return { ref: refOf(s), name: s.name, kind: s.kind, parent: owner ? refOf(owner) : fileRef, line: s.line, exported: s.exported };
  });
}

/** One file's answer before the cross-file step: its records and its definitions' relations (indexes into `records`). */
export interface FileSymbols { fileRef: string; path: string; records: KnowledgeSymbolRecord[]; relations: SymbolRelation[] }

export function fileSymbolsOf(fileRef: string, path: string, text: string): FileSymbols {
  const symbols = extractSymbols(path, text);
  return { fileRef, path, records: recordsOfFile(fileRef, symbols), relations: extractSymbolRelations(path, text, symbols) };
}

/** Distinct module paths one answer probes on disk for a file it did not load (each probe tries {@link moduleFileCandidates}). */
export const MAX_MODULE_PROBES = 64;

/** `Container.name` of a record (its ref without the file ref and the `@line`). */
const qualifiedOf = (fileRef: string, r: KnowledgeSymbolRecord): string => r.ref.slice(fileRef.length + 1).replace(/@\d+$/, "");

/** The package of a bare specifier: `@scope/pkg/x` → `@scope/pkg`, `pkg/x` → `pkg`. */
const packageOf = (spec: string): string => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");

/**
 * The records with their `relations` (see `KnowledgeSymbolRelation` for what `to` is). A relative import is found among
 * the answer's files first, else on disk (guarded, at most {@link MAX_MODULE_PROBES} module paths per answer); two raw
 * relations that land on the same (kind, to) become one, their sites merged in `order`.
 */
export async function withRelations(
  rootPath: string, rootId: string, files: readonly FileSymbols[], ports: SymbolFilePorts, aliases: ModuleAliases = NO_MODULE_ALIASES,
): Promise<KnowledgeSymbolRecord[]> {
  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const byQualified = new Map<FileSymbols, Map<string, string>>();
  const indexOf = (f: FileSymbols): Map<string, string> => {
    let index = byQualified.get(f);
    if (!index) {
      index = new Map();
      for (const r of f.records) { const q = qualifiedOf(f.fileRef, r); if (!index.has(q)) index.set(q, r.ref); }
      byQualified.set(f, index);
    }
    return index;
  };
  const aliasShaped = (fromPath: string, spec: string): boolean => /^(?:@\/|~\/|#)/.test(spec) || isAliasSpecifier(fromPath, spec, aliases);
  const probed = new Map<string, string | null>();
  const fileOfModule = async (modulePath: string): Promise<string | null> => {
    const loaded = moduleFileCandidates(modulePath).find((p) => byPath.has(p));
    if (loaded) return loaded;
    if (probed.has(modulePath)) return probed.get(modulePath)!;
    if (probed.size >= MAX_MODULE_PROBES) return null;
    let found: string | null = null;
    for (const candidate of moduleFileCandidates(modulePath)) {
      try {
        if (!isSafeRelative(candidate)) continue;
        await ports.guard(rootPath, candidate);
        if ((await ports.stat(join(rootPath, candidate))).isFile) { found = candidate; break; }
      } catch { /* not there, or not ours */ }
    }
    probed.set(modulePath, found);
    return found;
  };
  const targetOf = async (f: FileSymbols, rel: SymbolRelation): Promise<string | undefined> => {
    const to = rel.to;
    if ("symbol" in to) return f.records[to.symbol]?.ref;
    const qualified = to.member ? `${to.name}.${to.member}` : to.name;
    const relative = to.module.startsWith(".");
    // A package keeps its package name; an alias-shaped specifier that names nothing keeps the whole specifier (`@/lib/x`).
    const packageRef = `src:${rootId}::${PACKAGE_MODULE_DIR}${aliasShaped(f.path, to.module) ? to.module : packageOf(to.module)}#${qualified}`;
    let file: string | null = null;
    let modulePath: string | undefined;
    if (relative) {
      modulePath = resolveImportPath(f.path, to.module);
      if (!modulePath) return undefined;
      file = await fileOfModule(modulePath);
    } else {
      // THE ordered alias candidates (agent-tools `aliasCandidates`), the same list the extract's resolution walks.
      for (const candidate of aliasCandidates(f.path, to.module, aliases)) if ((file = await fileOfModule(candidate))) break;
    }
    // An alias that names no file of the root stays a package; a relative import of nothing is a missing terminus.
    if (!file) return relative ? `src:${rootId}::${modulePath}#${qualified}` : packageRef;
    const target = byPath.get(file);
    const fileRef = `src:${rootId}::${file}`;
    return (target && indexOf(target).get(qualified)) ?? `${fileRef}#${qualified}`;
  };
  const out: KnowledgeSymbolRecord[] = [];
  for (const f of files) {
    const perRecord = new Map<number, Map<string, KnowledgeSymbolRelation>>();
    for (const rel of f.relations) {
      const to = await targetOf(f, rel);
      if (!to || to === f.records[rel.from]?.ref) continue;
      const mine = perRecord.get(rel.from) ?? perRecord.set(rel.from, new Map()).get(rel.from)!;
      const key = `${rel.kind}\0${to}`;
      const prior = mine.get(key);
      if (prior) {
        // Two raw relations landed on one target: merged sites keep the same cap as one relation's.
        if (rel.sites) prior.sites = [...(prior.sites ?? []), ...rel.sites].sort((a, b) => a.order - b.order).slice(0, MAX_CALL_SITES_PER_EDGE);
        continue;
      }
      mine.set(key, { kind: rel.kind, to, ...(rel.sites ? { sites: [...rel.sites] } : {}) });
    }
    f.records.forEach((r, i) => {
      const relations = perRecord.get(i);
      out.push(relations?.size ? { ...r, relations: [...relations.values()] } : r);
    });
  }
  return out;
}

/** The definitions in `fileRefs` (the refs of `rootId`'s files) under `rootPath`, each with its symbol-level relations. */
export async function rootSymbols(
  rootPath: string, rootId: string, fileRefs: unknown, ports: SymbolFilePorts = nodeSymbolPorts, cache: SymbolCache<FileSymbols> = sharedCache,
  timer: LoadTimer = UNTIMED, aliasCache: ModuleAliasCache = sharedAliasCache,
): Promise<KnowledgeSymbolRecord[]> {
  const out: FileSymbols[] = [];
  let total = 0;
  for (const fileRef of cleanFileRefs(fileRefs)) {
    try {
      const rel = fileRef.includes("#") ? undefined : sourcePathOf(fileRef, rootId);
      // Gate on the NAME before touching the disk: only source the extractor understands is ever opened.
      if (!rel || !isSafeRelative(rel) || !isCodePath(rel) || !isSymbolIndexable(rel)) continue;
      await ports.guard(rootPath, rel);
      const path = join(rootPath, rel);
      const info = await ports.stat(path);
      if (!info.isFile || info.size > MAX_SYMBOL_FILE_BYTES || total + info.size > MAX_SYMBOL_TOTAL_BYTES) continue;
      total += info.size;
      const key = SymbolCache.key(rootPath, fileRef, info.mtimeMs, info.size);
      let file = cache.get(key);
      if (!file) {
        const text = await ports.read(path, MAX_SYMBOL_FILE_BYTES);
        if (text === null) continue;
        file = fileSymbolsOf(fileRef, rel, text);
        cache.set(key, file);
      }
      out.push(file);
    } catch {
      // An unsafe, missing or unreadable file has no symbols here; the others still answer.
      continue;
    }
  }
  // The root's path aliases are read only when a relation names a bare specifier (one may be an alias of the root).
  const bare = out.some((f) => f.relations.some((r) => !("symbol" in r.to) && !r.to.module.startsWith(".")));
  const aliases = bare
    ? await timer.phase("aliases", () => aliasCache.get(rootPath, out.map((f) => f.path), rootConfigPorts(rootPath, ports)))
    : NO_MODULE_ALIASES;
  return withRelations(rootPath, rootId, out, ports, aliases);
}

/** The root's alias configs, read once per root and reused while they keep their modification times. */
const sharedAliasCache = new ModuleAliasCache();
// A tsconfig/jsconfig created, changed or deleted under a root (the knowledge folder watcher): its aliases are read again.
onAliasConfigChanged((path) => sharedAliasCache.forgetContaining(path));

/** {@link rootConfigReader} plus a guarded stat, for the {@link ModuleAliasCache}. */
export function rootConfigPorts(rootPath: string, ports: SymbolFilePorts = nodeSymbolPorts): AliasConfigPorts {
  return {
    read: rootConfigReader(rootPath, ports),
    mtime: async (rel) => {
      try {
        if (!isSafeRelative(rel)) return undefined;
        await ports.guard(rootPath, rel);
        const info = await ports.stat(join(rootPath, rel));
        return info.isFile ? info.mtimeMs : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/** A root's config files are small; a larger one is not read. */
export const MAX_CONFIG_FILE_BYTES = 256 * 1024;

/**
 * Reads a root-relative config file for `loadModuleAliases`, under the same guards as a source file: a safe path inside
 * the root, a regular file, at most {@link MAX_CONFIG_FILE_BYTES}. Undefined when it is absent or refused.
 */
export function rootConfigReader(rootPath: string, ports: SymbolFilePorts = nodeSymbolPorts): AliasConfigPorts["read"] {
  return async (rel) => {
    try {
      if (!isSafeRelative(rel)) return undefined;
      await ports.guard(rootPath, rel);
      const path = join(rootPath, rel);
      const info = await ports.stat(path);
      if (!info.isFile || info.size > MAX_CONFIG_FILE_BYTES) return undefined;
      return (await ports.read(path, MAX_CONFIG_FILE_BYTES)) ?? undefined;
    } catch {
      return undefined;
    }
  };
}

const sharedCache = new SymbolCache<FileSymbols>();

/**
 * One symbols call per root at a time: a call waits for the one before it on the same root, and a call
 * identical to one already running or waiting gets that call's answer instead of reading again.
 */
export class SymbolsGate {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly running = new Map<string, Promise<KnowledgeSymbolRecord[]>>();

  run(rootId: string, fileRefs: unknown, task: (refs: string[]) => Promise<KnowledgeSymbolRecord[]>): Promise<KnowledgeSymbolRecord[]> {
    const refs = cleanFileRefs(fileRefs);
    const key = `${rootId}\0${refs.join("\0")}`;
    const same = this.running.get(key);
    if (same) return same;
    const after = this.tails.get(rootId) ?? Promise.resolve();
    const result = after.then(() => task(refs), () => task(refs));
    const settled = result.then(() => undefined, () => undefined);
    this.tails.set(rootId, settled);
    this.running.set(key, result);
    void settled.then(() => {
      if (this.running.get(key) === result) this.running.delete(key);
      if (this.tails.get(rootId) === settled) this.tails.delete(rootId);
    });
    return result;
  }
}

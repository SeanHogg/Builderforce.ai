/**
 * The on-disk DEFINITION INDEX — symbol name → file:line for a whole working tree —
 * backing capability `repo.symbols` on the surfaces that sit on a real filesystem (the
 * VS Code workspace and the on-prem Node runtime). Node-only, so it lives behind the
 * `./node-symbols` export condition; the package root stays builtin-free for the Worker.
 *
 * ── HOW IT STAYS CHEAP ───────────────────────────────────────────────────────
 * Parsing every source file on every query would be a tree walk wearing an index's
 * name. Instead each file's symbols are kept with the `mtime`+`size` they were parsed
 * at, so a refresh only STATS unchanged files and re-parses the changed ones:
 *   • the first query (or `refresh()`) builds it — and loads a persisted snapshot first,
 *     so a restart costs a stat walk, not a re-read of the repo;
 *   • `markDirty(path)` re-parses exactly that file on the next query (a host with a file
 *     watcher, or a provider that just wrote the file, calls it);
 *   • a full stat walk runs at most once per `fullRefreshMs` as the backstop for changes
 *     nobody reported (a `git checkout`, a codemod, another editor).
 * Concurrent callers share one in-flight refresh.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { RepoSymbolsCapability, SymbolFindResult, SymbolMatch } from "./capabilities.js";
import { isUnderScopeDir, normalizeScopeDir } from "./glob.js";
import { extractSymbols, isSymbolIndexable, SYMBOL_KINDS, type CodeSymbol, type SymbolKind } from "./symbols.js";

/** Directories never indexed — build output, dependencies, VCS and tool caches. */
export const SYMBOL_INDEX_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".turbo", ".vercel", ".cache",
  "target", "vendor", ".venv", "venv", "__pycache__", ".idea", ".vscode-test",
]);

export interface SymbolIndexOptions {
  /** Directory names to skip (dot-directories are always skipped). */
  skipDirs?: ReadonlySet<string>;
  /** Files indexed before the index reports itself partial. */
  maxFiles?: number;
  /** Larger files are skipped — generated bundles and data dumps are not code maps. */
  maxFileBytes?: number;
  /** Where to persist the snapshot so a restart re-stats instead of re-reading. */
  cachePath?: string;
  /** Minimum gap between full stat walks. A host with a file watcher can set it high. */
  fullRefreshMs?: number;
}

interface FileEntry {
  mtime: number;
  size: number;
  symbols: CodeSymbol[];
}

/** Persisted snapshot: `[relPath, mtime, size, [[name, kindIndex, line, exported01]…]]`. */
type SnapshotFile = [string, number, number, Array<[string, number, number, 0 | 1]>];
interface Snapshot {
  v: 1;
  files: SnapshotFile[];
}

const PARSE_BATCH = 64;

/** How a query ranks a name: lower is better, null is no match. */
function nameScore(name: string, query: string, queryLower: string): number | null {
  if (name === query) return 0;
  const lower = name.toLowerCase();
  if (lower === queryLower) return 1;
  if (lower.startsWith(queryLower)) return 2;
  if (lower.includes(queryLower)) return 3;
  return null;
}

/** Declarations outrank members, members outrank headings, when names score the same. */
const KIND_RANK: Partial<Record<SymbolKind, number>> = { method: 1, heading: 2 };

/**
 * One index per working-tree root for the whole process. Providers are rebuilt per tool
 * call on some surfaces, and an index per provider would re-walk the repo every call —
 * the exact cost the index exists to remove.
 */
const sharedIndexes = new Map<string, WorkspaceSymbolIndex>();

/** The process-wide index for `root` (created on first use with `options`). */
export function sharedSymbolIndex(root: string, options: SymbolIndexOptions = {}): WorkspaceSymbolIndex {
  const key = path.resolve(root);
  let index = sharedIndexes.get(key);
  if (!index) {
    index = new WorkspaceSymbolIndex(key, options);
    sharedIndexes.set(key, index);
  }
  return index;
}

/** Tell every shared index containing `absPath` that the file changed (a watcher event). */
export function markSymbolFileChanged(absPath: string): void {
  for (const index of sharedIndexes.values()) index.markDirty(absPath);
}

export class WorkspaceSymbolIndex implements RepoSymbolsCapability {
  private readonly root: string;
  private readonly skipDirs: ReadonlySet<string>;
  private readonly maxFiles: number;
  private readonly maxFileBytes: number;
  private readonly cachePath?: string;
  private readonly fullRefreshMs: number;
  private files = new Map<string, FileEntry>();
  private readonly dirty = new Set<string>();
  private lastFullRefresh = 0;
  private loadedSnapshot = false;
  private partial = false;
  private inflight: Promise<void> | null = null;

  constructor(root: string, options: SymbolIndexOptions = {}) {
    this.root = path.resolve(root);
    this.skipDirs = options.skipDirs ?? SYMBOL_INDEX_SKIP_DIRS;
    this.maxFiles = options.maxFiles ?? 40_000;
    this.maxFileBytes = options.maxFileBytes ?? 1_000_000;
    this.cachePath = options.cachePath;
    this.fullRefreshMs = options.fullRefreshMs ?? 60_000;
  }

  /** Repo-relative POSIX path for an absolute or relative path, or null when outside. */
  private relative(p: string): string | null {
    const abs = path.resolve(this.root, p);
    const rel = path.relative(this.root, abs);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return rel.split(path.sep).join("/");
  }

  /** Re-parse `p` (absolute or root-relative) on the next query. Cheap; safe to over-call. */
  markDirty(p: string): void {
    const rel = this.relative(p);
    if (!rel) return;
    if (isSymbolIndexable(rel)) {
      this.dirty.add(rel);
      return;
    }
    // Not a source file — possibly a DIRECTORY that was deleted or renamed (a watcher
    // reports the folder, not each file in it). Re-check every indexed file beneath it.
    const prefix = `${rel}/`;
    for (const known of this.files.keys()) {
      if (known.startsWith(prefix)) this.dirty.add(known);
    }
  }

  /** Force a full stat walk now (e.g. after a workspace rescan). */
  refresh(): Promise<void> {
    return this.run(() => this.fullRefresh());
  }

  /** Every indexed file under `scope` with its symbols — for building workspace digests. */
  async filesUnder(scope?: string): Promise<Array<{ path: string; symbols: CodeSymbol[] }>> {
    await this.ensureFresh();
    const dir = normalizeScopeDir(scope);
    const out: Array<{ path: string; symbols: CodeSymbol[] }> = [];
    for (const [rel, entry] of this.files) {
      if (!dir || isUnderScopeDir(rel, dir)) out.push({ path: rel, symbols: entry.symbols });
    }
    return out;
  }

  async find(query: string, opts: { scope?: string; kind?: SymbolKind; limit?: number } = {}): Promise<SymbolFindResult> {
    const q = query.trim();
    if (!q) return { ok: false, error: "query is required" };
    try {
      await this.ensureFresh();
    } catch (e) {
      return { ok: false, query: q, error: `symbol index unavailable: ${e instanceof Error ? e.message : String(e)}` };
    }
    const dir = normalizeScopeDir(opts.scope);
    const ql = q.toLowerCase();
    const limit = Math.max(1, opts.limit ?? 20);
    const scored: Array<{ match: SymbolMatch; score: number }> = [];
    for (const [rel, entry] of this.files) {
      if (dir && !isUnderScopeDir(rel, dir)) continue;
      for (const s of entry.symbols) {
        if (opts.kind && s.kind !== opts.kind) continue;
        const score = nameScore(s.name, q, ql);
        if (score == null) continue;
        scored.push({ match: { path: rel, line: s.line, kind: s.kind, name: s.name, exported: s.exported }, score });
      }
    }
    scored.sort((a, b) =>
      a.score - b.score
      || Number(b.match.exported) - Number(a.match.exported)
      || (KIND_RANK[a.match.kind] ?? 0) - (KIND_RANK[b.match.kind] ?? 0)
      || a.match.path.length - b.match.path.length
      || a.match.path.localeCompare(b.match.path)
      || a.match.line - b.match.line);
    return {
      ok: true,
      query: q,
      total: scored.length,
      truncated: scored.length > limit,
      matches: scored.slice(0, limit).map((s) => s.match),
      indexedFiles: this.files.size,
      ...(this.partial ? { partialIndex: true } : {}),
    };
  }

  /** Bring the index up to date for a query: build, re-parse dirty files, or re-walk. */
  private ensureFresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (!this.loadedSnapshot || this.lastFullRefresh === 0 || Date.now() - this.lastFullRefresh > this.fullRefreshMs) {
      return this.run(() => this.fullRefresh());
    }
    if (this.dirty.size > 0) return this.run(() => this.refreshDirty());
    return Promise.resolve();
  }

  /** Coalesce: one refresh at a time; callers during it await the same promise. */
  private run(task: () => Promise<void>): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = task().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fullRefresh(): Promise<void> {
    if (!this.loadedSnapshot) {
      await this.loadSnapshot();
      this.loadedSnapshot = true;
    }
    const { paths, truncated } = await this.walk();
    this.partial = truncated;
    const seen = new Set(paths);
    let changed = false;
    for (const rel of [...this.files.keys()]) {
      if (!seen.has(rel)) {
        this.files.delete(rel);
        changed = true;
      }
    }
    for (let i = 0; i < paths.length; i += PARSE_BATCH) {
      const results = await Promise.all(paths.slice(i, i + PARSE_BATCH).map((rel) => this.update(rel)));
      if (results.some(Boolean)) changed = true;
    }
    this.dirty.clear();
    this.lastFullRefresh = Date.now();
    if (changed) void this.saveSnapshot();
  }

  private async refreshDirty(): Promise<void> {
    const batch = [...this.dirty];
    this.dirty.clear();
    const results = await Promise.all(batch.map((rel) => this.update(rel)));
    if (results.some(Boolean)) void this.saveSnapshot();
  }

  /** Re-stat one file and re-parse it if it changed. Returns true when the index changed. */
  private async update(rel: string): Promise<boolean> {
    const abs = path.join(this.root, rel);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat || !stat.isFile() || stat.size > this.maxFileBytes) {
      return this.files.delete(rel);
    }
    const existing = this.files.get(rel);
    if (existing && existing.mtime === stat.mtimeMs && existing.size === stat.size) return false;
    const content = await fs.readFile(abs, "utf-8").catch(() => null);
    if (content == null) return this.files.delete(rel);
    this.files.set(rel, { mtime: stat.mtimeMs, size: stat.size, symbols: extractSymbols(rel, content) });
    return true;
  }

  /** Breadth-first walk of indexable files (shallow files first, so a cap drops the deep tail). */
  private async walk(): Promise<{ paths: string[]; truncated: boolean }> {
    const out: string[] = [];
    const queue: string[] = [this.root];
    while (queue.length > 0) {
      const dir = queue.shift()!;
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name.startsWith(".") || this.skipDirs.has(entry.name)) continue;
          queue.push(path.join(dir, entry.name));
        } else if (entry.isFile() && isSymbolIndexable(entry.name)) {
          if (out.length >= this.maxFiles) return { paths: out, truncated: true };
          out.push(path.relative(this.root, path.join(dir, entry.name)).split(path.sep).join("/"));
        }
      }
    }
    return { paths: out, truncated: false };
  }

  private async loadSnapshot(): Promise<void> {
    if (!this.cachePath) return;
    try {
      const snap = JSON.parse(await fs.readFile(this.cachePath, "utf-8")) as Snapshot;
      if (snap?.v !== 1 || !Array.isArray(snap.files)) return;
      for (const [rel, mtime, size, symbols] of snap.files) {
        this.files.set(rel, {
          mtime,
          size,
          symbols: symbols.map(([name, kind, line, exported]) => ({ name, kind: SYMBOL_KINDS[kind] ?? "function", line, exported: exported === 1 })),
        });
      }
    } catch {
      /* no snapshot yet, or unreadable — the walk rebuilds it */
    }
  }

  private async saveSnapshot(): Promise<void> {
    if (!this.cachePath) return;
    const files: SnapshotFile[] = [];
    for (const [rel, entry] of this.files) {
      files.push([rel, entry.mtime, entry.size, entry.symbols.map((s) => [s.name, SYMBOL_KINDS.indexOf(s.kind), s.line, s.exported ? 1 : 0])]);
    }
    try {
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
      await fs.writeFile(this.cachePath, JSON.stringify({ v: 1, files } satisfies Snapshot), "utf-8");
    } catch {
      /* best-effort: an unwritable snapshot only costs a re-read on the next start */
    }
  }
}

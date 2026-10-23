/**
 * The repo map — the codebase's shape in a token budget: files ordered by personalized
 * PageRank over the file reference graph, each with its most-referenced definitions as
 * `line: signature`. A mirror of bf-index `repo_map.rs`, output format included, so a
 * model reads the same map from a cloud run and from a local one.
 */

import { extractCodeRefs } from './codeRefs.js';
import { moduleName } from './graph.js';
import type { MapSymbol, RepoGraph } from './repoGraph.js';
import { identifiers } from './terms.js';

/** Rough chars-per-token for code; the map is trimmed to `maxTokens * CHARS_PER_TOKEN`. */
export const CHARS_PER_TOKEN = 4;
export const MAX_SYMBOLS_PER_FILE = 8;
/** Query words shorter than this never name a file (`a`, `fix`, `the`). */
const MIN_QUERY_STEM = 4;
/** The smallest budget a map is rendered at. */
const MIN_MAP_TOKENS = 64;

export interface RepoMapOptions {
  maxTokens: number;
  /** Paths (or path prefixes) the caller is working in: ranked first, and they personalize the rank. */
  focus?: readonly string[];
  /** The task in hand: files it names (a path, a file stem, a symbol they define) personalize the rank. */
  query?: string | null;
}

function isFocus(path: string, focus: readonly string[]): boolean {
  return focus.some((f) => path.startsWith(f) || f.startsWith(path));
}

/** Files a free-text task names: a path, a file stem as a word, or a code-shaped symbol they define. */
function namedFiles(query: string, repo: RepoGraph): Set<number> {
  const { graph, symbols } = repo;
  const out = new Set<number>();
  const wantedSymbols = new Set<string>();
  for (const r of extractCodeRefs(query)) {
    if (r.kind === 'path') {
      graph.paths().forEach((p, i) => {
        if (p === r.reference || p.endsWith(`/${r.reference}`)) out.add(i);
      });
    } else {
      wantedSymbols.add(r.reference);
    }
  }
  const words = new Set(identifiers(query, MIN_QUERY_STEM).map((w) => w.toLowerCase()));
  graph.paths().forEach((p, i) => {
    if (words.has(moduleName(p))) out.add(i);
  });
  for (const s of symbols) {
    if (!wantedSymbols.has(s.name)) continue;
    const i = graph.indexOf(s.path);
    if (i !== undefined) out.add(i);
  }
  return out;
}

/**
 * Teleport weights: 1 per file, plus — when focus paths or the query name any files —
 * a boost that gives those files together as much teleport mass as the rest of the repo.
 */
export function personalization(repo: RepoGraph, opts: RepoMapOptions): number[] {
  const focus = opts.focus ?? [];
  const hot = new Set<number>();
  repo.graph.paths().forEach((p, i) => {
    if (isFocus(p, focus)) hot.add(i);
  });
  if (opts.query) for (const i of namedFiles(opts.query, repo)) hot.add(i);
  const n = repo.graph.length;
  const p = new Array<number>(n).fill(1);
  if (hot.size > 0) {
    const boost = n / hot.size;
    for (const i of hot) p[i] = p[i]! + boost;
  }
  return p;
}

/** Files in map order with their symbols in display order — shared by the renderer and the search. */
export function rankedFiles(repo: RepoGraph, opts: RepoMapOptions): Array<{ path: string; rank: number; symbols: MapSymbol[] }> {
  const { graph } = repo;
  const rank = graph.pagerank(personalization(repo, opts));
  const byFile = new Map<string, Array<{ s: MapSymbol; degree: number }>>();
  for (const s of repo.symbols) {
    const i = graph.indexOf(s.path);
    const degree = i === undefined ? 0 : graph.symbolInDegree(i, s.name);
    const list = byFile.get(s.path);
    if (list) list.push({ s, degree });
    else byFile.set(s.path, [{ s, degree }]);
  }
  const focus = opts.focus ?? [];
  const files = [...byFile.entries()].map(([path, syms]) => {
    syms.sort((a, b) => b.degree - a.degree || a.s.line - b.s.line);
    const i = graph.indexOf(path);
    return { path, focused: isFocus(path, focus), rank: i === undefined ? 0 : rank[i] ?? 0, symbols: syms.map((x) => x.s) };
  });
  files.sort((a, b) => Number(b.focused) - Number(a.focused) || b.rank - a.rank || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files.map(({ path, rank: r, symbols }) => ({ path, rank: r, symbols }));
}

export function renderRepoMap(repo: RepoGraph, opts: RepoMapOptions): string {
  const budget = Math.max(opts.maxTokens, MIN_MAP_TOKENS) * CHARS_PER_TOKEN;
  let out = '';
  let omitted = 0;
  for (const { path, symbols } of rankedFiles(repo, opts)) {
    let block = `${path}\n`;
    for (const s of symbols.slice(0, MAX_SYMBOLS_PER_FILE)) {
      block += `${s.nested ? '    ' : '  '}${s.line}: ${s.signature}\n`;
    }
    if (symbols.length > MAX_SYMBOLS_PER_FILE) block += `  … ${symbols.length - MAX_SYMBOLS_PER_FILE} more\n`;
    if (out.length + block.length > budget) {
      omitted += 1;
      continue;
    }
    out += block;
  }
  if (omitted > 0) out += `… ${omitted} more files (use semantic_search to reach them)\n`;
  return out;
}

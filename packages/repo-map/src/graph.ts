/**
 * The file reference graph behind the repo map, and personalized PageRank over it — a
 * line-for-line mirror of bf-index `graph.rs` (builderforce-inference). The parameters
 * and tie rules are the same so a cloud run and a local run rank one repo the same way.
 *
 * Edge A→B carries the number of identifiers A uses that B defines. A name defined in
 * several files is split between the definers A most plausibly means — import names
 * the file's module (+2), names its directory (+1), the definer sits in A's own
 * directory (+1); highest score wins, ties share the weight — and a file that defines
 * a name itself resolves it locally (no edge).
 */

export const DAMPING = 0.85;
export const MAX_ITERS = 30;
/** L1 change between iterations below which the ranks are considered converged. */
export const TOLERANCE = 1e-6;

/** Stems that name their directory's module rather than themselves. */
const MODULE_INDEX_STEMS: ReadonlySet<string> = new Set(['index', 'mod', 'lib', 'main', '__init__', 'init']);

/** One resolved-name candidate: `from` uses `ident`, which `to` defines (one row per definer). */
export interface RefRow {
  from: string;
  ident: string;
  to: string;
}

/** `(path, term)` — a lowercased identifier term of one of the file's import statements. */
export type ImportRow = readonly [path: string, term: string];

/** The graph in a JSON-safe shape (what the R2 cache stores). */
export interface SerializedFileGraph {
  paths: string[];
  /** Outgoing `[to, weight]` per file, sorted by `to`. */
  out: Array<Array<[number, number]>>;
  /** `[file, symbol name, resolved in-degree]`. */
  symbolIn: Array<[number, string, number]>;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function dirName(path: string): string {
  const dir = dirOf(path);
  return dir.slice(dir.lastIndexOf('/') + 1);
}

/** Lowercased name a file is imported by: its stem, or its directory for an index file. */
export function moduleName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  const stem = (file.split('.')[0] ?? file).toLowerCase();
  if (MODULE_INDEX_STEMS.has(stem)) {
    const dir = dirName(path).toLowerCase();
    if (dir) return dir;
  }
  return stem;
}

const symbolKey = (file: number, name: string): string => `${file}\u0000${name}`;

export class FileGraph {
  private readonly pathList: string[] = [];
  private readonly index = new Map<string, number>();
  private out: Array<Array<[number, number]>> = [];
  private readonly symbolIn = new Map<string, number>();

  private constructor() {}

  /** `paths` are every node (files with no edges still rank); `refs` may name more. */
  static build(paths: Iterable<string>, refs: Iterable<RefRow>, imports: Iterable<ImportRow>): FileGraph {
    const grouped = new Map<string, Map<string, string[]>>();
    for (const r of refs) {
      let byIdent = grouped.get(r.from);
      if (!byIdent) grouped.set(r.from, (byIdent = new Map()));
      const list = byIdent.get(r.ident);
      if (list) list.push(r.to);
      else byIdent.set(r.ident, [r.to]);
    }
    return FileGraph.buildGrouped(paths, grouped, imports);
  }

  /**
   * {@link build} over references already grouped by the using file — every
   * `(from, ident)` pair appears in exactly one group. The streaming builder uses this
   * so one file's candidate definers are resolved and dropped before the next file's
   * are produced, instead of the whole join living in memory at once.
   */
  static buildGrouped(
    paths: Iterable<string>,
    groups: Iterable<readonly [from: string, byIdent: ReadonlyMap<string, readonly string[]>]>,
    imports: Iterable<ImportRow>,
  ): FileGraph {
    const g = new FileGraph();
    for (const p of paths) g.node(p);
    const importTerms = new Map<number, Set<string>>();
    for (const [path, term] of imports) {
      const i = g.node(path);
      let set = importTerms.get(i);
      if (!set) importTerms.set(i, (set = new Set()));
      set.add(term);
    }
    const edges = new Map<number, Map<number, number>>();
    for (const [fromPath, byIdent] of groups) {
      const from = g.node(fromPath);
      for (const [ident, raw] of byIdent) {
        const defs = [...new Set(raw.map((p) => g.node(p)))].sort((a, b) => a - b);
        if (defs.includes(from)) continue;
        const chosen = g.bestDefiners(from, defs, importTerms.get(from));
        const w = 1 / chosen.length;
        let out = edges.get(from);
        if (!out) edges.set(from, (out = new Map()));
        for (const to of chosen) {
          out.set(to, (out.get(to) ?? 0) + w);
          const key = symbolKey(to, ident);
          g.symbolIn.set(key, (g.symbolIn.get(key) ?? 0) + w);
        }
      }
    }
    g.out = g.pathList.map((_, i) => [...(edges.get(i)?.entries() ?? [])].sort((a, b) => a[0] - b[0]));
    return g;
  }

  static fromJSON(s: SerializedFileGraph): FileGraph {
    const g = new FileGraph();
    for (const p of s.paths) g.node(p);
    g.out = s.out.map((edges) => edges.map(([to, w]) => [to, w] as [number, number]));
    while (g.out.length < g.pathList.length) g.out.push([]);
    for (const [file, name, degree] of s.symbolIn) g.symbolIn.set(symbolKey(file, name), degree);
    return g;
  }

  toJSON(): SerializedFileGraph {
    const symbolIn: Array<[number, string, number]> = [];
    for (const [key, degree] of this.symbolIn) {
      const sep = key.indexOf('\u0000');
      symbolIn.push([Number(key.slice(0, sep)), key.slice(sep + 1), degree]);
    }
    return { paths: [...this.pathList], out: this.out.map((e) => e.map(([to, w]) => [to, w] as [number, number])), symbolIn };
  }

  private node(path: string): number {
    const existing = this.index.get(path);
    if (existing !== undefined) return existing;
    const i = this.pathList.length;
    this.pathList.push(path);
    this.index.set(path, i);
    this.out.push([]);
    return i;
  }

  private bestDefiners(from: number, defs: number[], imports: Set<string> | undefined): number[] {
    const fromDir = dirOf(this.pathList[from]!);
    const score = (to: number): number => {
      const path = this.pathList[to]!;
      let s = 0;
      if (imports) {
        if (imports.has(moduleName(path))) s += 2;
        const dir = dirName(path).toLowerCase();
        if (dir && imports.has(dir)) s += 1;
      }
      if (dirOf(path) === fromDir) s += 1;
      return s;
    };
    const scored = defs.map((d) => [d, score(d)] as const);
    const best = Math.max(0, ...scored.map((x) => x[1]));
    return scored.filter((x) => x[1] === best).map((x) => x[0]);
  }

  get length(): number {
    return this.pathList.length;
  }

  paths(): readonly string[] {
    return this.pathList;
  }

  indexOf(path: string): number | undefined {
    return this.index.get(path);
  }

  /** Total edge weight A→B (0 when A does not depend on B). */
  edge(from: number, to: number): number {
    return this.out[from]?.find((e) => e[0] === to)?.[1] ?? 0;
  }

  /** Resolved references from other files into symbol `name` of file `file`. */
  symbolInDegree(file: number, name: string): number {
    return this.symbolIn.get(symbolKey(file, name)) ?? 0;
  }

  /**
   * Personalized PageRank. `personal` is the teleport distribution (normalized here;
   * all-zero or wrong length means uniform). A file with no outgoing edges hands its
   * rank back through the teleport distribution, so the ranks always sum to 1.
   */
  pagerank(personal: readonly number[]): number[] {
    const n = this.pathList.length;
    if (n === 0) return [];
    const valid = (v: number): boolean => Number.isFinite(v) && v > 0;
    const total = personal.filter(valid).reduce((a, b) => a + b, 0);
    const p = personal.length === n && total > 0
      ? personal.map((v) => (valid(v) ? v / total : 0))
      : new Array<number>(n).fill(1 / n);
    const outSum = this.out.map((e) => e.reduce((a, x) => a + x[1], 0));
    let rank = [...p];
    for (let iter = 0; iter < MAX_ITERS; iter += 1) {
      let dangling = 0;
      for (let i = 0; i < n; i += 1) if (outSum[i]! <= 0) dangling += rank[i]!;
      const next = p.map((pi) => (1 - DAMPING) * pi + DAMPING * dangling * pi);
      for (let from = 0; from < n; from += 1) {
        if (outSum[from]! <= 0) continue;
        const share = (DAMPING * rank[from]!) / outSum[from]!;
        for (const [to, w] of this.out[from]!) next[to] = next[to]! + share * w;
      }
      let delta = 0;
      for (let i = 0; i < n; i += 1) delta += Math.abs(next[i]! - rank[i]!);
      rank = next;
      if (delta < TOLERANCE) break;
    }
    return rank;
  }
}

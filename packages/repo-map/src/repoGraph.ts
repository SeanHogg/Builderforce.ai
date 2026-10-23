/**
 * The repo graph: every read file's definitions plus the {@link FileGraph} over them.
 *
 * {@link RepoGraphBuilder} takes files one at a time (a tarball streams them) and keeps
 * only their FACTS, never their text, with identifiers interned to numbers — a 6,000-
 * file repo's mentions stay a few MB. `build()` joins mentions to definers exactly as
 * bf-index's `repo_graph` SQL does (one row per definer of a name, same-file rows kept)
 * and hands them to the graph. The result serializes to JSON for the R2 cache and
 * hydrates back without re-reading the repo.
 */

import { extractFileFacts, type SymbolRow } from './extract.js';
import { FileGraph, type ImportRow, type SerializedFileGraph } from './graph.js';

export const REPO_GRAPH_VERSION = 1;

/** `[file index, name, line, signature, nested ? 1 : 0]`. */
export type SerializedSymbol = [number, string, number, string, 0 | 1];

export interface RepoGraphStats {
  files: number;
  bytes: number;
  /** True when a cap stopped the read before the whole repo was seen. */
  truncated: boolean;
}

export interface SerializedRepoGraph {
  version: typeof REPO_GRAPH_VERSION;
  graph: SerializedFileGraph;
  symbols: SerializedSymbol[];
  stats: RepoGraphStats;
}

/** One definition, hydrated. */
export interface MapSymbol extends SymbolRow {
  path: string;
}

/** A hydrated graph — what the renderer and the search read. */
export class RepoGraph {
  constructor(
    readonly graph: FileGraph,
    readonly symbols: readonly MapSymbol[],
    readonly stats: RepoGraphStats,
  ) {}

  static fromJSON(s: SerializedRepoGraph): RepoGraph {
    if (s.version !== REPO_GRAPH_VERSION) throw new Error(`repo graph version ${String(s.version)} is not ${REPO_GRAPH_VERSION}`);
    const graph = FileGraph.fromJSON(s.graph);
    const paths = graph.paths();
    const symbols = s.symbols.map(([file, name, line, signature, nested]) => ({
      path: paths[file] ?? '', name, line, signature, nested: nested === 1,
    }));
    return new RepoGraph(graph, symbols, s.stats);
  }
}

export class RepoGraphBuilder {
  private readonly paths: string[] = [];
  private readonly symbols: MapSymbol[] = [];
  private readonly identIds = new Map<string, number>();
  private readonly identNames: string[] = [];
  private readonly mentions: Uint32Array[] = [];
  private readonly imports: ImportRow[] = [];
  private bytes = 0;
  private truncated = false;

  /** Read one file. Returns false when the map does not read its language. */
  addFile(path: string, content: string): boolean {
    const facts = extractFileFacts(path, content);
    if (!facts) return false;
    this.paths.push(path);
    this.bytes += content.length;
    for (const s of facts.symbols) this.symbols.push({ ...s, path });
    const ids = new Uint32Array(facts.identifiers.size);
    let k = 0;
    for (const ident of facts.identifiers) ids[k++] = this.intern(ident);
    this.mentions.push(ids);
    for (const term of facts.imports) this.imports.push([path, term]);
    return true;
  }

  /** Record that a cap stopped the read early. */
  markTruncated(): void {
    this.truncated = true;
  }

  get fileCount(): number {
    return this.paths.length;
  }

  private intern(ident: string): number {
    const id = this.identIds.get(ident);
    if (id !== undefined) return id;
    const next = this.identNames.length;
    this.identNames.push(ident);
    this.identIds.set(ident, next);
    return next;
  }

  /**
   * The `file_idents ⋈ symbols` join (one row per distinct definer of a mentioned name,
   * same-file rows kept), one using file at a time — never materialized as a whole.
   */
  private *refGroups(): Generator<readonly [string, ReadonlyMap<string, readonly string[]>]> {
    const definers = new Map<string, string[]>();
    for (const s of this.symbols) {
      const list = definers.get(s.name);
      if (!list) definers.set(s.name, [s.path]);
      else if (list[list.length - 1] !== s.path && !list.includes(s.path)) list.push(s.path);
    }
    for (let f = 0; f < this.paths.length; f += 1) {
      const byIdent = new Map<string, readonly string[]>();
      for (const id of this.mentions[f]!) {
        const ident = this.identNames[id]!;
        const defs = definers.get(ident);
        if (defs) byIdent.set(ident, defs);
      }
      if (byIdent.size > 0) yield [this.paths[f]!, byIdent];
    }
  }

  build(): SerializedRepoGraph {
    const graph = FileGraph.buildGrouped(this.paths, this.refGroups(), this.imports);
    const index = new Map(graph.paths().map((p, i) => [p, i] as const));
    return {
      version: REPO_GRAPH_VERSION,
      graph: graph.toJSON(),
      symbols: this.symbols.map((s) => [index.get(s.path) ?? 0, s.name, s.line, s.signature, s.nested ? 1 : 0]),
      stats: { files: this.paths.length, bytes: this.bytes, truncated: this.truncated },
    };
  }
}

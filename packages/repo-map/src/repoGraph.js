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
import { extractFileFacts } from './extract.js';
import { FileGraph } from './graph.js';
export const REPO_GRAPH_VERSION = 1;
/** A hydrated graph — what the renderer and the search read. */
export class RepoGraph {
    graph;
    symbols;
    stats;
    constructor(graph, symbols, stats) {
        this.graph = graph;
        this.symbols = symbols;
        this.stats = stats;
    }
    static fromJSON(s) {
        if (s.version !== REPO_GRAPH_VERSION)
            throw new Error(`repo graph version ${String(s.version)} is not ${REPO_GRAPH_VERSION}`);
        const graph = FileGraph.fromJSON(s.graph);
        const paths = graph.paths();
        const symbols = s.symbols.map(([file, name, line, signature, nested]) => ({
            path: paths[file] ?? '', name, line, signature, nested: nested === 1,
        }));
        return new RepoGraph(graph, symbols, s.stats);
    }
}
export class RepoGraphBuilder {
    paths = [];
    symbols = [];
    identIds = new Map();
    identNames = [];
    mentions = [];
    imports = [];
    bytes = 0;
    truncated = false;
    /** Read one file. Returns false when the map does not read its language. */
    addFile(path, content) {
        const facts = extractFileFacts(path, content);
        if (!facts)
            return false;
        this.paths.push(path);
        this.bytes += content.length;
        for (const s of facts.symbols)
            this.symbols.push({ ...s, path });
        const ids = new Uint32Array(facts.identifiers.size);
        let k = 0;
        for (const ident of facts.identifiers)
            ids[k++] = this.intern(ident);
        this.mentions.push(ids);
        for (const term of facts.imports)
            this.imports.push([path, term]);
        return true;
    }
    /** Record that a cap stopped the read early. */
    markTruncated() {
        this.truncated = true;
    }
    get fileCount() {
        return this.paths.length;
    }
    intern(ident) {
        const id = this.identIds.get(ident);
        if (id !== undefined)
            return id;
        const next = this.identNames.length;
        this.identNames.push(ident);
        this.identIds.set(ident, next);
        return next;
    }
    /**
     * The `file_idents ⋈ symbols` join (one row per distinct definer of a mentioned name,
     * same-file rows kept), one using file at a time — never materialized as a whole.
     */
    *refGroups() {
        // Each name's distinct definers in first-seen order (a Set keeps insertion order), as the arrays the join hands on.
        const seen = new Map();
        for (const s of this.symbols) {
            const paths = seen.get(s.name);
            if (!paths)
                seen.set(s.name, new Set([s.path]));
            else
                paths.add(s.path);
        }
        const definers = new Map([...seen].map(([name, paths]) => [name, [...paths]]));
        for (let f = 0; f < this.paths.length; f += 1) {
            const byIdent = new Map();
            for (const id of this.mentions[f]) {
                const ident = this.identNames[id];
                const defs = definers.get(ident);
                if (defs)
                    byIdent.set(ident, defs);
            }
            if (byIdent.size > 0)
                yield [this.paths[f], byIdent];
        }
    }
    build() {
        const graph = FileGraph.buildGrouped(this.paths, this.refGroups(), this.imports);
        const index = new Map(graph.paths().map((p, i) => [p, i]));
        return {
            version: REPO_GRAPH_VERSION,
            graph: graph.toJSON(),
            symbols: this.symbols.map((s) => [index.get(s.path) ?? 0, s.name, s.line, s.signature, s.nested ? 1 : 0]),
            stats: { files: this.paths.length, bytes: this.bytes, truncated: this.truncated },
        };
    }
}
//# sourceMappingURL=repoGraph.js.map
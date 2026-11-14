/**
 * The ONE L3 cache key of a whole-tree tool's run (PRD 41 §B7, B8.3; agent-tools `l3CacheKey`), computed the same way by
 * the run delta's tier (`repoAnalyzers.ts`) and the background indexer's L3 pass ({@link indexerL3Binding}), and stored
 * under the GIT ROOT's `.builderforce/cache/` by both — so the delta's before side IS the indexer's result for the base
 * commit's tree, whichever ran first.
 *
 *   tool · version (the bundled entry; osv: + its database date) · config (where the tool RAN relative to the git root, the
 *   directories it was scoped to, the run context's hash: ignored folders, the layer registry) · inputs (the tool's
 *   declared files on that side) · tree (`scopeTreeHash`: git blob ids of every file under the scope, git-root-relative).
 *
 * The run directory and the scope are part of the key because a tool's findings name paths relative to where it ran: a
 * workspace folder that is a sub-folder of the repository analyzes a different tree, under different names, than a
 * delta run at the repository root — the two never share an entry (and never read each other's as their own).
 */
import * as path from "node:path";
import { dependencyCruiserAnalyzer, dependencyCruiserFindings, jscpdAnalyzer, jscpdFindings, knipAnalyzer, knipFindings, l3CacheKey, okResult, bundledAnalyzers } from "@builderforce/agent-tools";
import { sha256, fileAnalyzerCache } from "./analyzerCache";
import { inputsHash, runContextOf } from "./sideContext";
import { gitRootOf, scopeTreeHash } from "./treeHash";
/** The key of `tool`'s result on one side's tree. */
export async function l3KeyOf(args) {
    const where = JSON.stringify([args.base ?? ".", [...(args.scopes ?? ["."])].sort()]);
    return l3CacheKey({
        tool: args.tool,
        version: (args.entries[args.tool] ?? "") + (args.extra ? `@${args.extra}` : ""),
        config: sha256(`${args.ctx.configHash}\u0000${args.extra ?? ""}\u0000${where}`),
        inputs: await inputsHash(args.ctx, args.side, args.inputs),
        tree: args.tree,
    });
}
/** The bundled analyzers the indexer's pass runs, by name: their declared inputs and their report → result. */
const INDEXER_TOOLS = {
    "dependency-cruiser": { adapter: dependencyCruiserAnalyzer, toResult: (raw) => dependencyCruiserFindings(raw, ".", "after") },
    jscpd: { adapter: jscpdAnalyzer, toResult: (raw) => jscpdFindings(raw, ".", "after") },
    knip: { adapter: knipAnalyzer, toResult: (raw) => knipFindings(raw, "after") },
};
/** Where a folder sits in its repository: the git root, and the folder relative to it (`.` = the root). */
export async function placeInRepository(folder) {
    const gitRoot = await gitRootOf(folder);
    if (!gitRoot)
        return undefined;
    const rel = path.relative(path.resolve(gitRoot), path.resolve(folder)).split(path.sep).join("/");
    return { gitRoot, base: rel === "" ? "." : rel };
}
/**
 * The background indexer's binding to THE L3 cache for a root folder: the store (under the folder's git root), each
 * tool's key on the folder's tree NOW (the tool runs in the folder over all of it), the ignored folders, and the
 * report → result normalization the run delta's adapters use. Outside a repository: no key, so no cache.
 */
export function indexerL3Binding(folder) {
    let ctx;
    const context = () => (ctx ??= runContextOf(folder, { input: { runId: "", mode: "interactive", files: [] }, texts: { before: [], after: [] } }));
    const placed = placeInRepository(folder);
    let store;
    const cache = async () => (store ??= fileAnalyzerCache((await placed)?.gitRoot ?? folder));
    return {
        cache: {
            get: async (key, tool) => (await cache()).get(key, tool),
            put: async (key, entry) => (await cache()).put(key, entry),
        },
        ignored: async () => (await context()).ignored,
        async keyOf(tool) {
            const spec = INDEXER_TOOLS[tool];
            const where = await placed;
            if (!spec || !where)
                return undefined;
            const tree = await scopeTreeHash(where.gitRoot, [where.base]);
            if (!tree)
                return undefined;
            return l3KeyOf({ tool, side: "after", ctx: await context(), entries: { ...(bundledAnalyzers() ?? {}) }, inputs: spec.adapter.inputs, tree, base: where.base });
        },
        toResult: (tool, version, raw) => okResult(tool, version, INDEXER_TOOLS[tool].toResult(raw)),
    };
}
//# sourceMappingURL=l3Binding.js.map
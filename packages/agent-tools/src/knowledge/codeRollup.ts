/**
 * knowledge/codeRollup.ts — the symbol-level edges at FILE level (PRD 43 P0b): the system and module bands of
 * the knowledge view draw composition/association and call links between files without loading one symbol.
 *
 * The stored graph holds files only (symbols would multiply its size), so the class/method edges themselves ride
 * the lazy `symbols` answer (the host resolves {@link extractSymbolRelations} per record). Here every relation
 * whose target another file of the root defines is folded into ONE file → file edge per (target file, kind):
 * `weight` = how many relations of that kind (for `calls`, how many calls in all — `SymbolRelation.count`, not the
 * capped `sites`). A target in the same file is no file edge.
 *
 * Per file, inside the code pack's `extract` (cached by content hash, worker-safe), the ONE resolution happens
 * (`moduleAliases.ts`): a relative import's target is its root-relative path AS WRITTEN (`ctx.resolvePath`; the file's
 * extension is not known to one file), an alias's is the module path the root's aliases name ({@link ModuleResolution}:
 * the review's listing or a worker's disk says which candidate exists), and a package — or an alias of nothing — is
 * `node_modules/<specifier>` ({@link packageModulePath}). {@link repointRollupEdges} — in `buildCodeGraph`, which sees
 * every file — moves each edge to the file its module path names ({@link moduleFileOf}) and drops one that names none.
 * Every host reads the same stored edges, file access or not. Pure.
 */

import { compareStr, isSymbolEdgeKind, srcRef, type Extracted, type KEdge, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { extractSymbols } from '../symbols.js';
import { extractSymbolRelations, type SymbolRelation } from '../symbolRelations.js';
import { packageModulePath, resolveModuleAlias, type ModuleResolution } from './moduleAliases.js';
import { sourcePathOf } from './rootId.js';

/** The file → file rollup edges of one file's relations (see the file comment). */
export function rollupEdges(
    rootId: string, path: string, relations: readonly SymbolRelation[], resolvePath: (fromPath: string, target: string) => string | undefined,
    modules?: ModuleResolution,
): KEdge[] {
    const weights = new Map<string, number>(); // `${to path}\0${kind}`
    const aliased = new Map<string, string>(); // specifier → its module path (or its package path)
    const bare = (module: string): string => {
        let to = aliased.get(module);
        if (to === undefined) {
            to = (modules ? resolveModuleAlias(path, module, modules.aliases, modules.exists) : null) ?? packageModulePath(module);
            aliased.set(module, to);
        }
        return to;
    };
    for (const r of relations) {
        if ('symbol' in r.to) continue;
        const module = r.to.module;
        // A Node builtin is never a module of the root.
        if (module.startsWith('node:')) continue;
        const to = module.startsWith('.') ? resolvePath(path, module) : bare(module);
        if (!to || to === path) continue;
        const key = `${to}\u0000${r.kind}`;
        // Every call counts, not only the sites a relation keeps.
        weights.set(key, (weights.get(key) ?? 0) + (r.count ?? r.sites?.length ?? 1));
    }
    const from = srcRef(rootId, path);
    return [...weights].sort((a, b) => compareStr(a[0], b[0])).map(([key, weight]) => {
        const [to, kind] = key.split('\u0000') as [string, string];
        return { from, to: srcRef(rootId, to), kind, weight, origin: 'extracted' };
    });
}

/**
 * The rollup edges of one source file, from its text. The relations always read the regex extractor's definitions
 * (`extractSymbols`), whatever symbol source the pack was given: the relations contract is that extractor's
 * (members carry their `container`), so a tree-sitter host and a regex host store the same edges.
 */
export function fileRollup(
    rootId: string, path: string, text: string, resolvePath: (fromPath: string, target: string) => string | undefined, modules?: ModuleResolution,
): KEdge[] {
    return rollupEdges(rootId, path, extractSymbolRelations(path, text, extractSymbols(path, text)), resolvePath, modules);
}

const JS_EXT = /\.(?:[cm]?[jt]sx?)$/;
const CANDIDATE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * The file a module path names among `has` (root-relative paths): itself, the TS source of a `.js` import, the path
 * with a source extension, or its `index` file. Undefined when the root holds none.
 */
export function moduleFileOf(modulePath: string, has: (path: string) => boolean): string | undefined {
    return moduleFileCandidates(modulePath).find(has);
}

/** The files a module path may name, in the order {@link moduleFileOf} tries them (a host probing a disk tries the same). */
export function moduleFileCandidates(modulePath: string): string[] {
    const base = modulePath.replace(JS_EXT, '');
    return [
        ...(JS_EXT.test(modulePath) ? [modulePath] : []),
        ...CANDIDATE_EXTS.map((ext) => base + ext),
        ...CANDIDATE_EXTS.map((ext) => `${base}/index${ext}`),
    ].filter((p, i, all) => all.indexOf(p) === i);
}

/** A {@link ModuleResolution} whose `exists` answers from a root's listing (`paths`, root-relative files). */
export function listedModuleResolution(aliases: ModuleResolution['aliases'], paths: ReadonlySet<string>): ModuleResolution {
    return { aliases, exists: (p) => moduleFileOf(p, (f) => paths.has(f)) !== undefined };
}

/**
 * Every rollup edge moved to the file of the root its module path names; one that names no file is dropped (an
 * import of a deleted or generated file is the `references` edges' business, a package is no file). Edges that land on
 * the same (to, kind) add their weights. Other edges, and Extracted without rollup edges, are returned as they were.
 */
export function repointRollupEdges(rootId: string, extracted: readonly Extracted[], paths: ReadonlySet<string>): Extracted[] {
    const has = (p: string): boolean => paths.has(p);
    return extracted.map((e) => {
        if (!e.edges.some((x) => isSymbolEdgeKind(x.kind))) return e;
        const kept: KEdge[] = [];
        const merged = new Map<string, KEdge>();
        for (const x of e.edges) {
            if (!isSymbolEdgeKind(x.kind)) { kept.push(x); continue; }
            const written = sourcePathOf(x.to, rootId);
            const file = written === undefined ? undefined : moduleFileOf(written, has);
            if (!file || srcRef(rootId, file) === x.from) continue;
            const to = srcRef(rootId, file) as NodeRef;
            const key = `${to}\u0000${x.kind}`;
            const prior = merged.get(key);
            if (prior) prior.weight += x.weight;
            else merged.set(key, { ...x, to });
        }
        return { ...e, edges: [...kept, ...merged.values()] };
    });
}

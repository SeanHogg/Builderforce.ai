/**
 * knowledge/facts/resolveFacts.ts — RAW FileFacts → resolved FileFacts against one root LISTING (PRD 41 §B3, §B5, §B8).
 *
 * Extraction never resolves (a file's raw facts depend on its bytes alone). Resolution is a separate, pure step over the
 * listing the facts are read with — the current plan for the index, the BEFORE listing for a run's before side — so the
 * same bytes in two listings resolve to each listing's files, and an index updated incrementally resolves exactly as a
 * scratch build of the same listing does:
 *
 *   - `imports[].resolved`: the root-relative FILE the specifier names in the listing (absent: a package, or nothing);
 *   - `entryPoints[].chain`: raw, `import:<specifier>` of each guard ({@link chainImport}); resolved, the files they name
 *     (unresolved dropped).
 *
 * {@link resolutionKey} is the cheap signature of a resolution: a host re-resolves every file when the listing's path set
 * moves and re-applies only those whose key changed.
 */

import type { FileFacts, MountFact, UseFact } from '@seanhogg/builderforce-memory/knowledge';
import { sortedUnique, type ImportResolver } from './factsAst.js';

/**
 * A RAW guard-chain entry: `import:<specifier>`. Memory's canonical form normalizes chain entries as PATHS (`./auth` would
 * become `auth`, a package); the marker keeps a specifier intact until {@link resolveFileFacts} turns it into a file.
 */
export const CHAIN_IMPORT = 'import:';
export const chainImport = (specifier: string): string => `${CHAIN_IMPORT}${specifier}`;

/**
 * A RAW candidate mount: Express `use('/api', [mw…,] imported)` — the last argument may be a sub-router OR middleware, and
 * only the target's facts can tell. The extractor records it as a mount whose target is `use:{"s":spec,"n":name,"p":path}`;
 * {@link resolveFileFacts} makes it a mount (target = the specifier) when the file it names is a ROUTER module (it declares
 * routes, uses or mounts), else a `use` of `name` at `path`.
 */
export const CANDIDATE_MOUNT = 'use:';
export const candidateMount = (specifier: string, name: string, path: string): string => `${CANDIDATE_MOUNT}${JSON.stringify({ s: specifier, n: name, p: path })}`;
const parseCandidate = (target: string): { s: string; n: string; p: string } | undefined => {
    if (!target.startsWith(CANDIDATE_MOUNT)) return undefined;
    try { return JSON.parse(target.slice(CANDIDATE_MOUNT.length)) as { s: string; n: string; p: string }; } catch { return undefined; }
};

/** Whether facts are a ROUTER module's: it registers routes, `use`s or mounts. */
export const isRouterFacts = (f: FileFacts): boolean =>
    f.entryPoints.some((e) => e.kind === 'http-route' || e.kind === 'ws-handler') || (f.uses?.length ?? 0) > 0 || (f.mounts?.length ?? 0) > 0;

/** Whether raw facts hold a candidate mount (their resolution depends on other files' router-ness). */
export const hasCandidateMounts = (f: FileFacts): boolean => (f.mounts ?? []).some((m) => m.target.startsWith(CANDIDATE_MOUNT));

/** Which files are router modules (the resolver of candidate mounts). Absent ⇒ none: every candidate is middleware. */
export type RouterFiles = (file: string) => boolean;

/** Candidate mounts decided: a mount when the target file is a router module, else a `use` of the binding. */
function decideMounts(path: string, raw: FileFacts, resolve: ImportResolver, isRouterFile?: RouterFiles): Pick<FileFacts, 'mounts' | 'uses'> {
    if (!hasCandidateMounts(raw)) return { ...(raw.mounts ? { mounts: raw.mounts } : {}), ...(raw.uses ? { uses: raw.uses } : {}) };
    const mounts: MountFact[] = [];
    const uses: UseFact[] = [...(raw.uses ?? [])];
    for (const m of raw.mounts ?? []) {
        const c = parseCandidate(m.target);
        if (!c) { mounts.push(m); continue; }
        const file = resolve(path, c.s);
        if (file !== undefined && isRouterFile?.(file)) mounts.push({ ...m, target: c.s });
        else uses.push({ path: c.p, guards: sortedUnique([...(m.guards ?? []), c.n]), order: m.order, ...(m.router !== undefined ? { router: m.router } : {}) });
    }
    return { mounts, uses };
}

/**
 * The facts of `path` with every import and guard-chain specifier resolved by `resolve`, and every candidate mount
 * decided by `isRouterFile` (the target file's own facts).
 */
export function resolveFileFacts(path: string, raw: FileFacts, resolve: ImportResolver, isRouterFile?: RouterFiles): FileFacts {
    return {
        ...raw,
        ...decideMounts(path, raw, resolve, isRouterFile),
        imports: raw.imports.map(({ resolved: _stale, ...i }) => {
            const file = resolve(path, i.specifier);
            return file !== undefined && file !== path ? { ...i, resolved: file } : i;
        }),
        entryPoints: raw.entryPoints.map((e) => ({
            ...e,
            chain: sortedUnique(e.chain.flatMap((s) => {
                if (!s.startsWith(CHAIN_IMPORT)) return [s]; // already a file
                const file = resolve(path, s.slice(CHAIN_IMPORT.length));
                return file !== undefined ? [file] : [];
            })),
        })),
    };
}

/** What resolved facts' resolution came to, as one string (no hashing): equal keys ⇒ equal resolved facts of one raw. */
export function resolvedKey(resolved: FileFacts): string {
    return [
        ...resolved.imports.map((i) => i.resolved ?? ''), ...resolved.entryPoints.map((e) => e.chain.join(',')),
        ...(resolved.mounts ?? []).map((m) => `m${m.order}:${m.target}`), ...(resolved.uses ?? []).map((u) => `u${u.order}`),
    ].join('\u0000');
}

/** What a resolution of `raw` against `resolve` (and `isRouterFile`) comes to ({@link resolvedKey}). */
export function resolutionKey(path: string, raw: FileFacts, resolve: ImportResolver, isRouterFile?: RouterFiles): string {
    return resolvedKey(resolveFileFacts(path, raw, resolve, isRouterFile));
}

/**
 * Resolved facts back to RAW (a fact store holds resolved facts; a host resumes from them): imports lose `resolved`, and
 * each guard-chain file becomes the specifier of the import that resolved to it. Against the same listing,
 * `resolveFileFacts(path, unresolveFileFacts(f), resolve)` is `f` again (a chain specifier that resolved to nothing was
 * already dropped and stays dropped). A candidate mount comes back as DECIDED (a mount or a use): it is re-decided only
 * when its file is re-extracted.
 */
export function unresolveFileFacts(resolved: FileFacts): FileFacts {
    const specifierOf = new Map(resolved.imports.filter((i) => i.resolved !== undefined).map((i) => [i.resolved!, i.specifier] as const));
    return {
        ...resolved,
        imports: resolved.imports.map(({ resolved: _file, ...i }) => i),
        entryPoints: resolved.entryPoints.map((e) => ({ ...e, chain: sortedUnique(e.chain.flatMap((f) => { const s = specifierOf.get(f); return s !== undefined ? [chainImport(s)] : []; })) })),
    };
}

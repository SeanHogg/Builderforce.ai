/**
 * knowledge/moduleAliasLoader.ts — reads a root's alias configs (`tsconfig.json` / `jsconfig.json`, their `extends` and
 * `references`) through a host's read port, and caches them per root ({@link ModuleAliasCache}). The rules are
 * `moduleAliases.ts`'; no `fs` here — a host passes its guarded read (and, for the cache, its stat).
 */
import { ALIAS_CONFIG_FILES, MAX_CONFIG_HOPS, aliasesOf, extendsCandidates, parseConfigText, referenceCandidates, } from './moduleAliases.js';
import { dirOf } from './systemPaths.js';
/** Configs one load parses at most (directories' configs plus `extends` / `references` targets); failed reads do not count. */
export const MAX_ALIAS_CONFIG_READS = 512;
/** Directories probed at once. */
export const ALIAS_PROBE_CONCURRENCY = 16;
/** Every directory above each file, the root ("") included. */
export function ancestorDirs(filePaths) {
    const dirs = new Set();
    for (const p of filePaths) {
        for (let d = dirOf(p.replace(/\\/g, '/')); !dirs.has(d); d = dirOf(d)) {
            dirs.add(d);
            if (d === '')
                break;
        }
    }
    return [...dirs].sort();
}
async function inBatches(items, width, run) {
    let next = 0;
    const lane = async () => { while (next < items.length)
        await run(items[next++]); };
    await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
}
/**
 * The aliases that apply to `filePaths` (root-relative): every directory above each file is probed for a config
 * ({@link ALIAS_CONFIG_FILES}, the first present wins), and every `extends` / `references` target is followed.
 * At most {@link MAX_ALIAS_CONFIG_READS} configs are parsed.
 */
export async function loadModuleAliases(filePaths, read, opts = {}) {
    const configs = new Map();
    const absent = new Set();
    const readConfig = async (path) => {
        if (configs.has(path))
            return configs.get(path);
        if (absent.has(path) || configs.size >= MAX_ALIAS_CONFIG_READS)
            return undefined;
        let text;
        try {
            text = await read(path);
        }
        catch {
            text = undefined;
        }
        const parsed = text === undefined ? undefined : parseConfigText(text);
        if (parsed && configs.size < MAX_ALIAS_CONFIG_READS)
            configs.set(path, parsed);
        else
            absent.add(path);
        return parsed;
    };
    const firstOf = async (candidates) => {
        for (const c of candidates)
            if (await readConfig(c))
                return c;
        return undefined;
    };
    const follow = async (path, depth) => {
        const cfg = configs.get(path);
        if (!cfg || depth >= MAX_CONFIG_HOPS)
            return;
        for (const spec of cfg.extends) {
            const parent = await firstOf(extendsCandidates(path, spec).filter((c) => !configs.has(c)));
            if (parent)
                await follow(parent, depth + 1);
        }
        for (const ref of cfg.references) {
            const target = await firstOf(referenceCandidates(path, ref).filter((c) => !configs.has(c)));
            if (target)
                await follow(target, depth + 1);
        }
    };
    const found = [];
    await inBatches(ancestorDirs(filePaths), opts.concurrency ?? ALIAS_PROBE_CONCURRENCY, async (d) => {
        for (const name of ALIAS_CONFIG_FILES) {
            const path = d ? `${d}/${name}` : name;
            if (opts.listed && !opts.listed.has(path))
                continue;
            if (await readConfig(path)) {
                found.push(path);
                break;
            }
        }
    });
    for (const path of found.sort())
        await follow(path, 0);
    return aliasesOf(configs);
}
/**
 * A root's aliases, loaded once and reused while every config they were read from keeps its modification time; a
 * request naming files in directories not probed yet probes again with them. A config created in a directory already
 * probed is seen on the next change of a known config (or a new instance of the cache).
 */
export class ModuleAliasCache {
    roots = new Map();
    async get(rootKey, filePaths, ports) {
        const dirs = ancestorDirs(filePaths);
        const hit = this.roots.get(rootKey);
        if (hit && dirs.every((d) => hit.dirs.has(d))) {
            const now = await Promise.all([...hit.mtimes.keys()].map(async (p) => [p, await ports.mtime(p).catch(() => undefined)]));
            if (now.every(([p, m]) => hit.mtimes.get(p) === m))
                return hit.aliases;
        }
        const all = new Set([...(hit?.dirs ?? []), ...dirs]);
        // The directories stand in for their files: probing `<dir>/x` probes `dir` and every directory above it.
        const aliases = await loadModuleAliases([...all].map((d) => (d ? `${d}/_` : '_')), ports.read);
        const mtimes = new Map();
        await Promise.all((aliases.configs ?? []).map(async (p) => { mtimes.set(p, await ports.mtime(p).catch(() => undefined)); }));
        this.roots.set(rootKey, { aliases, dirs: all, mtimes });
        return aliases;
    }
    /** Forgets a root (its configs changed, say a watcher). */
    forget(rootKey) {
        this.roots.delete(rootKey);
    }
    /** Forgets every root whose key is a `/`-separated path holding `path` (an alias config a watcher saw change). */
    forgetContaining(path) {
        for (const key of [...this.roots.keys()])
            if (path === key || path.startsWith(`${key.replace(/\/$/, '')}/`))
                this.roots.delete(key);
    }
}
//# sourceMappingURL=moduleAliasLoader.js.map
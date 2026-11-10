/**
 * knowledge/moduleAliasLoader.ts — reads a root's alias configs (`tsconfig.json` / `jsconfig.json`, their `extends` and
 * `references`) through a host's read port, and caches them per root ({@link ModuleAliasCache}). The rules are
 * `moduleAliases.ts`'; no `fs` here — a host passes its guarded read (and, for the cache, its stat).
 */

import {
    ALIAS_CONFIG_FILES, MAX_CONFIG_HOPS, aliasesOf, dirOf, extendsCandidates, parseConfigText, referenceCandidates,
    type ModuleAliases, type ParsedAliasConfig,
} from './moduleAliases.js';

/** Reads a root-relative file's text; undefined when it is absent or unreadable. */
export type ReadConfigText = (path: string) => Promise<string | undefined>;

/** Configs one load parses at most (directories' configs plus `extends` / `references` targets); failed reads do not count. */
export const MAX_ALIAS_CONFIG_READS = 512;
/** Directories probed at once. */
export const ALIAS_PROBE_CONCURRENCY = 16;

/** Every directory above each file, the root ("") included. */
export function ancestorDirs(filePaths: Iterable<string>): string[] {
    const dirs = new Set<string>();
    for (const p of filePaths) {
        for (let d = dirOf(p.replace(/\\/g, '/')); !dirs.has(d); d = dirOf(d)) {
            dirs.add(d);
            if (d === '') break;
        }
    }
    return [...dirs].sort();
}

async function inBatches<T>(items: readonly T[], width: number, run: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const lane = async (): Promise<void> => { while (next < items.length) await run(items[next++]!); };
    await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
}

export interface LoadAliasOptions {
    /** The root's files, when the host lists them: only directories' configs in it are probed (an `extends` / `references` target is read either way). */
    listed?: ReadonlySet<string>;
    concurrency?: number;
}

/**
 * The aliases that apply to `filePaths` (root-relative): every directory above each file is probed for a config
 * ({@link ALIAS_CONFIG_FILES}, the first present wins), and every `extends` / `references` target is followed.
 * At most {@link MAX_ALIAS_CONFIG_READS} configs are parsed.
 */
export async function loadModuleAliases(filePaths: Iterable<string>, read: ReadConfigText, opts: LoadAliasOptions = {}): Promise<ModuleAliases> {
    const configs = new Map<string, ParsedAliasConfig>();
    const absent = new Set<string>();
    const readConfig = async (path: string): Promise<ParsedAliasConfig | undefined> => {
        if (configs.has(path)) return configs.get(path);
        if (absent.has(path) || configs.size >= MAX_ALIAS_CONFIG_READS) return undefined;
        let text: string | undefined;
        try { text = await read(path); } catch { text = undefined; }
        const parsed = text === undefined ? undefined : parseConfigText(text);
        if (parsed && configs.size < MAX_ALIAS_CONFIG_READS) configs.set(path, parsed);
        else absent.add(path);
        return parsed;
    };
    const firstOf = async (candidates: readonly string[]): Promise<string | undefined> => {
        for (const c of candidates) if (await readConfig(c)) return c;
        return undefined;
    };
    const follow = async (path: string, depth: number): Promise<void> => {
        const cfg = configs.get(path);
        if (!cfg || depth >= MAX_CONFIG_HOPS) return;
        for (const spec of cfg.extends) {
            const parent = await firstOf(extendsCandidates(path, spec).filter((c) => !configs.has(c)));
            if (parent) await follow(parent, depth + 1);
        }
        for (const ref of cfg.references) {
            const target = await firstOf(referenceCandidates(path, ref).filter((c) => !configs.has(c)));
            if (target) await follow(target, depth + 1);
        }
    };
    const found: string[] = [];
    await inBatches(ancestorDirs(filePaths), opts.concurrency ?? ALIAS_PROBE_CONCURRENCY, async (d) => {
        for (const name of ALIAS_CONFIG_FILES) {
            const path = d ? `${d}/${name}` : name;
            if (opts.listed && !opts.listed.has(path)) continue;
            if (await readConfig(path)) { found.push(path); break; }
        }
    });
    for (const path of found.sort()) await follow(path, 0);
    return aliasesOf(configs);
}

/** What the cache needs of a root's disk: a config's text, and its modification time (undefined when it is gone). */
export interface AliasConfigPorts {
    read: ReadConfigText;
    mtime(path: string): Promise<number | undefined>;
}

/**
 * A root's aliases, loaded once and reused while every config they were read from keeps its modification time; a
 * request naming files in directories not probed yet probes again with them. A config created in a directory already
 * probed is seen on the next change of a known config (or a new instance of the cache).
 */
export class ModuleAliasCache {
    private readonly roots = new Map<string, { aliases: ModuleAliases; dirs: Set<string>; mtimes: Map<string, number | undefined> }>();

    async get(rootKey: string, filePaths: readonly string[], ports: AliasConfigPorts): Promise<ModuleAliases> {
        const dirs = ancestorDirs(filePaths);
        const hit = this.roots.get(rootKey);
        if (hit && dirs.every((d) => hit.dirs.has(d))) {
            const now = await Promise.all([...hit.mtimes.keys()].map(async (p) => [p, await ports.mtime(p).catch(() => undefined)] as const));
            if (now.every(([p, m]) => hit.mtimes.get(p) === m)) return hit.aliases;
        }
        const all = new Set([...(hit?.dirs ?? []), ...dirs]);
        // The directories stand in for their files: probing `<dir>/x` probes `dir` and every directory above it.
        const aliases = await loadModuleAliases([...all].map((d) => (d ? `${d}/_` : '_')), ports.read);
        const mtimes = new Map<string, number | undefined>();
        await Promise.all((aliases.configs ?? []).map(async (p) => { mtimes.set(p, await ports.mtime(p).catch(() => undefined)); }));
        this.roots.set(rootKey, { aliases, dirs: all, mtimes });
        return aliases;
    }

    /** Forgets a root (its configs changed, say a watcher). */
    forget(rootKey: string): void {
        this.roots.delete(rootKey);
    }

    /** Forgets every root whose key is a `/`-separated path holding `path` (an alias config a watcher saw change). */
    forgetContaining(path: string): void {
        for (const key of [...this.roots.keys()]) if (path === key || path.startsWith(`${key.replace(/\/$/, '')}/`)) this.roots.delete(key);
    }
}

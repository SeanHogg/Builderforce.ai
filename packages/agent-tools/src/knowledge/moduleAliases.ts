/**
 * knowledge/moduleAliases.ts — THE resolution of an import specifier to a root-relative module path (PRD 43 P0b):
 * a relative import (`./repo.js`) by memory's `resolveRelativePath`, a path alias (`@/lib/auth`, `@shared/x`) by the
 * root's `tsconfig.json` / `jsconfig.json` `compilerOptions.paths` and `baseUrl`.
 *
 * ONE resolution, at EXTRACT time: the code pack's per-file extract (`codeRollup` `rollupEdges`) resolves an alias where
 * the files exist (the review's listing, a worker's disk) and stores the resolved root path; every host then reads the
 * same stored edges. The VS Code symbols answer probes the SAME ordered candidates ({@link aliasCandidates}) on disk.
 *
 * Rules (TypeScript's, the subset a map needs):
 *   - the NEAREST config above a file is the file's config (a nested workspace's tsconfig wins over the root's, even
 *     when it declares no `paths`); a solution-style config (`files: []` + `references`) without `paths` of its own takes
 *     them from the first referenced project that has some (the Vite template: `tsconfig.json` → `tsconfig.app.json`);
 *   - `extends` is followed for a relative path and for a package inside the root (`node_modules/<pkg>` looked up from
 *     the config's directory upwards: a workspace package linked there), a child's `paths` / `baseUrl` replacing its parent's;
 *   - `paths` targets resolve against `baseUrl` when the chain sets one, else against the directory of the config that
 *     declares `paths`; `baseUrl` itself against the config that declares it;
 *   - candidates, in order: an exact pattern, then wildcards by longest prefix, each pattern's targets in its order, then
 *     `<baseUrl>/<specifier>`; the first that names a module of the root wins. Without a way to ask which exist, only
 *     the first pattern target is taken (never `baseUrl`, which would make every package a root path).
 * Configs are JSONC: comments and trailing commas are stripped before parsing; one that still does not parse is ignored.
 * Pure: the loader that reads configs is `moduleAliasLoader.ts`.
 */

import { resolveRelativePath } from '@seanhogg/builderforce-memory/knowledge';

/** The file names a directory's config is read from, in order (the first one present wins). */
export const ALIAS_CONFIG_FILES = ['tsconfig.json', 'jsconfig.json'] as const;
/** How many `extends` / `references` hops are followed before a chain is cut (a cycle ends sooner). */
export const MAX_CONFIG_HOPS = 8;

/** Whether a root-relative path is a directory's alias config ({@link ALIAS_CONFIG_FILES}). */
export const isAliasConfigPath = (path: string): boolean =>
    (ALIAS_CONFIG_FILES as readonly string[]).includes(path.slice(path.lastIndexOf('/') + 1));

/**
 * The root-relative path the rollup gives an import of a package or an unresolved alias: `node_modules/<specifier>`
 * (the VS Code symbols answer names a package target under the same directory). No code file of a root lives there.
 */
export const PACKAGE_MODULE_DIR = 'node_modules/';

/** `node_modules/<specifier>` for a bare specifier. */
export const packageModulePath = (specifier: string): string => `${PACKAGE_MODULE_DIR}${specifier}`;

/** One `paths` entry: `prefix*suffix` (or the exact `prefix` when not a wildcard) → root-relative targets (`*` kept). */
export interface AliasPattern {
    prefix: string;
    suffix: string;
    wildcard: boolean;
    targets: string[];
}

/** The aliases of the files under one config's directory (`dir`, root-relative, "" = the root). */
export interface AliasScope {
    dir: string;
    /** Root-relative `baseUrl`, when the chain sets one. */
    baseUrl?: string;
    patterns: AliasPattern[];
}

/** A root's alias scopes, the deepest directory first (so the first scope that holds a file is its nearest config). */
export interface ModuleAliases {
    scopes: AliasScope[];
    /** The config files the aliases were read from (a host cache re-stats exactly these). */
    configs?: string[];
}

export const NO_MODULE_ALIASES: ModuleAliases = { scopes: [] };

/** What an extract needs to resolve an alias: the root's aliases and, where the files are known, which modules exist. */
export interface ModuleResolution {
    aliases: ModuleAliases;
    /** Whether a root-relative module path names a module of the root (a file under one of its spellings). */
    exists?: (modulePath: string) => boolean;
}

/** What a config says, as far as resolution goes. */
export interface ParsedAliasConfig {
    extends: string[];
    references: string[];
    baseUrl?: string;
    paths?: Record<string, string[]>;
}

export const dirOf = (path: string): string => {
    const i = path.lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i);
};

/** `base` joined with `rel`, `.` and `..` folded; undefined when it leaves the root. */
export function joinRootPath(base: string, rel: string): string | undefined {
    const out: string[] = base ? base.split('/').filter(Boolean) : [];
    for (const seg of rel.replace(/\\/g, '/').split('/')) {
        if (!seg || seg === '.') continue;
        if (seg === '..') {
            if (out.length === 0) return undefined;
            out.pop();
        } else out.push(seg);
    }
    return out.join('/');
}

/** JSONC → JSON: comments and trailing commas removed, string contents untouched. */
function stripJsonc(text: string): string {
    let out = '';
    for (let i = 0; i < text.length; i += 1) {
        const c = text[i]!, n = text[i + 1];
        if (c === '"') {
            let j = i + 1;
            while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
            out += text.slice(i, j + 1);
            i = j;
        } else if (c === '/' && n === '/') {
            while (i < text.length && text[i] !== '\n') i += 1;
            out += '\n';
        } else if (c === '/' && n === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end < 0 ? text.length : end + 1;
        } else out += c;
    }
    return out.replace(/,(\s*[}\]])/g, '$1');
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);

/** A config's text, parsed; undefined when it is not an object even as JSONC. */
export function parseConfigText(text: string): ParsedAliasConfig | undefined {
    let value: unknown;
    try { value = JSON.parse(stripJsonc(text.replace(/^﻿/, ''))); } catch { return undefined; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const v = value as { extends?: unknown; references?: unknown; compilerOptions?: { baseUrl?: unknown; paths?: unknown } };
    const references = Array.isArray(v.references)
        ? v.references.flatMap((r) => (r && typeof r === 'object' && typeof (r as { path?: unknown }).path === 'string' ? [(r as { path: string }).path] : []))
        : [];
    const out: ParsedAliasConfig = { extends: strings(v.extends), references };
    const co = v.compilerOptions;
    if (co && typeof co === 'object') {
        if (typeof co.baseUrl === 'string') out.baseUrl = co.baseUrl;
        if (co.paths && typeof co.paths === 'object' && !Array.isArray(co.paths)) {
            const paths: Record<string, string[]> = {};
            for (const [k, t] of Object.entries(co.paths as Record<string, unknown>)) paths[k] = strings(t);
            out.paths = paths;
        }
    }
    return out;
}

/** The root-relative configs an `extends` may name from the config at `from`, in lookup order. */
export function extendsCandidates(from: string, spec: string): string[] {
    const withJson = (p: string): string[] => (/\.json$/i.test(p) ? [p] : [`${p}.json`, `${p}/tsconfig.json`]);
    if (spec.startsWith('.')) {
        const joined = joinRootPath(dirOf(from), spec);
        return joined === undefined ? [] : withJson(joined);
    }
    if (spec.startsWith('/')) return [];
    // A package: `node_modules/<spec>` from the config's directory up to the root (a workspace package linked there).
    const out: string[] = [];
    for (let d = dirOf(from); ; d = dirOf(d)) {
        out.push(...withJson(d ? `${d}/node_modules/${spec}` : `node_modules/${spec}`));
        if (!d) break;
    }
    return out;
}

/** The root-relative config a `references[].path` names (a directory means its `tsconfig.json`). */
export function referenceCandidates(from: string, ref: string): string[] {
    const joined = joinRootPath(dirOf(from), ref);
    if (joined === undefined) return [];
    return /\.json$/i.test(joined) ? [joined] : [`${joined}/tsconfig.json`, `${joined}.json`];
}

interface Chain { baseUrl?: string; paths?: { from: string; map: Record<string, string[]> } }

/**
 * The alias scopes of a root from its configs (root-relative path → parsed config), each directory's config being the
 * one {@link ALIAS_CONFIG_FILES} names first. `extends` and `references` targets must be among `configs` to be followed.
 */
export function aliasesOf(configs: ReadonlyMap<string, ParsedAliasConfig>): ModuleAliases {
    const present = (candidates: readonly string[]): string | undefined => candidates.find((c) => configs.has(c));
    // Never memoized inside a walk: a cycle cuts the walk short, and that partial answer must not be cached for another start.
    const chain = (path: string, seen: ReadonlySet<string>): Chain => {
        const cfg = configs.get(path);
        if (!cfg || seen.has(path) || seen.size > MAX_CONFIG_HOPS) return {};
        const next = new Set(seen).add(path);
        let out: Chain = {};
        // Later `extends` entries override earlier ones; the config itself overrides them all.
        for (const spec of cfg.extends) {
            const parent = present(extendsCandidates(path, spec));
            if (parent) out = { ...out, ...chain(parent, next) };
        }
        if (cfg.baseUrl !== undefined) {
            const base = joinRootPath(dirOf(path), cfg.baseUrl);
            if (base !== undefined) out = { ...out, baseUrl: base };
        }
        if (cfg.paths) out = { ...out, paths: { from: dirOf(path), map: cfg.paths } };
        if (!out.paths) {
            // Solution style: the first referenced project with `paths` lends its own (its baseUrl with them).
            for (const ref of cfg.references) {
                const target = present(referenceCandidates(path, ref));
                const lent = target ? chain(target, next) : {};
                if (lent.paths) { out = { ...out, paths: lent.paths, ...(lent.baseUrl !== undefined ? { baseUrl: lent.baseUrl } : {}) }; break; }
            }
        }
        return out;
    };
    const byDir = new Map<string, string>();
    for (const path of [...configs.keys()].sort()) {
        const rank = (ALIAS_CONFIG_FILES as readonly string[]).indexOf(path.slice(path.lastIndexOf('/') + 1));
        if (rank < 0 || path.split('/').includes('node_modules')) continue;
        const dir = dirOf(path);
        const prior = byDir.get(dir);
        if (!prior || (ALIAS_CONFIG_FILES as readonly string[]).indexOf(prior.slice(prior.lastIndexOf('/') + 1)) > rank) byDir.set(dir, path);
    }
    const scopes: AliasScope[] = [];
    for (const [dir, path] of byDir) {
        const c = chain(path, new Set());
        const patterns: AliasPattern[] = [];
        if (c.paths) {
            const base = c.baseUrl ?? c.paths.from;
            for (const [key, targets] of Object.entries(c.paths.map)) {
                const star = key.indexOf('*');
                const roots = targets.map((t) => joinRootPath(base, t)).filter((t): t is string => t !== undefined);
                if (roots.length === 0) continue;
                patterns.push(star < 0
                    ? { prefix: key, suffix: '', wildcard: false, targets: roots }
                    : { prefix: key.slice(0, star), suffix: key.slice(star + 1), wildcard: true, targets: roots });
            }
        }
        scopes.push({ dir, ...(c.baseUrl !== undefined ? { baseUrl: c.baseUrl } : {}), patterns });
    }
    const depth = (d: string): number => (d ? d.split('/').length : 0);
    scopes.sort((a, b) => depth(b.dir) - depth(a.dir) || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
    return { scopes, configs: [...configs.keys()].sort() };
}

/** The scope of the config nearest above `fromPath`. */
const scopeOf = (fromPath: string, aliases: ModuleAliases): AliasScope | undefined =>
    aliases.scopes.find((s) => s.dir === '' || fromPath.startsWith(`${s.dir}/`));

/** The matching patterns of a scope, in precedence order: an exact match first, then wildcards by longest prefix. */
function matching(scope: AliasScope, specifier: string): Array<{ pattern: AliasPattern; star: string }> {
    const exact = scope.patterns.filter((p) => !p.wildcard && p.prefix === specifier).map((pattern) => ({ pattern, star: '' }));
    const wild = scope.patterns
        .filter((p) => p.wildcard && specifier.length >= p.prefix.length + p.suffix.length && specifier.startsWith(p.prefix) && specifier.endsWith(p.suffix))
        .sort((a, b) => b.prefix.length - a.prefix.length)
        .map((pattern) => ({ pattern, star: specifier.slice(pattern.prefix.length, specifier.length - pattern.suffix.length) }));
    return [...exact, ...wild];
}

/**
 * THE ordered candidates an alias may name from `fromPath`: each matching pattern's targets (an exact pattern first, then
 * wildcards by longest prefix, each pattern's targets in its order), then `<baseUrl>/<specifier>`. Empty for a relative
 * specifier, or when the nearest config maps nothing. {@link resolveModuleAlias} and a host's disk probe both iterate it.
 */
export function aliasCandidates(fromPath: string, specifier: string, aliases: ModuleAliases): string[] {
    if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return [];
    const scope = scopeOf(fromPath, aliases);
    if (!scope) return [];
    const out: string[] = [];
    for (const { pattern, star } of matching(scope, specifier)) {
        for (const t of pattern.targets) {
            const p = joinRootPath('', t.replace('*', star));
            if (p && !out.includes(p)) out.push(p);
        }
    }
    if (scope.baseUrl !== undefined) {
        const under = joinRootPath(scope.baseUrl, specifier);
        if (under && !out.includes(under)) out.push(under);
    }
    return out;
}

/** Whether the nearest config of `fromPath` maps `specifier` by a `paths` pattern (not merely by `baseUrl`). */
export function isAliasSpecifier(fromPath: string, specifier: string, aliases: ModuleAliases): boolean {
    const scope = scopeOf(fromPath, aliases);
    return !!scope && matching(scope, specifier).length > 0;
}

/**
 * The root-relative module path `specifier` names from `fromPath` through the root's path aliases, or null — a package.
 * With `exists`, the first {@link aliasCandidates} entry that names a module of the root (falling through to `baseUrl`);
 * without it, the first pattern target.
 */
export function resolveModuleAlias(
    fromPath: string, specifier: string, aliases: ModuleAliases, exists?: (modulePath: string) => boolean,
): string | null {
    const candidates = aliasCandidates(fromPath, specifier, aliases);
    if (exists) return candidates.find(exists) ?? null;
    return isAliasSpecifier(fromPath, specifier, aliases) ? candidates[0] ?? null : null;
}

/**
 * THE root-relative module path an import names from `fromPath`: a relative import resolved against the importing file,
 * else an alias of the root ({@link resolveModuleAlias}). Undefined for a package, an alias that names nothing, or a
 * relative path that leaves the root.
 */
export function resolveImportPath(
    fromPath: string, specifier: string, aliases: ModuleAliases = NO_MODULE_ALIASES, exists?: (modulePath: string) => boolean,
): string | undefined {
    if (specifier.startsWith('.')) return resolveRelativePath(fromPath, specifier);
    return resolveModuleAlias(fromPath, specifier, aliases, exists) ?? undefined;
}

/** A stable digest of a root's aliases: equal for equal resolution rules (the extract cache may key on it). */
export function moduleAliasesDigest(aliases: ModuleAliases): string {
    const text = JSON.stringify(aliases.scopes);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return `${aliases.scopes.length}:${h.toString(16)}`;
}

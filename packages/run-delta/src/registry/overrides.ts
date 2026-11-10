/**
 * registry/overrides.ts — merges a repo's parsed `.builderforce/delta.json` (passed in as DATA; this
 * package never reads a file) over the built-in {@link DeltaRegistries}.
 *
 * The shape is validated; unknown keys and invalid entries are DROPPED and reported as codes
 * (`unknown-key:<k>`, `invalid:<k>` / `invalid:<k>.<entry>`), never thrown, so a bad repo file degrades
 * to the defaults instead of failing a run's finalization.
 *
 * Merge: `guards` per name (the repo's rank wins); `capabilities` per capability (union);
 * `weakCrypto`, `io`, `suppressions`, `blocking` union (built-ins first); `matchers` replaces the
 * whole class list (strength classes cannot be merged without reordering them).
 */

import type { DeltaRegistries } from '../contract.js';

export interface OverrideResult {
    registries: DeltaRegistries;
    /** Sorted codes of what was ignored. */
    dropped: string[];
}

const KNOWN_KEYS: ReadonlySet<string> = new Set(['guards', 'capabilities', 'weakCrypto', 'io', 'suppressions', 'matchers', 'blocking']);
const REGEX_KEYS: ReadonlySet<string> = new Set(['weakCrypto', 'io']);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0);

function compiles(source: string): boolean {
    try {
        new RegExp(source);
        return true;
    } catch {
        return false;
    }
}

const union = (base: readonly string[], extra: readonly string[]): string[] => [...new Set([...base, ...extra])];

export function withOverrides(base: DeltaRegistries, raw: unknown): OverrideResult {
    const dropped: string[] = [];
    if (raw === undefined || raw === null) return { registries: base, dropped };
    if (!isRecord(raw)) return { registries: base, dropped: ['invalid:root'] };

    const next: { -readonly [K in keyof DeltaRegistries]: DeltaRegistries[K] } = { ...base };
    for (const key of Object.keys(raw).sort()) {
        const value = raw[key];
        if (!KNOWN_KEYS.has(key)) { dropped.push(`unknown-key:${key}`); continue; }

        if (key === 'guards') {
            if (!isRecord(value)) { dropped.push('invalid:guards'); continue; }
            const guards: Record<string, number> = { ...base.guards };
            for (const [name, rank] of Object.entries(value)) {
                if (typeof rank === 'number' && Number.isFinite(rank) && name.length > 0) guards[name] = rank;
                else dropped.push(`invalid:guards.${name}`);
            }
            next.guards = guards;
        } else if (key === 'capabilities') {
            if (!isRecord(value)) { dropped.push('invalid:capabilities'); continue; }
            const caps: Record<string, readonly string[]> = { ...base.capabilities };
            for (const [cap, entries] of Object.entries(value)) {
                if (isStringList(entries)) caps[cap] = union(base.capabilities[cap] ?? [], entries);
                else dropped.push(`invalid:capabilities.${cap}`);
            }
            next.capabilities = caps;
        } else if (key === 'matchers') {
            if (Array.isArray(value) && value.length > 0 && value.every(isStringList)) next.matchers = value.map((c) => [...c]);
            else dropped.push('invalid:matchers');
        } else {
            const listKey = key as 'weakCrypto' | 'io' | 'suppressions' | 'blocking';
            if (!isStringList(value)) { dropped.push(`invalid:${key}`); continue; }
            const valid = REGEX_KEYS.has(key) ? value.filter((s) => compiles(s) || (dropped.push(`invalid:${key}.${s}`), false)) : value;
            next[listKey] = union(base[listKey], valid);
        }
    }
    return { registries: next, dropped: [...new Set(dropped)].sort() };
}

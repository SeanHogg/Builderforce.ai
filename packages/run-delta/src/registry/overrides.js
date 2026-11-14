/**
 * registry/overrides.ts — merges a repo's parsed `.builderforce/delta.json` (passed in as DATA; this
 * package never reads a file) over the built-in {@link DeltaRegistries}.
 *
 * SECURITY: the host MUST pass the BEFORE side's file (the baseline), never the working tree's — a run
 * must not weaken its own gate; editing the file in a run is the blocking `delta-config-changed` finding.
 *
 * The shape is validated; unknown keys and invalid entries are DROPPED and reported as codes
 * (`unknown-key:<k>`, `invalid:<k>` / `invalid:<k>.<entry>`, `unsafe-regex:<k>.<reason>`), never thrown,
 * so a bad repo file degrades to the defaults instead of failing a run's finalization. Repo regexes must
 * pass {@link unsafeRegex} (length, star height, no quantified alternation, no back-references).
 * `benchmarks` and `dynamic` are accepted and reserved for the dynamic tier (C6.2, C8.4; parsed by
 * `dynamic/schedule.ts` `dynamicPolicyOf`); they do not change the registries.
 *
 * Merge: `guards` per name (the repo's rank wins); `capabilities`, `taintSources`, `taintSinks`,
 * `taintSanitizers` (call forms only, by sink kind or `*`), `insecureConfig` (regexes, gated like `io`) and
 * `strideCoverage` (STRIDE categories → identifiers) per group (union; at most {@link MAX_OVERRIDE_GROUPS}
 * groups of {@link MAX_OVERRIDE_ENTRIES} entries, each ≤ 120 chars); `weakCrypto`, `io`, `suppressions`,
 * `blocking` union (built-ins first, at most {@link MAX_OVERRIDE_ENTRIES}); `matchers` replaces the
 * whole class list (strength classes cannot be merged without reordering them); `cacheable.reads` /
 * `cacheable.readThrough` union per list.
 */
import { unsafeRegex } from './safeRegex.js';
import { STRIDE_CATEGORIES } from './stride.js';
const KNOWN_KEYS = new Set([
    'guards', 'capabilities', 'weakCrypto', 'io', 'suppressions', 'matchers', 'blocking',
    'taintSources', 'taintSinks', 'taintSanitizers', 'insecureConfig', 'strideCoverage',
    'cacheable',
]);
/** Accepted, validated elsewhere (C6.2 benchmarks), not merged into the registries. */
const RESERVED_KEYS = new Set(['benchmarks', 'dynamic']);
const REGEX_KEYS = new Set(['weakCrypto', 'io']);
const GROUP_KEYS = new Set(['capabilities', 'taintSources', 'taintSinks', 'taintSanitizers', 'insecureConfig', 'strideCoverage']);
/** Literal entry forms are text, never compiled as given; this bounds what one scan alternation holds. */
const MAX_ENTRY_LENGTH = 120;
/** Groups one override key may add, and entries one group may add: a repo file cannot balloon a scan. */
export const MAX_OVERRIDE_GROUPS = 32;
export const MAX_OVERRIDE_ENTRIES = 64;
const STRIDE_KEYS = new Set(STRIDE_CATEGORIES);
const IDENT = /^[A-Za-z_$][\w$]*$/;
/** A sanitizer is a call: `name(` or `.name(` (a member path allowed), nothing else. */
const CALL_FORM = /^\.?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\($/;
const GROUP_NAME = /^(?:\*|[A-Za-z0-9_-]{1,40})$/;
/** Per-group validation of one override group's entries; `undefined` = the whole group is invalid. */
function validGroup(key, group, entries, dropped) {
    if (!isStringList(entries) || entries.length > MAX_OVERRIDE_ENTRIES || !GROUP_NAME.test(group))
        return undefined;
    if (!entries.every((e) => e.length <= MAX_ENTRY_LENGTH))
        return undefined;
    if (key === 'strideCoverage')
        return STRIDE_KEYS.has(group) && entries.every((e) => IDENT.test(e)) ? entries : undefined;
    if (key === 'taintSanitizers')
        return entries.every((e) => CALL_FORM.test(e)) ? entries : undefined;
    if (key === 'insecureConfig') {
        return entries.filter((s) => { const why = unsafeRegex(s); if (why)
            dropped.push(`unsafe-regex:${key}.${why}`); return !why; });
    }
    return entries;
}
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0);
const union = (base, extra) => [...new Set([...base, ...extra])];
export function withOverrides(base, raw) {
    const dropped = [];
    if (raw === undefined || raw === null)
        return { registries: base, dropped };
    if (!isRecord(raw))
        return { registries: base, dropped: ['invalid:root'] };
    const next = { ...base };
    for (const key of Object.keys(raw).sort()) {
        const value = raw[key];
        if (RESERVED_KEYS.has(key))
            continue;
        if (!KNOWN_KEYS.has(key)) {
            dropped.push(`unknown-key:${key}`);
            continue;
        }
        if (key === 'guards') {
            if (!isRecord(value)) {
                dropped.push('invalid:guards');
                continue;
            }
            const guards = { ...base.guards };
            for (const [name, rank] of Object.entries(value)) {
                if (typeof rank === 'number' && Number.isFinite(rank) && /^[A-Za-z_$][\w$]*$/.test(name))
                    guards[name] = rank;
                else
                    dropped.push(`invalid:guards.${name}`);
            }
            next.guards = guards;
        }
        else if (key === 'cacheable') {
            // `{ reads?: name[], readThrough?: name[] }`, each list unioned over the built-ins; names are identifiers.
            if (!isRecord(value)) {
                dropped.push('invalid:cacheable');
                continue;
            }
            const merged = { reads: [...base.cacheable.reads], readThrough: [...base.cacheable.readThrough] };
            for (const [list, names] of Object.entries(value)) {
                if ((list === 'reads' || list === 'readThrough') && isStringList(names) && names.every((n) => IDENT.test(n)))
                    merged[list] = union(merged[list], names);
                else
                    dropped.push(`invalid:cacheable.${list}`);
            }
            next.cacheable = merged;
        }
        else if (GROUP_KEYS.has(key)) {
            const groupKey = key;
            if (!isRecord(value)) {
                dropped.push(`invalid:${key}`);
                continue;
            }
            const baseGroups = base[groupKey];
            const groups = { ...baseGroups };
            const entriesOf = Object.entries(value);
            if (entriesOf.length > MAX_OVERRIDE_GROUPS) {
                dropped.push(`invalid:${key}`);
                continue;
            }
            for (const [group, entries] of entriesOf) {
                const valid = validGroup(groupKey, group, entries, dropped);
                if (valid)
                    groups[group] = union(baseGroups[group] ?? [], valid);
                else
                    dropped.push(`invalid:${key}.${group}`);
            }
            next[groupKey] = groups;
        }
        else if (key === 'matchers') {
            if (Array.isArray(value) && value.length > 0 && value.every(isStringList))
                next.matchers = value.map((c) => [...c]);
            else
                dropped.push('invalid:matchers');
        }
        else {
            const listKey = key;
            if (!isStringList(value) || value.length > MAX_OVERRIDE_ENTRIES) {
                dropped.push(`invalid:${key}`);
                continue;
            }
            const valid = REGEX_KEYS.has(key)
                ? value.filter((s) => { const why = unsafeRegex(s); if (why)
                    dropped.push(`unsafe-regex:${key}.${why}`); return !why; })
                : value;
            next[listKey] = union(base[listKey], valid);
        }
    }
    return { registries: next, dropped: [...new Set(dropped)].sort() };
}
//# sourceMappingURL=overrides.js.map
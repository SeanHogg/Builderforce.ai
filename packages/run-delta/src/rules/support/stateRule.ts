/**
 * rules/support/stateRule.ts — the shape most text rules share: find occurrences on EACH side, anchor
 * each on `<path>#<key>` plus the normalized MATCHED SPAN (not the whole line: an unrelated edit on the
 * same line keeps the identity), and let the engine's lineage turn "present after, absent before" into
 * `introduced`. Moving a line keeps its identity (no line numbers in the anchor).
 *
 * Every string a hit contributes — the span, the line, the key, string params — is REDACTED before it
 * reaches an anchor, a snippet, a note or a param, whatever the rule.
 *
 * Linear: hits are grouped by key FIRST (each distinct key redacted once); a key over
 * {@link MAX_HITS_PER_KEY} becomes one aggregate finding from its count and earliest hit, and only the
 * keys at or under the cap are sorted and turned into findings.
 */

import type { DeltaRule, Evidence, RuleFinding, RuleInput, Severity } from '../../contract.js';
import { lineStarts } from '../../engine/text.js';
import { filePairs, redact, squash, type TextView } from './files.js';
import { heuristicFinding, Ordinals, ruleIdentity } from './identity.js';

export interface Hit {
    /** Character offset of the occurrence in the side's text. */
    offset: number;
    /** Length of the matched span (what the anchor hashes). */
    length: number;
    /** What occurred (a capability, a marker, a call name): part of the anchor and the evidence note. */
    key: string;
    params?: Record<string, string | number>;
    /** How many occurrences this hit stands for (default 1): a capped producer folds the overflow into one hit. */
    count?: number;
}

export interface StateRuleSpec {
    files(path: string): boolean;
    hits(view: TextView, input: RuleInput): Hit[];
    severity: Severity;
    /** `line` (default): one finding per occurrence; `file`: one per (file, key), anchored without a snippet. */
    granularity?: 'line' | 'file';
    /**
     * Params added to every NON-aggregated finding of one side of a file (e.g. the C5.7 STRIDE checklist),
     * computed lazily: at most once per side, and never when every key of the side aggregated.
     */
    fileParams?(view: TextView, input: RuleInput): Record<string, string | number>;
}

const MAX_SNIPPET = 200;
/** Longest span an anchor hashes; a longer match is cut (identity only, never a line count). */
const MAX_SPAN = 400;

const redactParams = (p: Record<string, string | number> | undefined): Record<string, string | number> =>
    Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k, typeof v === 'string' ? redact(v) : v]));

/**
 * More occurrences of one key in one file than this, on either side, are reported as ONE aggregate
 * finding per side (`params.count`, `params.aggregated: 1`): it persists while the count does not grow
 * and reads as `changed` when it does. A generated or vendored file never floods a delta.
 */
export const MAX_HITS_PER_KEY = 100;

function evidenceOf(side: 'before' | 'after', view: TextView, hit: Hit, key: string): Evidence {
    return {
        side, path: view.sidePath, line: view.lineAt(hit.offset),
        snippet: squash(redact(view.lineText(hit.offset))).slice(0, MAX_SNIPPET), note: key,
    };
}

/** Hits grouped by REDACTED key; each distinct raw key is redacted once. */
function groupByKey(hits: readonly Hit[]): Map<string, Hit[]> {
    const raw = new Map<string, Hit[]>();
    for (const h of hits) { const g = raw.get(h.key); if (g) g.push(h); else raw.set(h.key, [h]); }
    const out = new Map<string, Hit[]>();
    for (const [k, g] of raw) {
        const key = redact(k);
        const into = out.get(key);
        if (into) into.push(...g); else out.set(key, g);
    }
    return out;
}

const earliest = (hits: readonly Hit[]): Hit => hits.reduce((a, b) => (b.offset < a.offset ? b : a));
const weight = (hits: readonly Hit[] | undefined): number => (hits ? hits.reduce((n, h) => n + (h.count ?? 1), 0) : 0);

/**
 * A regex's hits as one key, materializing at most {@link MAX_HITS_PER_KEY} + 1 {@link Hit}s: past that the
 * key aggregates anyway, so the rest are only COUNTED (folded into the last hit's `count`).
 */
export function cappedHits(re: RegExp, text: string, key: string, length?: (m: RegExpExecArray) => number): Hit[] {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    const out: Hit[] = [];
    let overflow = 0;
    for (let m = g.exec(text); m; m = g.exec(text)) {
        if (out.length <= MAX_HITS_PER_KEY) out.push({ offset: m.index, length: length ? length(m) : m[0].length, key });
        else overflow++;
        if (m[0].length === 0) g.lastIndex++;
    }
    if (overflow > 0) out[out.length - 1] = { ...out[out.length - 1]!, count: overflow + 1 };
    return out;
}

export function stateSides(rule: Pick<DeltaRule, 'id' | 'version'>, spec: StateRuleSpec, input: RuleInput): { before: RuleFinding[]; after: RuleFinding[] } {
    const out = { before: [] as RuleFinding[], after: [] as RuleFinding[] };
    for (const pair of filePairs(input)) {
        if (!spec.files(pair.path)) continue;
        const groups = {
            before: pair.before ? groupByKey(spec.hits(pair.before, input)) : new Map<string, Hit[]>(),
            after: pair.after ? groupByKey(spec.hits(pair.after, input)) : new Map<string, Hit[]>(),
        };
        const aggregated = new Set<string>();
        if (spec.granularity !== 'file') {
            for (const k of new Set([...groups.before.keys(), ...groups.after.keys()])) {
                if (Math.max(weight(groups.before.get(k)), weight(groups.after.get(k))) > MAX_HITS_PER_KEY) aggregated.add(k);
            }
        }
        for (const key of [...aggregated].sort()) {
            const cb = weight(groups.before.get(key)), ca = weight(groups.after.get(key));
            const base = ruleIdentity(rule, 'file', `${pair.path}#${key}`, { members: [pair.path] });
            for (const side of ['before', 'after'] as const) {
                const view = pair[side], hits = groups[side].get(key);
                if (!view || !hits || hits.length === 0) continue;
                const identity = side === 'after' && ca > cb ? { ...base, id: `${base.id}~grew` } : base;
                out[side].push(heuristicFinding(identity, spec.severity, { file: pair.path, key, count: weight(hits), aggregated: 1 }, [evidenceOf(side, view, earliest(hits), key)]));
            }
        }
        for (const side of ['before', 'after'] as const) {
            const view = pair[side];
            if (!view) continue;
            const kept: Array<{ key: string; hit: Hit }> = [];
            for (const [key, hits] of groups[side]) {
                if (aggregated.has(key)) continue;
                if (spec.granularity === 'file') kept.push({ key, hit: earliest(hits) });
                else for (const hit of hits) kept.push({ key, hit });
            }
            if (kept.length === 0) continue;
            kept.sort((a, b) => a.hit.offset - b.hit.offset);
            const extra = spec.fileParams ? spec.fileParams(view, input) : undefined;
            const ordinals = new Ordinals();
            for (const { key, hit } of kept) {
                const span = spec.granularity === 'file' ? undefined : squash(redact(view.text.slice(hit.offset, hit.offset + Math.min(hit.length, MAX_SPAN))));
                const ordinal = ordinals.next(`${key}\u0000${span ?? ''}`);
                const identity = ruleIdentity(rule, 'file', `${pair.path}#${key}`, {
                    members: [pair.path], ...(span !== undefined ? { snippet: span } : {}), ordinal,
                });
                out[side].push(heuristicFinding(identity, spec.severity, { file: pair.path, key, ...redactParams(hit.params), ...extra }, [evidenceOf(side, view, hit, key)]));
            }
        }
    }
    return out;
}

/** Every match of a regex over a text (global; `flags` default `g`). */
export function regexHits(source: string | RegExp, text: string, flags = 'g'): Array<{ offset: number; match: RegExpExecArray }> {
    const re = typeof source === 'string'
        ? new RegExp(source, flags.includes('g') ? flags : `${flags}g`)
        : new RegExp(source.source, source.flags.includes('g') ? source.flags : `${source.flags}g`);
    const out: Array<{ offset: number; match: RegExpExecArray }> = [];
    for (let m = re.exec(text); m; m = re.exec(text)) {
        out.push({ offset: m.index, match: m });
        if (m[0].length === 0) re.lastIndex++;
    }
    return out;
}

/** Longest line a REPO-ADDED registry regex is run against: bounds any backtracking. */
export const MAX_MATCH_INPUT = 1000;

/** A registry regex and whether it is a built-in (vetted) pattern or a repo override. */
export interface RegistryPattern {
    re: RegExp;
    vetted: boolean;
    /** A literal every match contains (case-sensitive patterns only): absent from a text, the pattern is skipped. */
    literal?: string;
}

/**
 * The longest literal word run every match of `source` must contain, or undefined: only text at group depth
 * 0, outside classes and escapes, with no top-level alternation; a char followed by a quantifier is dropped.
 */
export function mandatoryLiteral(source: string): string | undefined {
    let depth = 0, best = '', run = '';
    const flush = () => { if (run.length > best.length) best = run; run = ''; };
    for (let i = 0; i < source.length; i++) {
        const ch = source[i]!;
        if (ch === '\\') { flush(); i++; continue; }
        if (ch === '[') { flush(); while (i < source.length && source[i] !== ']') i += source[i] === '\\' ? 2 : 1; continue; }
        if (ch === '(') { flush(); depth++; continue; }
        if (ch === ')') { flush(); depth--; continue; }
        if (ch === '|' && depth === 0) return undefined;
        if (depth > 0) continue;
        if (/[A-Za-z0-9_-]/.test(ch)) {
            if (/[?*{]/.test(source[i + 1] ?? '')) { flush(); continue; }
            run += ch;
        } else flush();
    }
    flush();
    return best.length >= 3 ? best : undefined;
}

/** Compiles registry sources; a source in `builtIns` is vetted. `flags` are added to `g` (and `m` for vetted). */
export function registryPatterns(sources: readonly string[], builtIns: readonly string[], flags = ''): RegistryPattern[] {
    const vetted = new Set(builtIns);
    return sources.map((s) => {
        // Case-insensitive patterns get no literal: lower-casing the text costs more than the pass it saves.
        const literal = flags.includes('i') ? undefined : mandatoryLiteral(s);
        return { re: new RegExp(s, `g${flags}`), vetted: vetted.has(s), ...(literal ? { literal } : {}) };
    });
}

/**
 * Registry regex hits over `text` (offsets into it). BUILT-IN patterns are vetted, so they run once over
 * the whole text with `m` (one pass each, `^`/`$` per line). REPO-ADDED patterns run line by line, walking
 * the view's line starts (no re-split), each line capped at {@link MAX_MATCH_INPUT} chars, so a repo regex's
 * backtracking is bounded by one short line.
 */
export function registryHits(patterns: readonly RegistryPattern[], text: string, starts: readonly number[]): Array<{ offset: number; match: RegExpExecArray }> {
    const out: Array<{ offset: number; match: RegExpExecArray }> = [];
    const repo = patterns.filter((p) => !p.vetted).map((p) => new RegExp(p.re.source, p.re.flags.replace('m', '')));
    // A vetted pattern whose mandatory literal is absent from the text cannot match: skip it (one indexOf).
    const vetted = patterns.filter((p) => p.vetted && (p.literal === undefined || text.includes(p.literal)));
    if (vetted.length > 0) {
        const { re, groupOf } = combined(vetted);
        const stickies = vetted.map((p) => new RegExp(p.re.source, `${p.re.flags.replace('g', '').replace('m', '')}ym`));
        for (let m = re.exec(text); m; m = re.exec(text)) {
            // Re-run the one alternative that matched, so callers see that pattern's own groups (match[1]…).
            const sticky = stickies[groupOf(m)]!;
            sticky.lastIndex = m.index;
            out.push({ offset: m.index, match: sticky.exec(text) ?? m });
            if (m[0].length === 0) re.lastIndex++;
        }
    }
    if (repo.length > 0) out.push(...perLineHits(repo, text, starts));
    return out;
}

/**
 * Which of `regexes` match `text` at least once, in ONE combined pass per flag set (instead of one pass
 * each). A prefilter: run the matched ones on their own to get their exact (possibly overlapping) hits.
 */
export function whichMatch(regexes: readonly RegExp[], text: string): Set<number> {
    const out = new Set<number>();
    const byFlags = new Map<string, number[]>();
    regexes.forEach((re, i) => { const f = re.flags.replace(/[gy]/g, ''); (byFlags.get(f) ?? byFlags.set(f, []).get(f)!).push(i); });
    for (const [flags, all] of byFlags) {
        // Exact: an alternation reports a match wherever ANY remaining alternative matches, so "no match"
        // means none of the remaining ones occurs; each match found removes its pattern and re-checks the rest.
        let left = all;
        while (left.length > 0) {
            const firstGroup: number[] = [];
            let next = 1;
            for (const i of left) { firstGroup.push(next); next += 1 + groupCount(regexes[i]!.source); }
            const m = new RegExp(left.map((i) => `(${regexes[i]!.source})`).join('|'), flags).exec(text);
            if (!m) break;
            const found = left[Math.max(0, firstGroup.findIndex((g) => m[g] !== undefined))]!;
            out.add(found);
            left = left.filter((i) => i !== found);
        }
    }
    return out;
}

/** The capture groups a regex source opens. */
const groupCount = (source: string): number => new RegExp(`${source}|`).exec('')!.length - 1;

/** ONE alternation over vetted patterns (one pass over the text), each wrapped in a capture group. */
function combined(vetted: readonly RegistryPattern[]): { re: RegExp; groupOf(m: RegExpExecArray): number } {
    const firstGroup: number[] = [];
    let next = 1;
    for (const p of vetted) { firstGroup.push(next); next += 1 + groupCount(p.re.source); }
    const flags = [...new Set(`${vetted.map((p) => p.re.flags).join('')}gm`)].join('');
    return {
        re: new RegExp(vetted.map((p) => `(${p.re.source})`).join('|'), flags),
        groupOf: (m) => Math.max(0, firstGroup.findIndex((g) => m[g] !== undefined)),
    };
}

/**
 * Regexes run LINE BY LINE over `text`, each line capped at {@link MAX_MATCH_INPUT} chars. `starts` are
 * the line starts (a view's `lineStarts()`, shared by its text/code/bare); omitted, they are computed.
 */
export function perLineHits(patterns: readonly RegExp[], text: string, starts?: readonly number[]): Array<{ offset: number; match: RegExpExecArray }> {
    const out: Array<{ offset: number; match: RegExpExecArray }> = [];
    if (patterns.length === 0) return out;
    const globals = patterns.map((re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
    const lines = starts ?? lineStarts(text);
    for (let li = 0; li < lines.length; li++) {
        const start = lines[li]!;
        const end = li + 1 < lines.length ? lines[li + 1]! - 1 : text.length;
        const line = text.slice(start, Math.min(end, start + MAX_MATCH_INPUT));
        for (const g of globals) {
            g.lastIndex = 0;
            for (let m = g.exec(line); m; m = g.exec(line)) {
                m.index += start;
                out.push({ offset: m.index, match: m });
                if (m[0].length === 0) g.lastIndex++;
            }
        }
    }
    return out;
}

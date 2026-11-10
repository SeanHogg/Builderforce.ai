/**
 * rules/support/stateRule.ts — the shape most text rules share: find occurrences on EACH side, anchor
 * each on `<path>#<key>` plus the normalized MATCHED SPAN (not the whole line: an unrelated edit on the
 * same line keeps the identity), and let the engine's lineage turn "present after, absent before" into
 * `introduced`. Moving a line keeps its identity (no line numbers in the anchor).
 *
 * Every string a hit contributes — the span, the line, the key, string params — is REDACTED before it
 * reaches an anchor, a snippet, a note or a param, whatever the rule.
 */

import type { DeltaRule, Evidence, RuleFinding, RuleInput, Severity } from '../../contract.js';
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
}

export interface StateRuleSpec {
    files(path: string): boolean;
    hits(view: TextView, input: RuleInput): Hit[];
    severity: Severity;
    /** `line` (default): one finding per occurrence; `file`: one per (file, key), anchored without a snippet. */
    granularity?: 'line' | 'file';
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

export function stateSides(rule: Pick<DeltaRule, 'id' | 'version'>, spec: StateRuleSpec, input: RuleInput): { before: RuleFinding[]; after: RuleFinding[] } {
    const out = { before: [] as RuleFinding[], after: [] as RuleFinding[] };
    for (const pair of filePairs(input)) {
        if (!spec.files(pair.path)) continue;
        const sideHits = {
            before: pair.before ? [...spec.hits(pair.before, input)].sort((a, b) => a.offset - b.offset) : [],
            after: pair.after ? [...spec.hits(pair.after, input)].sort((a, b) => a.offset - b.offset) : [],
        };
        const counts = { before: new Map<string, Hit[]>(), after: new Map<string, Hit[]>() };
        for (const side of ['before', 'after'] as const) {
            for (const h of sideHits[side]) { const k = redact(h.key); (counts[side].get(k) ?? counts[side].set(k, []).get(k)!).push(h); }
        }
        const aggregated = new Set<string>();
        if (spec.granularity !== 'file') {
            for (const k of new Set([...counts.before.keys(), ...counts.after.keys()])) {
                if (Math.max(counts.before.get(k)?.length ?? 0, counts.after.get(k)?.length ?? 0) > MAX_HITS_PER_KEY) aggregated.add(k);
            }
        }
        for (const key of [...aggregated].sort()) {
            const cb = counts.before.get(key)?.length ?? 0, ca = counts.after.get(key)?.length ?? 0;
            const base = ruleIdentity(rule, 'file', `${pair.path}#${key}`, { members: [pair.path] });
            for (const side of ['before', 'after'] as const) {
                const view = pair[side], hits = counts[side].get(key);
                if (!view || !hits || hits.length === 0) continue;
                const identity = side === 'after' && ca > cb ? { ...base, id: `${base.id}~grew` } : base;
                out[side].push(heuristicFinding(identity, spec.severity, { file: pair.path, key, count: hits.length, aggregated: 1 }, [evidenceOf(side, view, hits[0]!, key)]));
            }
        }
        for (const side of ['before', 'after'] as const) {
            const view = pair[side];
            if (!view) continue;
            const ordinals = new Ordinals();
            const seenKeys = new Set<string>();
            for (const hit of sideHits[side]) {
                const key = redact(hit.key);
                if (aggregated.has(key)) continue;
                if (spec.granularity === 'file') {
                    if (seenKeys.has(key)) continue;
                    seenKeys.add(key);
                }
                const span = spec.granularity === 'file' ? undefined : squash(redact(view.text.slice(hit.offset, hit.offset + Math.min(hit.length, MAX_SPAN))));
                const ordinal = ordinals.next(`${key}\u0000${span ?? ''}`);
                const identity = ruleIdentity(rule, 'file', `${pair.path}#${key}`, {
                    members: [pair.path], ...(span !== undefined ? { snippet: span } : {}), ordinal,
                });
                out[side].push(heuristicFinding(identity, spec.severity, { file: pair.path, key, ...redactParams(hit.params) }, [evidenceOf(side, view, hit, key)]));
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

/** Longest line a registry (repo-overridable) regex is run against: bounds any backtracking. */
export const MAX_MATCH_INPUT = 1000;

/**
 * Registry (repo-overridable) regexes run LINE BY LINE, each line capped at {@link MAX_MATCH_INPUT}
 * chars, so even a vetted pattern's backtracking is bounded by one short line. One pass over the lines
 * for all patterns; offsets are into `text`.
 */
export function perLineHits(patterns: readonly RegExp[], text: string): Array<{ offset: number; match: RegExpExecArray }> {
    const out: Array<{ offset: number; match: RegExpExecArray }> = [];
    const globals = patterns.map((re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
    for (let start = 0; start <= text.length;) {
        const nl = text.indexOf('\n', start);
        const end = nl < 0 ? text.length : nl;
        const line = text.slice(start, Math.min(end, start + MAX_MATCH_INPUT));
        for (const g of globals) {
            g.lastIndex = 0;
            for (let m = g.exec(line); m; m = g.exec(line)) {
                m.index += start;
                out.push({ offset: m.index, match: m });
                if (m[0].length === 0) g.lastIndex++;
            }
        }
        if (nl < 0) break;
        start = nl + 1;
    }
    return out;
}

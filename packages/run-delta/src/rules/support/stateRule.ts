/**
 * rules/support/stateRule.ts — the shape most text rules share: find occurrences on EACH side, anchor
 * each on `<path>#<key>` plus the normalized line snippet, and let the engine's lineage turn "present
 * after, absent before" into `introduced`. Moving a line keeps its identity (no line numbers in the
 * anchor); editing it changes the snippet hash.
 */

import type { DeltaRule, Evidence, RuleFinding, RuleInput, Severity } from '../../contract.js';
import { lineAt, lineTextAt } from '../../engine/text.js';
import { filePairs, squash } from './files.js';
import { heuristicFinding, Ordinals, ruleIdentity } from './identity.js';

export interface Hit {
    /** Character offset of the occurrence in the side's text. */
    offset: number;
    /** What occurred (a capability, a marker, a call name): part of the anchor and the evidence note. */
    key: string;
    params?: Record<string, string | number>;
}

export interface StateRuleSpec {
    files(path: string): boolean;
    hits(text: string, path: string, input: RuleInput): Hit[];
    severity: Severity;
    /** Rewrites a source line before it enters an anchor or evidence (e.g. secret redaction). */
    redact?(line: string): string;
    /** `line` (default): one finding per occurrence line; `file`: one per (file, key), anchored without a snippet. */
    granularity?: 'line' | 'file';
}

const MAX_SNIPPET = 200;

export function stateSides(rule: Pick<DeltaRule, 'id' | 'version'>, spec: StateRuleSpec, input: RuleInput): { before: RuleFinding[]; after: RuleFinding[] } {
    const out = { before: [] as RuleFinding[], after: [] as RuleFinding[] };
    for (const pair of filePairs(input)) {
        if (!spec.files(pair.path)) continue;
        for (const side of ['before', 'after'] as const) {
            const st = pair[side];
            if (!st) continue;
            const ordinals = new Ordinals();
            const seenKeys = new Set<string>();
            const hits = [...spec.hits(st.text, pair.path, input)].sort((a, b) => a.offset - b.offset);
            for (const hit of hits) {
                if (spec.granularity === 'file') {
                    if (seenKeys.has(hit.key)) continue;
                    seenKeys.add(hit.key);
                }
                const raw = lineTextAt(st.text, hit.offset);
                const line = spec.redact ? spec.redact(raw) : raw;
                const snippet = spec.granularity === 'file' ? undefined : squash(line);
                const ordinal = ordinals.next(`${hit.key}\u0000${snippet ?? ''}`);
                const identity = ruleIdentity(rule, 'file', `${pair.path}#${hit.key}`, {
                    members: [pair.path], ...(snippet !== undefined ? { snippet } : {}), ordinal,
                });
                const evidence: Evidence = { side, path: st.path, line: lineAt(st.text, hit.offset), snippet: squash(line).slice(0, MAX_SNIPPET), note: hit.key };
                out[side].push(heuristicFinding(identity, spec.severity, { file: pair.path, key: hit.key, ...hit.params }, [evidence]));
            }
        }
    }
    return out;
}

/** Every match offset of a regex source over a text (global; `flags` default `g`). */
export function regexOffsets(source: string | RegExp, text: string, flags = 'g'): Array<{ offset: number; match: RegExpExecArray }> {
    const re = typeof source === 'string' ? new RegExp(source, flags.includes('g') ? flags : `${flags}g`) : new RegExp(source.source, source.flags.includes('g') ? source.flags : `${source.flags}g`);
    const out: Array<{ offset: number; match: RegExpExecArray }> = [];
    for (let m = re.exec(text); m; m = re.exec(text)) {
        out.push({ offset: m.index, match: m });
        if (m[0].length === 0) re.lastIndex++;
    }
    return out;
}

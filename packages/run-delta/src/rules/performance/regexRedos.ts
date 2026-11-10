/**
 * rules/performance/regexRedos.ts — `regex-redos` (performance; C6.1): a regex literal, or a
 * `new RegExp('…')` with a literal source, in a changed non-test JS/TS file that fails the safe-regex
 * check ({@link regexHazards}, the walk the repo-override gate uses), by key:
 *
 *  - `nested-quantifier` (warn): star height above 1 AND ambiguous at the repetition boundary (`(a+)+`,
 *    `(\s*\w+)*`) — the catastrophic-backtracking shape;
 *  - `nested-quantifier-delimited` (info): star height above 1 but each repetition ends on a required atom
 *    the inner quantifier cannot consume (`(\d+,)+`) — linear in practice, shown for review;
 *  - `overlapping-alternation` (warn): an unbounded group whose alternatives can start with the same
 *    character (`(a|ab)*`, `(\\.|[^"])*`).
 *
 * Heuristic: structural, not a full ambiguity analysis.
 */

import type { DeltaRule, RuleFinding } from '../../contract.js';
import { regexHazards } from '../../registry/safeRegex.js';
import { isJsPath, isTestPath, type TextView } from '../support/files.js';
import { stateSides, type Hit } from '../support/stateRule.js';

/** A `/…/flags` literal (regex literals survive masking; strings and comments do not), matched AT a `/`. */
const LITERAL = /\/(?![*/])((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/([dgimsuvy]*)/y;
/** What may precede a regex literal (an operator or keyword, never an operand): checked on a short window. */
const EXPRESSION_BEFORE = /(?:^|[=(,:;!&|?{}[+\-*%<>~^]|\breturn|\btypeof|\bcase|\bin|\bof|\byield|\bawait)\s*$/;
const CONSTRUCTED = /RegExp\s*\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1(?:\s*,\s*(['"])([a-z]*)\3)?/g;
const INFO_KEYS: ReadonlySet<string> = new Set(['nested-quantifier-delimited']);

function check(source: string, flags: string, offset: number, length: number): Hit | undefined {
    const h = regexHazards(source, flags);
    const key = h.nestedAmbiguous ? 'nested-quantifier'
        : h.overlappingAlternation ? 'overlapping-alternation'
            : h.nestedQuantifier ? 'nested-quantifier-delimited' : undefined;
    return key ? { offset, length, key } : undefined;
}

function hitsOf(view: TextView): Hit[] {
    return view.memo('regexRedos', () => {
        const hits: Hit[] = [];
        const { bare, code } = view;
        for (let i = bare.indexOf('/'); i >= 0; i = bare.indexOf('/', i + 1)) {
            if (!EXPRESSION_BEFORE.test(bare.slice(Math.max(0, i - 16), i))) continue;
            LITERAL.lastIndex = i;
            const m = LITERAL.exec(bare);
            if (!m) continue;
            const h = check(m[1]!, m[2] ?? '', i, m[0].length);
            if (h) hits.push(h);
            i += m[0].length - 1;
        }
        for (const m of code.matchAll(CONSTRUCTED)) {
            if (bare[m.index] !== code[m.index] || /[\w$]/.test(code[m.index - 1] ?? '')) continue;
            const h = check(m[2]!.replace(/\\(.)/g, '$1'), m[4] ?? '', m.index, m[0].length);
            if (h) hits.push(h);
        }
        return hits;
    });
}

const files = (p: string): boolean => isJsPath(p) && !isTestPath(p);

export const regexRedos: DeltaRule = {
    id: 'regex-redos',
    version: 2,
    dimension: 'performance',
    reads: ['content'],
    derive(input) {
        // One scan per view (memoized), split by severity: the two keys never share an identity.
        const warn = stateSides(regexRedos, { files, hits: (v) => hitsOf(v).filter((h) => !INFO_KEYS.has(h.key)), severity: 'warn' }, input);
        const info = stateSides(regexRedos, { files, hits: (v) => hitsOf(v).filter((h) => INFO_KEYS.has(h.key)), severity: 'info' }, input);
        const merge = (a: RuleFinding[], b: RuleFinding[]) => [...a, ...b];
        return { before: merge(warn.before, info.before), after: merge(warn.after, info.after) };
    },
};

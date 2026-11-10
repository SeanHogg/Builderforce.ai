/**
 * rules/ilities/floatingPromise.ts — `floating-promise` (ilities.reliability, warn; C7): an expression
 * statement that starts a promise nobody awaits, returns, assigns or handles — a bare `fetch(…)`
 * statement, or a `.then(…)` chain with no `.catch(…)` and no rejection handler (`.then(ok, fail)`) — so a
 * rejection is unhandled. `void p` is the explicit opt-out; an object property value (`{ a: p.then(x) }`)
 * is held, not floating. Semicolon-free code is read with ASI statement boundaries. In changed non-test JS/TS.
 *
 * Heuristic: text-level, no types (a non-promise `.then` method would be flagged); WS4 type-aware facts
 * replace it.
 */

import type { DeltaRule } from '../../contract.js';
import { isJsPath, isTestPath, matchClose, type TextView } from '../support/files.js';
import { stateSides, type Hit } from '../support/stateRule.js';
import { chainEnd, glued, statementStart, startsStatement, topLevelArgs } from '../support/statements.js';

/** Statements that are not a bare promise expression. */
const NOT_EXPRESSION = /(?:await|return|yield|void|const|let|var|throw|export|import|if|for|while|switch|case|default|else|do|try|catch|finally|function|class|async|new|delete|typeof|type|interface|enum|declare|abstract|private|public|protected|static|readonly|get|set|module|namespace)\b/y;
const ASSIGNMENT = /^[\w$.[\]\s]*[^=!<>]=(?![=>])/;
/** `key: value` — an object property (or a label), never `a ? b : c` at statement start. */
const PROPERTY = /^(?:[\w$]+|'[^']*'|"[^"]*"|\[[^\]]*\])\s*:(?!:)/;

const THEN = /\.\s*then\s*\(/g;
const FOLLOWED_BY_CALL = /\s*\(/y;

/**
 * Candidate offsets, by `indexOf` (no match objects: a generated file can hold tens of thousands of `fetch`):
 * a `fetch(` that starts a statement, and the `.` of every `.then(`.
 */
function candidates(bare: string): number[] {
    const out: number[] = [];
    for (let i = bare.indexOf('fetch'); i >= 0; i = bare.indexOf('fetch', i + 5)) {
        FOLLOWED_BY_CALL.lastIndex = i + 5;
        if (!glued(bare, i) && FOLLOWED_BY_CALL.test(bare) && startsStatement(bare, i)) out.push(i);
    }
    for (let i = bare.indexOf('then'); i >= 0; i = bare.indexOf('then', i + 4)) {
        if (/[\w$]/.test(bare[i + 4] ?? '')) continue;
        FOLLOWED_BY_CALL.lastIndex = i + 4;
        if (!FOLLOWED_BY_CALL.test(bare)) continue;
        let d = i - 1;
        while (d >= 0 && /\s/.test(bare[d]!)) d--;
        if (bare[d] === '.') out.push(d);
    }
    return out.sort((a, b) => a - b);
}

/** Whether some `.then(` of the statement `[s, e)` passes a rejection handler (a second argument). */
function thenHandles(bare: string, s: number, e: number): boolean {
    THEN.lastIndex = s;
    for (let m = THEN.exec(bare); m && m.index < e; m = THEN.exec(bare)) {
        const open = m.index + m[0].length - 1, close = matchClose(bare, open);
        if (close > 0 && topLevelArgs(bare, open, close).length >= 2) return true;
    }
    return false;
}

function hitsOf(view: TextView): Hit[] {
    const { bare } = view;
    const hits: Hit[] = [];
    const seen = new Set<number>();
    for (const at of candidates(bare)) {
        let s = statementStart(bare, at);
        if (s > 0 && (bare[s - 1] === '(' || bare[s - 1] === '[')) continue; // an argument, not a statement
        while (s < at && /\s/.test(bare[s]!)) s++;
        if (seen.has(s)) continue;
        seen.add(s);
        NOT_EXPRESSION.lastIndex = s;
        if (NOT_EXPRESSION.test(bare)) continue;
        const e = chainEnd(bare, s);
        const stmt = bare.slice(s, e);
        if (ASSIGNMENT.test(stmt) || PROPERTY.test(stmt)) continue;
        const key = /^fetch\s*\(/.test(stmt) ? 'fetch'
            : /\.\s*then\s*\(/.test(stmt) && !/\.\s*catch\s*\(/.test(stmt) && !thenHandles(bare, s, e) ? 'then' : undefined;
        if (key) hits.push({ offset: s, length: Math.min(stmt.length, 120), key });
    }
    return hits;
}

export const floatingPromise: DeltaRule = {
    id: 'floating-promise',
    version: 2,
    dimension: 'ilities.reliability',
    reads: ['content'],
    derive(input) {
        return stateSides(floatingPromise, { files: (p) => isJsPath(p) && !isTestPath(p), hits: hitsOf, severity: 'warn' }, input);
    },
};

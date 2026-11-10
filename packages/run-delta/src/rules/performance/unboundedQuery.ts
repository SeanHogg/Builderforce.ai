/**
 * rules/performance/unboundedQuery.ts — `unbounded-query` (performance, warn; C6.1): a list query with
 * no row bound, in a changed non-test JS/TS file. Per ORM (rule data, {@link BOUNDS}):
 *
 *  - drizzle / knex builder chains: `.select(…)…from(…)` / `knex(…)…select(…)` with no `.limit(`,
 *    `.first(`, `.get(`, `.findFirst(` on the chain;
 *  - `findMany(…)` (prisma, drizzle relational) whose arguments name no `take` / `limit`;
 *  - raw SQL: a string or template whose first keyword is `SELECT … FROM`, with no `LIMIT`, no
 *    `TOP n` / `FETCH FIRST`, that is not an ungrouped aggregate, and whose chain does not take one row
 *    (`.first(` — Cloudflare D1, knex).
 *
 * A statement that reads only one row is bounded whatever the query: `const [row] = await …`, a
 * primary-key `.where(eq(t.id, …))`, or SQL `WHERE id = ?`.
 *
 * Heuristic: text-level; WS4 call facts replace it.
 */

import type { DeltaRule } from '../../contract.js';
import { isJsPath, isTestPath, matchClose, type TextView } from '../support/files.js';
import { stateSides, type Hit } from '../support/stateRule.js';
import { chainEnd, statementStart, statementTail } from '../support/statements.js';

/** Calls on a chain that bound its rows. */
export const BOUNDS = /\.\s*(?:limit|first|get|findFirst|findUnique|take|paginate)\s*\(/;
const SELECT_CHAIN = /\.\s*select(?:Distinct)?\s*\(/g;
const FIND_MANY = /findMany\s*\(/g;
const SQL = /\bSELECT\b/gi;
const AGGREGATE_ONLY = /^\s*SELECT\s+(?:COUNT|SUM|AVG|MIN|MAX|TOTAL|EXISTS)\s*\(/i;
/** `const [row] = await …`: only the first row is read. */
const FIRST_ROW = /^\s*(?:const|let|var)\s*\[\s*[A-Za-z_$][\w$]*\s*\]\s*(?::[^=]+)?=/;
/** A primary-key lookup on the chain: `.where(eq(t.id, …))` (at most one row). */
const BY_ID = /\.\s*where\s*\(\s*eq\s*\(\s*[\w$.]*\.id\s*,/;
/** Raw SQL filtered on the primary key: `WHERE id = ?` / `WHERE t.id = $1`. */
const SQL_BY_ID = /\bWHERE\s+(?:\w+\.)?id\s*=/i;

/** The start of the statement holding `at`, climbing out of up to 4 enclosing calls (`d.prepare('…')`). */
function outerStart(bare: string, at: number): number {
    let s = statementStart(bare, at);
    for (let k = 0; k < 4 && s > 0 && bare[s - 1] === '('; k++) s = statementStart(bare, s - 1);
    return s;
}

/** Whether the statement holding `at` takes one row: destructures the first, or looks up by primary key. */
function oneRow(bare: string, start: number, at: number, chain: string): boolean {
    return FIRST_ROW.test(bare.slice(start, at)) || BY_ID.test(chain);
}

function chainHits(view: TextView): Hit[] {
    const { bare } = view;
    const hits: Hit[] = [];
    for (const m of bare.matchAll(SELECT_CHAIN)) {
        const start = statementStart(bare, m.index);
        const chain = bare.slice(start, chainEnd(bare, m.index));
        if (!/\.\s*from\s*\(|(?<![\w$])knex\s*\(/.test(chain) || BOUNDS.test(chain) || oneRow(bare, start, m.index, chain)) continue;
        hits.push({ offset: m.index, length: m[0].length, key: 'select' });
    }
    for (const m of bare.matchAll(FIND_MANY)) {
        if (/[\w$]/.test(bare[m.index - 1] ?? '')) continue;
        const open = m.index + m[0].length - 1;
        const close = matchClose(bare, open);
        if (close < 0 || /\b(?:take|limit)\s*:/.test(bare.slice(open, close))) continue;
        if (FIRST_ROW.test(bare.slice(statementStart(bare, m.index), m.index))) continue;
        hits.push({ offset: m.index, length: m[0].length, key: 'findMany' });
    }
    return hits;
}

/** Raw SQL inside a string or template (blanked in `bare`, intact in `code`). */
function sqlHits(view: TextView): Hit[] {
    const { bare, code } = view;
    const hits: Hit[] = [];
    let lastClose = -1;
    for (const m of code.matchAll(SQL)) {
        if (m.index < lastClose || bare[m.index] === code[m.index]) continue; // code, not a string
        let open = m.index - 1;
        while (open >= 0 && !/['"`]/.test(bare[open]!)) open--;
        if (open < 0) continue;
        const close = bare.indexOf(bare[open]!, m.index);
        if (close < 0) continue;
        lastClose = close;
        const query = code.slice(open + 1, close);
        if (!/^\s*SELECT\b[\s\S]*\bFROM\b/i.test(query) || /\bLIMIT\b|\bTOP\s*\(?\s*\d|\bFETCH\s+FIRST\b/i.test(query)) continue;
        if (AGGREGATE_ONLY.test(query) && !/\bGROUP\s+BY\b/i.test(query)) continue;
        if (SQL_BY_ID.test(query) || BOUNDS.test(statementTail(bare, close + 1))) continue;
        if (FIRST_ROW.test(bare.slice(outerStart(bare, open), open))) continue;
        hits.push({ offset: m.index, length: m[0].length, key: 'sql' });
    }
    return hits;
}

export const unboundedQuery: DeltaRule = {
    id: 'unbounded-query',
    version: 1,
    dimension: 'performance',
    reads: ['content'],
    derive(input) {
        return stateSides(unboundedQuery, {
            files: (p) => isJsPath(p) && !isTestPath(p),
            hits: (view) => [...chainHits(view), ...sqlHits(view)],
            severity: 'warn',
        }, input);
    },
};

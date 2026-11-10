/**
 * rules/support/testFacts.ts — C8.2 `testFacts` of one test file, by text (WS4 tree-sitter test facts
 * replace this): every `describe`/`it`/`test` call (and the `x`/`f` and `.skip`/`.only`/`.todo`
 * forms), nested by span, with per-test assertion counts, matcher names, timeout and assertion lines.
 * Computed once per {@link TextView}; nesting is one stack pass (calls are visited in offset order).
 *
 * Not recognized: `test.each(table)(name, fn)` (its name is not the first argument).
 */

import { matchClose, squash, type TextView } from './files.js';

export interface TestFact {
    /** `describe > describe > name`. */
    key: string;
    container: boolean;
    line: number;
    /** Skipped by its own marker or an enclosing one (`.skip`, `xit`, `xdescribe`, `.todo`). */
    skipped: boolean;
    /** Its OWN `.only` / `fit` / `fdescribe`. */
    only: boolean;
    /** `expect(…)` / `assert…(…)` calls in the body (tests only). */
    assertions: number;
    /** Matcher names in body order (`toEqual`, …; `not.` dropped). */
    matchers: string[];
    timeout?: number;
    /** Normalized lines holding an assertion (comment-masked, strings intact). */
    assertionLines: string[];
}

const CALL = /(?<![\w$.])(describe|suite|context|it|test|specify|xit|xtest|xdescribe|fit|fdescribe)((?:\s*\.\s*(?:skip|only|todo|concurrent|sequential|fails))*)\s*\(\s*(['"`])((?:\\.|(?!\3)[^\\\n])*)\3/g;
const CONTAINERS: ReadonlySet<string> = new Set(['describe', 'suite', 'context', 'xdescribe', 'fdescribe']);
const ASSERTION = /(?<![\w$])(?:expect|assert)(?:\s*\.\s*[A-Za-z]+)?\s*\(/g;
const MATCHER = /\.\s*(?:not\s*\.\s*)?(to[A-Z]\w*)\s*\(/g;
const TRAILING_TIMEOUT = /,\s*(\d[\d_]*)\s*$/;
const OPTIONS_TIMEOUT = /^\s*,\s*\{[^{}]*?\btimeout\s*:\s*(\d[\d_]*)/;

interface Raw { name: string; container: boolean; open: number; close: number; skip: boolean; only: boolean; offset: number; afterName: number }

const num = (s: string): number => Number(s.replace(/_/g, ''));

export function testFactsOf(view: TextView): TestFact[] {
    return view.memo('testFacts', () => compute(view));
}

function compute(view: TextView): TestFact[] {
    const { code, bare } = view;
    const raws: Raw[] = [];
    for (const m of code.matchAll(CALL)) {
        if (bare[m.index] !== code[m.index]) continue;
        const word = m[1]!, mods = m[2] ?? '';
        const open = code.indexOf('(', m.index + word.length + mods.length);
        const close = matchClose(bare, open);
        if (close < 0) continue;
        raws.push({
            name: m[4]!, container: CONTAINERS.has(word), open, close, offset: m.index, afterName: m.index + m[0].length,
            skip: word.startsWith('x') || /\.\s*(?:skip|todo)/.test(mods),
            only: word === 'fit' || word === 'fdescribe' || /\.\s*only/.test(mods),
        });
    }

    const stack: Raw[] = [];
    return raws.map((r) => {
        while (stack.length > 0 && stack[stack.length - 1]!.close < r.offset) stack.pop();
        const ancestors = stack.filter((p) => p.close > r.close);
        const fact: TestFact = {
            key: [...ancestors.map((a) => a.name), r.name].join(' > '), container: r.container, line: view.lineAt(r.offset),
            skipped: r.skip || ancestors.some((a) => a.skip), only: r.only,
            assertions: 0, matchers: [], assertionLines: [],
        };
        if (r.container) { stack.push(r); return fact; }
        const body = bare.slice(r.open + 1, r.close);
        const asserts = [...body.matchAll(ASSERTION)];
        fact.assertions = asserts.length;
        fact.matchers = [...body.matchAll(MATCHER)].map((x) => x[1]!);
        const timeout = OPTIONS_TIMEOUT.exec(code.slice(r.afterName, Math.min(r.close, r.afterName + 200)))?.[1] ?? TRAILING_TIMEOUT.exec(body.slice(-64))?.[1];
        if (timeout !== undefined) fact.timeout = num(timeout);
        const lines = new Set<string>();
        for (const a of asserts) lines.add(squash(view.lineText(r.open + 1 + a.index, code)));
        fact.assertionLines = [...lines].sort();
        return fact;
    });
}

/** Facts by key (first occurrence wins). */
export function testsByKey(facts: readonly TestFact[]): Map<string, TestFact> {
    const out = new Map<string, TestFact>();
    for (const f of facts) if (!out.has(f.key)) out.set(f.key, f);
    return out;
}

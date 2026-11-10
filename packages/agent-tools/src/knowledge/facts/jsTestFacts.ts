/**
 * knowledge/facts/jsTestFacts.ts — the test facts of a JS/TS test file (PRD 41 §C8.2): each test's full title path,
 * its assertions, the matchers it uses with their strength class, `.skip`/`.only`/`.todo`/`x`/`f` modifiers, its timeout,
 * and a hash of its expected values; plus the snapshot files the file's tests read.
 *
 * Strength classes (`exact` > `partial` > `presence`) are this module's table; an unknown matcher is `partial`.
 */

import type { MatcherStrength, MatcherUse, TestCaseFact, TestFacts, TestModifier } from '@seanhogg/builderforce-memory/knowledge';
import { argsOf, calleeText, collapse, stringValue, textHash, walk, type FactNode } from './factsAst.js';
import { isFunctionNode } from './jsBody.js';

/** A path is a JS/TS test file. */
export const isJsTestPath = (path: string): boolean => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /(^|\/)__tests__\//.test(path);

export const MATCHER_STRENGTH: Readonly<Record<string, MatcherStrength>> = {
    toEqual: 'exact', toStrictEqual: 'exact', toBe: 'exact', toBeNull: 'exact', toHaveLength: 'exact', toThrow: 'exact', toThrowError: 'exact',
    toBeCloseTo: 'exact', toHaveBeenCalledTimes: 'exact', toHaveBeenCalledWith: 'exact', toMatchSnapshot: 'exact', toMatchInlineSnapshot: 'exact',
    toMatchObject: 'partial', toContain: 'partial', toContainEqual: 'partial', toMatch: 'partial', toHaveProperty: 'partial',
    toBeGreaterThan: 'partial', toBeGreaterThanOrEqual: 'partial', toBeLessThan: 'partial', toBeLessThanOrEqual: 'partial', toBeInstanceOf: 'partial',
    toBeTruthy: 'presence', toBeFalsy: 'presence', toBeDefined: 'presence', toBeUndefined: 'presence', toHaveBeenCalled: 'presence', toBeNaN: 'presence',
};

const SUITE = new Set(['describe', 'suite', 'context']);
const TEST = new Set(['it', 'test', 'specify']);
const X: Readonly<Record<string, { base: string; modifier: TestModifier }>> = {
    xit: { base: 'it', modifier: 'skip' }, xtest: { base: 'test', modifier: 'skip' }, xdescribe: { base: 'describe', modifier: 'skip' },
    fit: { base: 'it', modifier: 'only' }, fdescribe: { base: 'describe', modifier: 'only' },
};
const MODIFIERS = new Set<TestModifier>(['skip', 'only', 'todo']);

/** `it.skip(...)` → { base: 'it', modifier: 'skip' }; `test.each(...)(...)` → base 'test'. */
function testCallee(fn: FactNode | null): { base: string; modifier?: TestModifier } | undefined {
    const text = calleeText(fn).replace(/\(\)$/, '').replace(/\.each\(\)$/, '').replace(/\.each$/, '');
    const parts = text.split('.');
    const x = X[parts[0]!];
    if (x) return x;
    const base = parts[0]!;
    if (!SUITE.has(base) && !TEST.has(base)) return undefined;
    const modifier = parts.slice(1).find((p): p is TestModifier => MODIFIERS.has(p as TestModifier));
    return { base, ...(modifier ? { modifier } : {}) };
}

/** Assertions, matchers and expected-value texts inside one test body. */
function assertionsOf(body: FactNode | undefined, snapshots: { used: boolean }): { assertions: number; matchers: MatcherUse[]; expected: string[] } {
    let assertions = 0;
    const matchers = new Map<string, MatcherUse>();
    const expected: string[] = [];
    if (body) walk(body, (n) => {
        if (n.type !== 'call_expression') return;
        const fn = n.childForFieldName('function');
        const callee = calleeText(fn);
        if (callee.startsWith('assert')) { assertions += 1; expected.push(...argsOf(n).slice(1).map((a) => collapse(a.text))); return; }
        if (fn?.type !== 'member_expression' || !/^expect\(\)/.test(callee.replace(/^expect\.soft\(\)/, 'expect()'))) return;
        const base = fn.childForFieldName('property')?.text ?? '';
        // `expect(x).not.toBe(1)` excludes ONE value: it is never exact. A negated matcher drops one strength class.
        const negated = /\.not\.[\w$]+$/.test(callee);
        const matcher = negated ? `not.${base}` : base;
        assertions += 1;
        const plain = MATCHER_STRENGTH[base] ?? 'partial';
        const strength: MatcherStrength = negated ? (plain === 'exact' ? 'partial' : 'presence') : plain;
        const prior = matchers.get(matcher);
        if (prior) prior.count += 1; else matchers.set(matcher, { matcher, strength, count: 1 });
        expected.push(`${matcher}(${argsOf(n).map((a) => collapse(a.text)).join(',')})`);
        if (base === 'toMatchSnapshot') snapshots.used = true;
        return false;
    });
    return { assertions, matchers: [...matchers.values()], expected };
}

export function jsTestFacts(root: FactNode, path: string, importSpecifiers: readonly string[]): TestFacts | undefined {
    if (!isJsTestPath(path)) return undefined;
    const tests: TestCaseFact[] = [];
    const snapshots = { used: false };
    const visit = (n: FactNode, titles: string[], inherited?: TestModifier): void => {
        if (n.type === 'call_expression') {
            const kind = testCallee(n.childForFieldName('function'));
            const args = argsOf(n);
            const title = stringValue(args[0]) ?? (args[0] ? collapse(args[0].text) : '');
            if (kind) {
                const modifier = kind.modifier ?? inherited;
                const body = args.find((a) => isFunctionNode(a));
                if (SUITE.has(kind.base)) { if (body) for (const c of body.children) visit(c, [...titles, title], modifier); return; }
                const { assertions, matchers, expected } = assertionsOf(body, snapshots);
                const timeout = args.slice(1).find((a) => a.type === 'number');
                tests.push({
                    name: [...titles, title].join(' › '), assertions, matchers,
                    ...(modifier ? { modifier } : kind.modifier === undefined && !body ? { modifier: 'todo' as const } : {}),
                    ...(timeout ? { timeoutMs: Number(timeout.text) } : {}),
                    ...(expected.length > 0 ? { expectedHash: textHash(expected.join('\n')) } : {}),
                });
                return;
            }
        }
        for (const c of n.children) visit(c, titles, inherited);
    };
    visit(root, []);
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const base = path.slice(dir.length);
    const framework = importSpecifiers.includes('vitest') ? 'vitest' : importSpecifiers.includes('@jest/globals') ? 'jest'
        : importSpecifiers.includes('node:test') ? 'node:test' : importSpecifiers.includes('mocha') ? 'mocha' : undefined;
    return {
        ...(framework ? { framework } : {}),
        tests,
        snapshotFiles: snapshots.used ? [`${dir}__snapshots__/${base}.snap`] : [],
    };
}

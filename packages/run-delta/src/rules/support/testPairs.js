/**
 * rules/support/testPairs.ts — both sides' {@link TestFact}s of every changed test file
 * (`*.test.*`, `*.spec.*`, `__tests__/`), computed once per rule input, and the per-test diff the C8.2
 * rules share: each emits its finding on the AFTER side, anchored on `<file>#<test key>` (a symbol
 * anchor), so lineage reads it as introduced by this run. Tests are matched by (file, key).
 */
import { filePairs, isTestPath, perInput } from './files.js';
import { heuristicFinding, ruleIdentity } from './identity.js';
import { testFactsOf, testsByKey } from './testFacts.js';
export function testPairs(input) {
    return perInput(input, 'testPairs', () => filePairs(input).filter((p) => isTestPath(p.path)).map((p) => ({
        path: p.path,
        ...(p.before ? { beforePath: p.before.sidePath } : {}),
        ...(p.after ? { afterPath: p.after.sidePath } : {}),
        before: p.before ? testsByKey(testFactsOf(p.before)) : new Map(),
        after: p.after ? testsByKey(testFactsOf(p.after)) : new Map(),
    })));
}
/** Tests (not containers) present on both sides of one file. */
export function* sharedTests(pair) {
    for (const [key, before] of pair.before) {
        const after = pair.after.get(key);
        if (after && !before.container && !after.container)
            yield { key, before, after };
    }
}
/** One C8.2 finding on a test. */
export function testFinding(rule, pair, key, severity, params, sides) {
    const evidence = [];
    if (sides.before && pair.beforePath)
        evidence.push({ side: 'before', path: pair.beforePath, line: sides.before.line, note: key });
    if (sides.after && pair.afterPath)
        evidence.push({ side: 'after', path: pair.afterPath, line: sides.after.line, note: key });
    return heuristicFinding(ruleIdentity(rule, 'symbol', `${pair.path}#${key}`, { members: [pair.path] }), severity, { test: key, file: pair.path, ...params }, evidence);
}
//# sourceMappingURL=testPairs.js.map
import { describe, expect, it } from 'vitest';
import type { DeltaRule, RuleInput } from '../contract.js';
import { DEFAULT_REGISTRIES } from '../registry/defaults.js';
import { facts } from '../testing/fixturePorts.js';
import { a11yViolation } from './ilities/a11yViolation.js';
import { routeSchemaChanged } from './ilities/routeSchemaChanged.js';
import { nestedIteration } from './performance/nestedIteration.js';
import { renderHot } from './performance/renderHot.js';

/**
 * Regression for the WS9 review's quadratics (H2): each rule that walked a span list per item now sweeps or
 * binary-searches. 4× the input must cost under ~5× the time (a quadratic would cost ~16×). Best of 3 runs
 * after a warm-up, so one scheduler hiccup cannot fail it.
 */

/** The rule's own `derive` (not the engine's per-finding lineage / redaction / digest), on a FRESH input each run so no memo carries over. */
async function best(rule: DeltaRule, path: string, unit: (k: number, side: 'before' | 'after') => string, n: number): Promise<number> {
    const text = (side: 'before' | 'after') => Array.from({ length: n }, (_, k) => unit(k, side)).join('');
    const before = text('before'), after = text('after');
    let min = Infinity;
    for (let i = 0; i < 3; i++) {
        const input: RuleInput = {
            changed: [{ path, beforeHash: 'b', afterHash: 'a', attribution: 'run-modified-existing', status: 'modified' }],
            before: new Map([[path, { path, text: before }]]), after: new Map([[path, { path, text: after }]]),
            beforeFacts: facts(), afterFacts: facts(), registries: DEFAULT_REGISTRIES, runKind: 'standard', churn: new Map(),
        };
        const t0 = performance.now();
        rule.derive(input);
        min = Math.min(min, performance.now() - t0);
    }
    return min;
}

const CASES: Array<{ rule: DeltaRule; path: string; unit: (k: number, side: 'before' | 'after') => string }> = [
    {
        rule: nestedIteration, path: 'src/n.ts',
        unit: (k, s) => `export const f${k} = (xs, ys) => xs.map((x) => ys.find((y) => y === x${s === 'after' ? ' + 1' : ''}));\n`,
    },
    {
        rule: renderHot, path: 'src/R.tsx',
        unit: (k, s) => `export const C${k} = ({ xs }) => <ul>{xs.map((x) => <Row onSelect={() => go(x)}>{x}${s === 'after' ? '!' : ''}</Row>)}</ul>;\n`,
    },
    {
        rule: routeSchemaChanged, path: 'api/r.ts',
        unit: (k, s) => `const Body${k} = z.object({ a: z.${s === 'after' && k % 2 ? 'number' : 'string'}() });\napp.post('/api/x${k}', zValidator('json', Body${k}), h);\n`,
    },
    {
        rule: a11yViolation, path: 'src/A.tsx',
        unit: (k, s) => `export const A${k} = () => <div><label>N <input /></label><input${s === 'after' ? '' : ` id="i${k}"`} /></div>;\n`,
    },
];

describe('WS9 rules scale near-linearly (H2)', () => {
    it.each(CASES.map((c) => [c.rule.id, c] as const))('%s: 4× input under 5× time', async (_id, c) => {
        await best(c.rule, c.path, c.unit, 200); // warm-up (JIT)
        const small = await best(c.rule, c.path, c.unit, 1000);
        const large = await best(c.rule, c.path, c.unit, 4000);
        expect(large / Math.max(small, 1)).toBeLessThan(5);
    }, 120_000);
});

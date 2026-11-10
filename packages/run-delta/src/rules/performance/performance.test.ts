import { describe, expect, it } from 'vitest';
import type { DeltaRegistries, DimensionId, RunDelta } from '../../contract.js';
import { computeRunDelta } from '../../engine/computeRunDelta.js';
import { DEFAULT_REGISTRIES } from '../../registry/defaults.js';
import { defaultDimensionRegistry } from '../../registry/dimensions.js';
import { fixture, type Files, type FixtureOptions } from '../../testing/fixturePorts.js';

async function run(before: Files, after: Files, opts?: FixtureOptions, registries?: DeltaRegistries): Promise<RunDelta> {
    const { input, ports } = fixture(before, after, opts);
    return computeRunDelta(input, defaultDimensionRegistry(registries), ports);
}
const fresh = (d: RunDelta, id: DimensionId, ruleId: string) =>
    d.dimensions.find((x) => x.id === id)!.findings.filter((f) => f.lineage === 'introduced' && f.ruleId === ruleId);
const keys = (d: RunDelta, ruleId: string) => fresh(d, 'performance', ruleId).map((f) => f.params['key']).sort();

describe('performance rules (C6.1, WS9)', () => {
    it('unbounded-query: builder chains, findMany and raw SQL without a row bound', async () => {
        const after = [
            'export const list = () => db.select().from(users).where(eq(users.t, t));',
            'export const one = () => db.select().from(users).limit(1);',
            "export const raw = (d) => d.prepare('SELECT id FROM users WHERE t = ?').all();",
            "export const first = (d) => d.prepare('SELECT id FROM users').first();",
            "export const n = (d) => d.prepare('SELECT COUNT(*) FROM users').all();",
            'export const p = () => prisma.user.findMany({ where: { a: 1 } });',
            'export const q = () => prisma.user.findMany({ take: 10 });',
            '',
        ].join('\n');
        const d = await run({ 'src/q.ts': 'export {};\n' }, { 'src/q.ts': after });
        expect(keys(d, 'unbounded-query')).toEqual(['findMany', 'select', 'sql']);
    });

    it('unbounded-query: a one-row read is bounded (destructured first row, primary-key lookup, WHERE id =)', async () => {
        const after = [
            'export async function a() { const [u] = await db.select().from(users).where(eq(users.t, t)); return u; }',
            'export const b = () => db.select().from(users).where(eq(users.id, id));',
            "export async function c(d) { const [r] = await d.prepare('SELECT id FROM users WHERE t = ?').all(); return r; }",
            "export const e = (d) => d.prepare('SELECT * FROM users WHERE id = ?').all();",
            '',
        ].join('\n');
        const d = await run({ 'src/q.ts': 'export {};\n' }, { 'src/q.ts': after });
        expect(keys(d, 'unbounded-query')).toEqual([]);
    });

    it('cache-bypass: a registered cacheable read outside the read-through helper', async () => {
        const after = [
            "export const a = (env) => getOrSetCached(env, 'k', () => queryLog(db));",
            'export const b = () => queryLog(db);',
            'export async function queryLog(db) { return db; }',
            '',
        ].join('\n');
        const registries = { ...DEFAULT_REGISTRIES, cacheable: { reads: ['queryLog'], readThrough: ['getOrSetCached'] } };
        const d = await run({ 'src/c.ts': 'export {};\n' }, { 'src/c.ts': after }, {}, registries);
        expect(fresh(d, 'performance', 'cache-bypass').map((f) => f.evidence[0]!.line)).toEqual([2]);
        expect(fresh(await run({ 'src/c.ts': 'export {};\n' }, { 'src/c.ts': after }), 'performance', 'cache-bypass')).toEqual([]);
    });

    it('nested-iteration: a lookup per element and a loop over the same collection; a tree walk is not', async () => {
        const after = [
            'export const f = (orders, users) => orders.map((o) => users.find((u) => u.id === o.userId));',
            'export const g = (items) => items.map((i) => i.tags.map((t) => t.name));',
            'export const h = (xs) => { for (const a of xs) { for (const b of xs) { use(a, b); } } };',
            '',
        ].join('\n');
        const d = await run({ 'src/n.ts': 'export {};\n' }, { 'src/n.ts': after });
        expect(fresh(d, 'performance', 'nested-iteration').map((f) => `${f.params['loop']}>${f.params['call']}`).sort()).toEqual(['for-of>for-of', 'map>find']);
    });

    it('regex-redos: nested quantifiers and overlapping alternation; a disjoint alternation is safe', async () => {
        const after = String.raw`export const r = /(a+)+$/;
export const s = /(?:\\.|[^"])*/;
export const ok = /(?:\\.|[^"\\])*/;
export const t = new RegExp('(x|xy)*');
`;
        const d = await run({ 'src/r.ts': 'export {};\n' }, { 'src/r.ts': after });
        expect(keys(d, 'regex-redos')).toEqual(['nested-quantifier', 'overlapping-alternation', 'overlapping-alternation']);
    });

    it('regex-redos: an ambiguous nesting is a warning, a delimited one info; non-ASCII overlap is seen', async () => {
        const after = String.raw`export const a = /^(\s*\w+)*$/;
export const b = /^(\d+,)+$/;
export const c = /(?:[^\x00-\x7f]|é)*/u;
`;
        const d = await run({ 'src/r.ts': 'export {};\n' }, { 'src/r.ts': after });
        expect(fresh(d, 'performance', 'regex-redos').map((f) => [f.params['key'], f.severity]).sort())
            .toEqual([['nested-quantifier', 'warn'], ['nested-quantifier-delimited', 'info'], ['overlapping-alternation', 'warn']]);
    });

    it('bundle-weight: a client module importing a server-heavy package (type-only imports ignored, multi-line included)', async () => {
        const after = "'use client';\nimport sharp from 'sharp';\nimport type { Pool } from 'pg';\nimport type {\n  Knex,\n} from 'knex';\nimport React from 'react';\n";
        const d = await run({ 'src/c.tsx': "'use client';\n" }, { 'src/c.tsx': after });
        expect(keys(d, 'bundle-weight')).toEqual(['sharp']);
    });

    it('render-hot: inline props on a component and a missing key in a list, an effect with no dependencies', async () => {
        const after = [
            'export function L({ xs, children }) {',
            '  useEffect(() => { log(); });',
            '  useEffect(() => { log(); }, []);',
            '  const kids = React.Children.map(children, (c) => <span>{c}</span>);',
            '  const items = xs.map((x) => <li key={x} onClick={() => pick(x)}>{x}</li>);',
            '  return <ul>{xs.map((x) => <Row onSelect={() => pick(x)}>{x}</Row>)}</ul>;',
            '}',
            '',
        ].join('\n');
        const d = await run({ 'src/L.tsx': 'export {};\n' }, { 'src/L.tsx': after });
        // `<li onClick>` is a DOM element (nothing to memoize); `Children.map` keys its children itself.
        expect(keys(d, 'render-hot')).toEqual(['effect-without-deps', 'inline-prop:onSelect', 'missing-key:Row']);
    });
});

import { describe, expect, it } from 'vitest';
import { unwrapDeep, WorkMeter } from './meter';
import { countElementRefs, serializedBytes, WireLedger } from './wireLedger';

const make = () => {
    const meter = new WorkMeter('w');
    return { meter, ledger: new WireLedger((v) => meter.isElement(v), (v) => unwrapDeep(v, [meter])) };
};

describe('WireLedger', () => {
    it('measures identical messages identically across ledgers', () => {
        const a = make(), b = make();
        const msg = { type: 'load-chunk', graph: 'g', field: 'nodes', items: [{ id: 1 }, { id: 2 }] };
        const ea = a.ledger.record('in', msg), eb = b.ledger.record('in', msg);
        expect(ea.bytes).toBe(eb.bytes);
        expect(ea.bytes).toBeGreaterThan(0);
        expect(ea.field).toBe('nodes');
        expect(ea.items).toBe(2);
        expect(a.ledger.summary()).toEqual(b.ledger.summary());
    });

    it('splits transferred bytes out of the copied bytes', () => {
        const { ledger } = make();
        const buf = new Float64Array(1000);
        const copied = ledger.record('out', { type: 'done', buf }, [], 'rank');
        const moved = ledger.record('out', { type: 'done', buf }, [buf.buffer], 'rank');
        expect(copied.transferredBytes).toBe(0);
        expect(moved.transferredBytes).toBe(8000);
        expect(moved.bytes).toBe(copied.bytes - 8000);
        expect(serializedBytes({ buf }, [buf.buffer]).transferredBytes).toBe(8000);
    });

    it('finds element refs nested inside a run request', () => {
        const { meter, ledger } = make();
        const list = meter.wrapArray([{ id: 'a' }, { id: 'b' }]);
        const e = meter.without(() => ledger.record('in', { type: 'run', kind: 'rank', req: { nodes: [list[0]], m: new Map([['k', list[1]]]) } }));
        expect(e.elementRefs).toBe(2);
        expect(e.kind).toBe('rank');
        const clean = ledger.record('in', { type: 'run', kind: 'rank', req: { ids: ['a'] } });
        expect(clean.elementRefs).toBe(0);
        expect(countElementRefs([1, { x: 2 }], () => false)).toBe(0);
    });

    it('summarises per key with sorted keys and resets', () => {
        const { ledger } = make();
        ledger.record('out', { type: 'done' }, [], 'z');
        ledger.record('in', { type: 'run', kind: 'a' });
        ledger.record('in', { type: 'run', kind: 'a' });
        const s = ledger.summary();
        expect(Object.keys(s.groups)).toEqual(['in:run:a', 'out:done:z']);
        expect(s.groups['in:run:a']!.messages).toBe(2);
        expect(s.maxMessageBytes).toBeGreaterThan(0);
        ledger.reset();
        expect(ledger.entries).toHaveLength(0);
    });

    it('regression: the same value measures the same after V8 generalised its shape to double fields and double arrays', () => {
        // A shape and an array site no other test uses, so the first measurement sees them as Smi-only.
        const edge = (w: number) => { const o: Record<string, unknown> = {}; o.wlRegressionFrom = 1; o.wlRegressionWeight = w; return o; };
        const row = (w: number) => [1, 2, w].map((x) => x);
        const message = () => ({ type: 'load-chunk', field: 'edges', items: [edge(3), edge(4)], at: row(5) });
        const before = serializedBytes(message()).bytes;
        for (let i = 0; i < 1000; i++) { edge(i + 0.5); row(i + 0.5); } // the field turns Double, the array site PACKED_DOUBLE
        expect(serializedBytes(message()).bytes).toBe(before);
    });
});

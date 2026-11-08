import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../../testing';
import { unwrapDeep, WorkMeter } from './meter';

const rows = () => [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }];

describe('WorkMeter', () => {
    it('counts property and index reads, not length', () => {
        const m = new WorkMeter('t');
        const list = m.wrapArray(rows());
        expect(list.length).toBe(3);
        expect(m.reads).toBe(0);
        const first = list[0]!;
        expect(m.reads).toBe(1);
        void first.id; void first.n;
        expect(m.reads).toBe(3);
    });

    it('counts iteration and array methods through index gets', () => {
        const m = new WorkMeter('t');
        const list = m.wrapArray(rows());
        const mark = m.mark();
        const ids = list.map((r) => r.id);
        expect(ids).toEqual(['a', 'b', 'c']);
        expect(m.since(mark)).toBe(6); // 3 index reads + 3 property reads
        expect([...list]).toHaveLength(3);
    });

    it('ignores symbols and framework probes', () => {
        const m = new WorkMeter('t');
        const el = m.wrapArray(rows())[0] as Record<string | symbol, unknown>;
        const mark = m.mark();
        void el.$$typeof; void el.toJSON; void el.then; void el.constructor; void el[Symbol.iterator];
        expect(m.since(mark)).toBe(0);
    });

    it('keeps identity stable and Array.isArray true', () => {
        const m = new WorkMeter('t');
        const raw = rows();
        const list = m.wrapArray(raw);
        expect(m.wrapArray(raw)).toBe(list);
        expect(Array.isArray(list)).toBe(true);
        expect(list[1]).toBe(list[1]);
        const byProxy = new Map([[list[1]!, 'x']]);
        expect(byProxy.get(list[1]!)).toBe('x');
    });

    it('without pauses counting and is re-entrant', () => {
        const m = new WorkMeter('t');
        const list = m.wrapArray(rows());
        m.without(() => { void list[0]; m.without(() => void list[1]); expect(m.paused).toBe(true); void list[2]; });
        expect(m.paused).toBe(false);
        expect(m.reads).toBe(0);
        void list[0];
        expect(m.reads).toBe(1);
    });

    it('isElement and unwrap see through the proxy', () => {
        const m = new WorkMeter('t');
        const raw = rows();
        const list = m.wrapArray(raw);
        expect(m.isElement(list[0])).toBe(true);
        expect(m.isElement(raw[0])).toBe(true);
        expect(m.isElement(list)).toBe(false);
        expect(m.isElement({ id: 'z' })).toBe(false);
        expect(m.unwrap(list[0])).toBe(raw[0]);
        expect(m.unwrap(list)).toBe(raw);
        expect(m.unwrap(5)).toBe(5);
    });

    it('wrapArray on primitives and wrapGraph meter the right arrays', () => {
        const m = new WorkMeter('t');
        const nums = m.wrapArray([1, 2, 3]);
        expect(nums[0]).toBe(1);
        expect(m.reads).toBe(1);
        const g = surfaceFixture();
        const w = m.wrapGraph({ ...g, outline: { files: [{ p: 1 }], links: [[1, 2, 3, 4]] } } as never);
        expect(w.scope).toBe(g.scope);
        expect(m.isElement(w.nodes[0])).toBe(true);
        const links = (w as unknown as { outline: { links: number[][]; files: object[] } }).outline;
        expect(m.isElement(links.links[0])).toBe(false);
        expect(m.isElement(links.files[0])).toBe(true);
    });
});

describe('unwrapDeep', () => {
    it('yields a structuredClone-able value with no proxies and counts nothing', () => {
        const m = new WorkMeter('t');
        const list = m.wrapArray(rows());
        const mark = m.mark();
        const msg = { type: 'x', items: list, nested: { one: list[0], m: new Map([['k', list[1]]]), s: new Set([list[2]]) }, buf: new Float32Array(2) };
        const mark2 = m.mark();
        const out = unwrapDeep(msg, [m]);
        expect(m.since(mark2)).toBe(0);
        expect(m.since(mark)).toBe(3); // the three index reads building msg
        expect(() => structuredClone(out)).not.toThrow();
        expect(m.isElement(out.items[0])).toBe(false); // a plain copy, no longer the metered element
        expect(out.items).not.toBe(list);
        expect(structuredClone(out).nested.m.get('k')).toEqual({ id: 'b', n: 2 });
        expect(out.buf).toBe(msg.buf);
    });
});

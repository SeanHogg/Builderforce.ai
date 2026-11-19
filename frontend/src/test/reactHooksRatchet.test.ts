// @vitest-environment node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The react-hooks ratchet's `--update` merge. It used to rewrite the baseline from a sweep,
 * which grandfathered every new warning in the tree while "recording a win"; it is now
 * lower-only, and these pin that.
 */

type Change = { file: string; was: number; now: number };
type Ratchet = {
  mergeBaseline: (
    baseline: Map<string, number>,
    measured: Map<string, number>,
    scope: Iterable<string>,
    allowRaise: boolean,
  ) => { next: Map<string, number>; lowered: Change[]; raised: Change[] };
  serializeBaseline: (entries: Map<string, number>) => string;
};

const scriptUrl = pathToFileURL(resolve(__dirname, '../../scripts/check-react-hooks-ratchet.mjs')).href;
const load = async () => (await import(/* @vite-ignore */ scriptUrl)) as Ratchet;

const baseline = () => new Map([['a.tsx', 3], ['b.tsx', 2], ['c.tsx', 1]]);

describe('react-hooks ratchet: mergeBaseline', () => {
  it('treats an absent entry as 0 and drops an entry measured at 0', async () => {
    const { mergeBaseline } = await load();
    const { next, lowered, raised } = mergeBaseline(baseline(), new Map([['b.tsx', 2]]), ['c.tsx', 'new.tsx'], false);
    expect(next.has('c.tsx')).toBe(false);
    expect(next.has('new.tsx')).toBe(false);
    expect(lowered).toEqual([{ file: 'c.tsx', was: 1, now: 0 }]);
    expect(raised).toEqual([]);
  });

  it('holds a rise without allowRaise and writes it with allowRaise', async () => {
    const { mergeBaseline } = await load();
    const measured = new Map([['b.tsx', 5], ['new.tsx', 1]]);

    const held = mergeBaseline(baseline(), measured, ['b.tsx', 'new.tsx'], false);
    expect(held.next.get('b.tsx')).toBe(2);
    expect(held.next.has('new.tsx')).toBe(false);
    expect(held.raised).toEqual([{ file: 'b.tsx', was: 2, now: 5 }, { file: 'new.tsx', was: 0, now: 1 }]);

    const written = mergeBaseline(baseline(), measured, ['b.tsx', 'new.tsx'], true);
    expect(written.next.get('b.tsx')).toBe(5);
    expect(written.next.get('new.tsx')).toBe(1);
  });

  it('leaves files outside the measured scope untouched', async () => {
    const { mergeBaseline } = await load();
    const input = baseline();
    const { next } = mergeBaseline(input, new Map([['a.tsx', 1]]), ['a.tsx'], false);
    expect([...next]).toEqual([['a.tsx', 1], ['b.tsx', 2], ['c.tsx', 1]]);
    expect([...input]).toEqual([['a.tsx', 3], ['b.tsx', 2], ['c.tsx', 1]]);
  });

  it('drops baseline keys a full sweep no longer reports', async () => {
    const { mergeBaseline } = await load();
    const base = baseline();
    const counts = new Map([['a.tsx', 3]]);
    // The sweep's scope: every baseline key plus every reported key.
    const { next, lowered } = mergeBaseline(base, counts, [...base.keys(), ...counts.keys()], false);
    expect([...next]).toEqual([['a.tsx', 3]]);
    expect(lowered.map((c) => c.file)).toEqual(['b.tsx', 'c.tsx']);
  });
});

describe('react-hooks ratchet: serializeBaseline', () => {
  it('writes the header then path-sorted `path count` lines', async () => {
    const { serializeBaseline } = await load();
    const text = serializeBaseline(new Map([['z.tsx', 1], ['a.tsx', 2]]));
    expect(text.startsWith('# ')).toBe(true);
    expect(text.endsWith('a.tsx 2\nz.tsx 1\n')).toBe(true);
    expect(text).toContain('--allow-raise');
  });

  it('writes only the header for an empty baseline', async () => {
    const { serializeBaseline } = await load();
    const text = serializeBaseline(new Map());
    expect(text.split('\n').filter((line) => line && !line.startsWith('#'))).toEqual([]);
  });
});

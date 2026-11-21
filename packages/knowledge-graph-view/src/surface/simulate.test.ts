import { describe, expect, it } from 'vitest';
import { hopsFromEntry, hopsFromStops, hopsFromTrace, simulate, type JourneyHop } from './simulate';

const hops: JourneyHop[] = [
    { from: 'entry', to: 'mid', kind: 'calls' },
    { from: 'mid', to: 'end', kind: 'calls', produces: { name: 'out', value: '1' } },
    { from: 'end', to: 'done', kind: 'returns' },
];

describe('simulate', () => {
    it('carries entry values across every hop and does not mutate the input', () => {
        const values = [{ name: 'n', value: '2' }, { name: 'label', value: 'a' }];
        const before = values.map((v) => ({ ...v }));
        const steps = simulate({ values, hops });
        expect(values).toEqual(before);
        expect(steps).toHaveLength(3);
        for (const step of steps.slice(0, 2)) expect(step.carried).toEqual([{ name: 'n', value: '2' }, { name: 'label', value: 'a' }]);
        expect(steps.map((s) => [s.from, s.to, s.kind])).toEqual([
            ['entry', 'mid', 'calls'],
            ['mid', 'end', 'calls'],
            ['end', 'done', 'returns'],
        ]);
    });

    it('lets a later entry value with the same name win, and drops a blank name', () => {
        const steps = simulate({
            values: [{ name: 'n', value: '1' }, { name: '', value: 'x' }, { name: 'n', value: '9' }],
            hops: [{ from: 'a', to: 'b' }],
        });
        expect(steps[0]!.carried).toEqual([{ name: 'n', value: '9' }]);
        expect(steps[0]!.kind).toBeUndefined();
    });

    it('carries a hop production on the hops after it, not on itself', () => {
        const steps = simulate({ values: [{ name: 'n', value: '2' }], hops });
        expect(steps[0]!.carried).toEqual([{ name: 'n', value: '2' }]);
        expect(steps[1]!.carried).toEqual([{ name: 'n', value: '2' }]);
        expect(steps[2]!.carried).toEqual([{ name: 'n', value: '2' }, { name: 'out', value: '1' }]);
    });

    it('overrides an entry value when a later hop produces the same name', () => {
        const steps = simulate({
            values: [{ name: 'out', value: '0' }],
            hops: [{ from: 'a', to: 'b', produces: { name: 'out', value: '1' } }, { from: 'b', to: 'c' }],
        });
        expect(steps[0]!.carried).toEqual([{ name: 'out', value: '0' }]);
        expect(steps[1]!.carried).toEqual([{ name: 'out', value: '1' }]);
    });

    it('returns no hops when the journey is empty', () => {
        expect(simulate({ values: [{ name: 'n', value: '1' }], hops: [] })).toEqual([]);
    });
});

describe('hops from the journey and the trace', () => {
    it('pairs adjacent stops and keeps the path-strip kind', () => {
        expect(hopsFromStops(
            [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
            ['references', undefined],
        )).toEqual([
            { from: 'a', to: 'b', kind: 'references' },
            { from: 'b', to: 'c' },
        ]);
        expect(hopsFromStops([{ id: 'only' }])).toEqual([]);
    });

    it('reads trace steps the way TracePanel draws them', () => {
        const steps = hopsFromTrace([
            { from: 'src/app.ts', to: 'src/routes.ts', kind: 'calls', verdict: 'ok', cycle: false, back: true } as { from: string; to: string; kind?: string },
            { from: 'src/routes.ts', to: 'src/db.ts' },
        ]);
        expect(steps).toEqual([
            { from: 'src/app.ts', to: 'src/routes.ts', kind: 'calls' },
            { from: 'src/routes.ts', to: 'src/db.ts' },
        ]);
        expect(steps[0]).not.toHaveProperty('verdict');
    });

    it('starts the walk at an entry and leaves an unknown entry unchanged', () => {
        const all = hopsFromStops([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
        expect(hopsFromEntry(all, 'b')).toEqual([{ from: 'b', to: 'c' }]);
        expect(hopsFromEntry(all, 'missing')).toEqual(all);
        expect(hopsFromEntry(all, '')).toEqual(all);
    });
});

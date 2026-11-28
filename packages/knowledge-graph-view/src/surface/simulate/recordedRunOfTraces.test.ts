import { describe, expect, it } from 'vitest';
import { srcRef } from '@seanhogg/builderforce-memory/knowledge';
import type { RunTraces } from '../../types';
import { recordedRunOfTraces } from './recordedRunOfTraces';

const model = {
    stationOf: new Map<string, string>([
        [srcRef('r', 'api/a.ts'), 'api'],
        [srcRef('r', 'api/b.ts'), 'api'],
        [srcRef('r', 'db/c.ts'), 'db'],
    ]),
};
const traces = (...runs: RunTraces['runs'][number]['steps'][]): RunTraces => ({
    runs: runs.map((steps, i) => ({ id: `run-${i}`, at: '2026-11-27T00:00:00Z', steps })),
    skippedLines: 0,
});

describe('recordedRunOfTraces', () => {
    it('takes the newest run: arguments in, the return out, the FIRST call per stop only', () => {
        const t = traces(
            [{ path: 'api/a.ts', args: { old: '0' } }],
            [
                { path: 'api/a.ts', fn: 'charge', args: { amount: '100' }, ret: 'ok' },
                { path: 'api/b.ts', args: { later: '1' }, ret: 'again' },
                { path: 'db/c.ts', args: { id: '7' } },
            ],
        );
        expect(recordedRunOfTraces(t, 'r', model, ['api', 'db'])).toEqual({
            values: [
                { stopId: 'api', name: 'amount', value: '100', direction: 'in' },
                { stopId: 'api', name: 'return', value: 'ok', direction: 'out' },
                { stopId: 'db', name: 'id', value: '7', direction: 'in' },
            ],
        });
    });

    it('records nothing for a stop the run never entered, a path outside every station, or no traces', () => {
        const t = traces([{ path: 'api/a.ts', args: { x: '1' } }, { path: 'vendor/z.js', args: { y: '2' } }]);
        expect(recordedRunOfTraces(t, 'r', model, ['db'])).toBeNull();
        expect(recordedRunOfTraces(traces(), 'r', model, ['api'])).toBeNull();
        expect(recordedRunOfTraces(null, 'r', model, ['api'])).toBeNull();
    });
});

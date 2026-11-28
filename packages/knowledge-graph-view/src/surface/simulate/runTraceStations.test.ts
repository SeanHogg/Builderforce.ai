import { describe, expect, it } from 'vitest';
import type { RunTraces } from '../../types';
import { srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { stationOfStep, stationSequencesOf } from './runTraceStations';

const model = {
    stationOf: new Map<string, string>([
        [srcRef('r', 'api/a.ts'), 'api'],
        [srcRef('r', 'api/b.ts'), 'api'],
        [srcRef('r', 'db/c.ts'), 'db'],
        [srcRef('r', 'ui/d.ts'), 'ui'],
    ]),
};
const step = (path: string) => ({ path });
const traces = (...runs: string[][]): RunTraces => ({
    runs: runs.map((paths, i) => ({ id: `run-${i}`, at: '2026-11-27T00:00:00Z', steps: paths.map(step) })),
    skippedLines: 0,
});

describe('stationSequencesOf', () => {
    it('maps each step\'s file to its station and collapses consecutive visits to the same one', () => {
        expect(stationSequencesOf(traces(['api/a.ts', 'api/b.ts', 'db/c.ts', 'api/a.ts']), 'r', model)).toEqual([['api', 'db', 'api']]);
    });

    it('drops steps in no station, then collapses what that leaves adjacent', () => {
        expect(stationSequencesOf(traces(['api/a.ts', 'node_modules/x.js', 'api/b.ts', 'ui/d.ts']), 'r', model)).toEqual([['api', 'ui']]);
    });

    it('keeps runs oldest first and leaves out a run with no hop', () => {
        expect(stationSequencesOf(traces(['api/a.ts'], ['api/a.ts', 'db/c.ts'], ['ui/d.ts', 'api/a.ts']), 'r', model)).toEqual([['api', 'db'], ['ui', 'api']]);
    });

    it('is empty without traces', () => {
        expect(stationSequencesOf(null, 'r', model)).toEqual([]);
    });
});

describe('stationOfStep', () => {
    it('is the station of the step\'s file ref, and undefined for a file in no station', () => {
        expect(stationOfStep(model, 'r', { path: 'db/c.ts' })).toBe('db');
        expect(stationOfStep(model, 'r', { path: 'vendor/z.js' })).toBeUndefined();
    });
});

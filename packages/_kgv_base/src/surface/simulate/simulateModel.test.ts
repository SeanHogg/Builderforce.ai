/** The deterministic walk: recorded against edited values, stubs, and the honest "unknown". */
import { describe, expect, it } from 'vitest';
import type { RecordedRun } from '../../fixPorts';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import type { PathModel } from '../path';
import { argumentNames, simulate, stepAt } from './simulateModel';
import { saveTestRequest, runRequest, testFileName, valuesText } from './simulateRequests';

const path: PathModel = {
    stops: [{ id: 'api', name: 'Api' }, { id: 'svc', name: 'Service' }, { id: 'db', name: 'Db' }],
    hops: [{ kind: 'references', count: 2 }, { kind: 'references', count: 1 }],
};
const run: RecordedRun = {
    values: [
        { stopId: 'api', name: 'amount', value: '100', direction: 'in' },
        { stopId: 'svc', name: 'rows', value: '3', direction: 'out' },
        { stopId: 'db', name: 'response', value: 'ok', direction: 'out' },
    ],
};
const walk = (over: Partial<Parameters<typeof simulate>[0]> = {}) => simulate({ path, recorded: run, edits: {}, stubs: new Set(), labels: L, ...over });

describe('simulate', () => {
    it('one step per stop, each with a code line and the hop in words', () => {
        const steps = walk();
        expect(steps).toHaveLength(3);
        expect(steps[0]!.lines.map((l) => l.text)).toEqual(['enter Api', 'call Service']);
        expect(steps[0]!.lines[1]!.note).toContain('references');
        expect(steps[2]!.lines[1]!.text).toBe('return from Db');
    });

    it('accumulates the recorded values up to the step, and the result is the last recorded output', () => {
        const steps = walk();
        expect(steps[0]!.vars.map((v) => v.name)).toEqual(['amount']);
        expect(steps[0]!.result).toBeNull();
        expect(steps[1]!.result).toEqual({ value: '3', origin: 'recorded' });
        expect(steps[2]!.result).toEqual({ value: 'ok', origin: 'recorded' });
    });

    it('an edited input is shown as edited and makes later results unknown, never a guess', () => {
        const steps = walk({ edits: { amount: '5' } });
        expect(steps[2]!.vars[0]).toMatchObject({ name: 'amount', value: '5', origin: 'edited' });
        expect(steps[2]!.result).toEqual({ value: L.surface.simulate.unknownResult, origin: 'unknown' });
    });

    it('an edit equal to the recorded value is not an edit', () => {
        expect(walk({ edits: { amount: '100' } })[2]!.result?.origin).toBe('recorded');
    });

    it('a stubbed stop answers with its recorded value whatever came in', () => {
        const steps = walk({ edits: { amount: '5' }, stubs: new Set(['db']) });
        expect(steps[2]!.stubbed).toBe(true);
        expect(steps[2]!.result).toEqual({ value: 'ok', origin: 'recorded' });
    });

    it('with nothing recorded there are no variables and no result', () => {
        const steps = walk({ recorded: null });
        expect(steps.every((s) => s.vars.length === 0 && s.result === null)).toBe(true);
        expect(argumentNames(null)).toEqual([]);
    });

    it('adds the route label and the station note when given', () => {
        const steps = walk({ routeLabels: ['PUT 1.4 MB', null], notes: new Map([['api', 'no tests']]) });
        expect(steps[0]!.lines[0]!.note).toBe('no tests');
        expect(steps[0]!.lines[1]!.note).toContain('PUT 1.4 MB');
    });

    it('stepAt clamps into the walk', () => {
        const steps = walk();
        expect(stepAt(steps, -3)).toBe(steps[0]);
        expect(stepAt(steps, 99)).toBe(steps[2]);
        expect(stepAt([], 0)).toBeNull();
    });
});

describe('simulate requests', () => {
    it('names the test file from the stops, safely', () => {
        expect(testFileName(path)).toBe('api-service-db.test.ts');
        expect(testFileName({ stops: [{ id: 'w', name: 'Web line · GET /users/:id' }], hops: [] })).toBe('web-line-get-users-id.test.ts');
        expect(testFileName({ stops: [], hops: [] })).toBe('path.test.ts');
    });

    it('fills fixed requests from the path, the values and the stubs', () => {
        expect(valuesText({ a: '1', b: '2' }, 'none')).toBe('a=1, b=2');
        expect(valuesText({}, 'none')).toBe('none');
        expect(runRequest(path, { amount: '5' }, L)).toContain('Api → Service → Db');
        const save = saveTestRequest(path, { amount: '5' }, ['Db'], L);
        expect(save).toContain('api-service-db.test.ts');
        expect(save).toContain('amount=5');
        expect(save).toContain('Db');
        expect(saveTestRequest(path, {}, [], L)).toContain(L.surface.simulate.noStubs);
    });
});

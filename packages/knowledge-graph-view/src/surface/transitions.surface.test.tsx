// @vitest-environment jsdom
/** PRD 38 P7: Simulate follows the most likely walk (the path strip no longer draws hop probabilities). */
import { describe, expect, it } from 'vitest';
import { stationTransitions } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import type { PathModel } from './path';
import { simulate } from './simulate/simulateModel';

const path: PathModel = {
    stops: [{ id: 'api', name: 'Api' }, { id: 'svc', name: 'Service' }, { id: 'db', name: 'Db' }],
    hops: [{ kind: 'references', count: 3 }, { kind: 'references', count: 2 }],
};
const stations = new Map([['api', { name: 'Api' }], ['svc', { name: 'Service' }], ['db', { name: 'Db' }], ['cache', { name: 'Cache' }]]);
const weights = [
    { from: 'api', to: 'svc', weight: 3 }, { from: 'api', to: 'cache', weight: 1 },
    { from: 'svc', to: 'db', weight: 2 },
];
const referenced = stationTransitions({ weights });
const traced = stationTransitions({ sequences: [['api', 'svc']], weights });

describe('simulate follows the most likely walk', () => {
    const steps = (transitions: Parameters<typeof simulate>[0]['transitions']) =>
        simulate({ path, recorded: null, edits: {}, stubs: new Set(), labels: L, transitions, stations });

    it('each step carries mostLikelyWalk from its stop, and each call line its hop probability', () => {
        const s = steps(referenced);
        expect(s[0]!.walk!.map((h) => [h.name, h.rate])).toEqual([['Service', '3 of 4 references'], ['Db', '2 of 2 references']]);
        expect(s[1]!.walk!.map((h) => h.to)).toEqual(['db']);
        expect(s[2]!.walk).toEqual([]);
        expect(s[0]!.lines[1]!.note).toBe('references · 3 · next 3 of 4 references');
    });

    it('without a table there is no walk and no probability', () => {
        const s = steps(null);
        expect(s[0]!.walk).toBeNull();
        expect(s[0]!.lines[1]!.note).not.toContain('next');
    });
});

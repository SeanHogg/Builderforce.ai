import { describe, expect, it } from 'vitest';
import type { PathModel } from './path';
import { sequenceOf, toSequenceMermaid } from './sequenceModel';

const path: PathModel = {
    stops: [{ id: 'a', name: 'Web app' }, { id: 'b', name: 'API: v2' }, { id: 'c', name: 'repos' }],
    hops: [{ kind: 'references', count: 3 }, { kind: 'references', count: 1, verdict: 'skips' }],
};

describe('sequenceOf', () => {
    it('is a lifeline per stop and a message per hop between neighbours', () => {
        const seq = sequenceOf(path);
        expect(seq.lifelines).toHaveLength(3);
        expect(seq.messages.map((m) => [m.from, m.to])).toEqual([[0, 1], [1, 2]]);
        expect(sequenceOf({ stops: [], hops: [] }).messages).toEqual([]);
    });
});

describe('toSequenceMermaid', () => {
    it('writes participants and messages, and strips what breaks Mermaid', () => {
        const text = toSequenceMermaid(sequenceOf(path), (h) => `refs; ${h.count}`);
        expect(text.split('\n')).toEqual([
            'sequenceDiagram',
            '    participant P1 as Web app',
            '    participant P2 as API v2',
            '    participant P3 as repos',
            '    P1->>P2: refs 3',
            '    P2->>P3: refs 1',
        ]);
    });
});

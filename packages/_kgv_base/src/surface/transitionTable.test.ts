/** PRD 38 P7: the station transition table (built once per graph from memory's maths) and its words. */
import { describe, expect, it } from 'vitest';
import { stationTransitions, transitionOf } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { mapEdges } from './outlineGraph';
import { hopCountsOf } from './path';
import { graph, model } from './testFixtures';
import { hopProbabilityText, hopTransition, likelyWalk, transitionTableOf } from './transitionTable';

describe('transitionTableOf', () => {
    it('rows every station that references another, from the directed station weights, as references', () => {
        const { weights } = hopCountsOf(model, mapEdges(graph));
        expect(weights.length).toBeGreaterThan(0);
        const table = transitionTableOf(graph, model);
        for (const w of weights) {
            const hop = transitionOf(table, w.from, w.to)!;
            expect(hop.k).toBe(w.weight);
            expect(hop.low).toBeUndefined();
            expect(table.get(w.from)!.source).toBe('references');
        }
    });

    it('is built once per graph and station map', () => {
        expect(transitionTableOf(graph, model)).toBe(transitionTableOf(graph, model));
    });

    it('a station the traces leave reads from the traces, with an interval', () => {
        const [a, b] = model.stations.map((s) => s.id);
        const table = transitionTableOf(graph, model, [[a!, b!], [a!, b!]]);
        expect(table.get(a!)!.source).toBe('traces');
        const hop = transitionOf(table, a!, b!)!;
        expect([hop.k, hop.n]).toEqual([2, 2]);
        expect(hop.low).toBeDefined();
    });
});

describe('hop probability text', () => {
    const traced = stationTransitions({ sequences: [['a', 'b']], weights: [] });
    const referenced = stationTransitions({ weights: [{ from: 'a', to: 'b', weight: 2 }, { from: 'a', to: 'c', weight: 3 }] });

    it('a trace hop under 10 runs reads ≈ with its interval, and 1-of-1 never reads as 100%', () => {
        const text = hopProbabilityText(L, hopTransition(traced, 'a', 'b'))!;
        expect(text.startsWith('next ≈ ')).toBe(true);
        expect(text).toMatch(/\(\d+–\d+\)/);
        expect(text).toContain('n = 1');
        expect(text).not.toContain('100%');
    });

    it('a reference hop reads as a share of references, with no interval', () => {
        expect(hopProbabilityText(L, hopTransition(referenced, 'a', 'b'))).toBe('next 2 of 5 references');
    });

    it('absent data gives no probability, never a guess', () => {
        expect(hopTransition(referenced, 'b', 'a')).toBeUndefined();
        expect(hopTransition(null, 'a', 'b')).toBeUndefined();
        expect(hopProbabilityText(L, undefined)).toBeNull();
    });
});

describe('likelyWalk', () => {
    const table = stationTransitions({ weights: [{ from: 'a', to: 'b', weight: 3 }, { from: 'a', to: 'c', weight: 1 }, { from: 'b', to: 'c', weight: 1 }, { from: 'c', to: 'a', weight: 1 }] });
    const byId = new Map([['a', { name: 'A' }], ['b', { name: 'B' }], ['c', { name: 'C' }]]);

    it('follows the likeliest unvisited hop, naming each stop with its probability', () => {
        expect(likelyWalk(table, 'a', byId, L)).toEqual([
            { from: 'a', to: 'b', name: 'B', rate: '3 of 4 references' },
            { from: 'b', to: 'c', name: 'C', rate: '1 of 1 references' },
        ]);
    });

    it('a station with no row has no walk', () => {
        expect(likelyWalk(table, 'z', byId, L)).toEqual([]);
    });
});

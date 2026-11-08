import { describe, expect, it, vi } from 'vitest';
import { Residency } from './residency';
import { makeGraph } from './testKit';

describe('Residency', () => {
    it('graphId is idempotent and sends nothing during the call', () => {
        const evicted = vi.fn();
        const r = new Residency(evicted);
        const g = makeGraph();
        expect(r.graphId(g)).toBe(r.graphId(g));
        for (let i = 0; i < 5; i++) r.graphId(makeGraph());
        expect(evicted).not.toHaveBeenCalled(); // eviction is deferred out of the render that asked
    });

    it('the empty graph does not count toward residency', async () => {
        const evicted = vi.fn();
        const r = new Residency(evicted);
        const first = makeGraph();
        const id = r.graphId(first);
        for (let i = 0; i < 3; i++) r.graphId(makeGraph());
        for (let i = 0; i < 3; i++) r.graphId(makeGraph(0));
        await Promise.resolve();
        expect(evicted).not.toHaveBeenCalled();
        expect(r.isLive(id)).toBe(true);
    });

    it('evicts the least recently used in a microtask', async () => {
        const evicted = vi.fn();
        const r = new Residency(evicted);
        const first = makeGraph();
        const id = r.graphId(first);
        for (let i = 0; i < 4; i++) r.graphId(makeGraph());
        await Promise.resolve();
        expect(evicted).toHaveBeenCalledWith(id);
        expect(r.isLive(id)).toBe(false);
        expect(r.graphId(first)).not.toBe(id); // never reused
    });

    it('names a subset by index: a run by one scan, an out-of-order set by lookup, the graph itself by identity', () => {
        const r = new Residency(vi.fn());
        const g = makeGraph(4);
        const id = r.graphId(g);
        const run = r.locate({ nodes: g.nodes.slice(1, 3) });
        expect(run.graph).toBe(id);
        expect(Array.from(run.nodes!)).toEqual([1, 2]);
        expect(Array.from(r.locate({ nodes: [g.nodes[3]!, g.nodes[0]!] }).nodes!)).toEqual([3, 0]);
        expect(Array.from(r.locate({ nodes: g.nodes, edges: g.edges }).edges!)).toEqual([0, 1, 2]);
    });

    it('a subset of no held graph becomes a stand-alone graph of exactly those arrays', () => {
        const r = new Residency(vi.fn());
        const g = makeGraph(2);
        const refs = r.locate({ nodes: g.nodes });
        expect(r.handleOf(refs.graph)!.graph.nodes).toBe(g.nodes);
    });

    it('graphs are immutable: in development a resident graph cannot be changed in place', () => {
        const r = new Residency(vi.fn());
        const g = makeGraph(2);
        r.graphId(g);
        expect(Object.isFrozen(g.nodes)).toBe(true);
        expect(Object.isFrozen(g.edges)).toBe(true);
        expect(() => (g.nodes as unknown[]).push({})).toThrow(TypeError);
    });
});

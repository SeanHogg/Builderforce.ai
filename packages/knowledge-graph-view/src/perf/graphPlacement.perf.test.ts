/// <reference types="node" />
/**
 * The Graph placement's worker time (PRD 43 P3), a measurement, not a gate: the harness graph (3,138 nodes, Graph at its
 * 2,000 LOD cap) and the 10k graph (`scale: 3.19`, LOD 1 = every node). Split into the stepped part (the 2D layout's
 * relaxation, the edge ranking, then one slice each for the nodes + anchoring, the bundling and the captions per zoom
 * band — each step yields to the worker's queue; `tailStepsMs` are those last three) and the final `result()`
 * (packing). Skipped unless `KG_PERF=1`:
 *
 *   PowerShell, from this package folder:   $env:KG_PERF='1'; node ../../frontend/node_modules/vitest/vitest.mjs run --config vitest.config.ts src/perf/graphPlacement
 */

import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { buildStageModel } from '../compute/tasks/stageModel';
import { PLACEMENTS } from '../compute/tasks/placement';
import { buildPerfGraph } from './syntheticGraph';

describe.skipIf(!process.env.KG_PERF)('Graph placement time (KG_PERF=1)', () => {
    it.each([['harness, lod 0', 1, 0], ['10k, lod 1', 3.19, 1]] as const)('%s', (name, scale, lod) => {
        const graph = buildPerfGraph({ scale }).graph;
        const model = buildStageModel(graph, []);
        const t0 = performance.now();
        const task = PLACEMENTS.graph(graph, model, { graph: 1, generation: model.marks.generation, camera: 'graph', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 3, lod });
        let steps = 0, longest = 0;
        const times: number[] = [];
        for (;;) {
            const s = performance.now();
            const done = task.step();
            const ms = performance.now() - s;
            times.push(ms);
            longest = Math.max(longest, ms);
            steps++;
            if (done) break;
        }
        const t1 = performance.now();
        const p = task.result();
        const t2 = performance.now();
        const groups = new Set(p.links[0]!.group).size;
        console.log(JSON.stringify({
            graph: name, nodes: graph.nodes.length, edges: graph.edges.length, shown: p.a11y.length,
            steppedMs: Math.round(t1 - t0), steps, longestStepMs: Math.round(longest), tailStepsMs: times.slice(-3).map(Math.round), resultMs: Math.round(t2 - t1), totalMs: Math.round(t2 - t0),
            polylines: groups, segments: p.links[0]!.tone.length, edgesShown: p.caption.edges?.shown, edgesTotal: p.caption.edges?.total, labelRuns: p.labels.length,
        }));
        expect(p.a11y.length).toBeGreaterThan(0);
    }, 600_000);
});

/// <reference types="node" />
/**
 * Profiling harness (a measurement, not a gate): which pure computation of each view blocks the main thread for the
 * real user graph that freezes the UI (see `PERF_STATS`). Skipped unless `KG_PERF=1`.
 *
 *   PowerShell, from this package folder:   $env:KG_PERF='1'; node ../../frontend/node_modules/vitest/vitest.mjs run --config vitest.config.ts src/perf
 *
 * Block 1 times every pure step between "graph arrives" and "first frame" (median of 3 runs + max; idle-step tasks also
 * report their longest single step: over 50 ms locks the screen). Block 2 renders Graph 2D, Mind map, Transit map,
 * Tower map and Sequence once each with this graph. Output: a sorted table on the console and `last-run.json` here.
 */

import { createElement as h, type ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { Graph2D } from '../graph2d/Graph2D';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { LENSES } from '../lenses';
import { MindMap } from '../map/MindMap';
import { SequenceView } from '../surface/SequenceDiagram';
import { TransitMap } from '../surface/TransitMap';
import { LAST_RUN_JSON, LOCK_MS, Recorder, writeReport } from './harness';
import { runModelSteps, type Shared } from './modelSteps';
import { runSceneSteps } from './sceneSteps';
import { runWorkerSteps } from './workerSteps';
import { buildPerfGraph, describeGraph, PERF_STATS, type PerfGraph } from './syntheticGraph';
import { runMindSteps, runSequenceSteps, runTransitSteps } from './viewSteps';

interface RenderRow { view: string; syncRenderMs: number; firstFrameMs: number | null; completeMs: number | null; longestStallMs: number; domElements: number; error?: string }

const HOUR = 3_600_000;

describe.skipIf(!process.env.KG_PERF)('view pipelines (KG_PERF=1)', () => {
    let perf: PerfGraph;
    const rec = new Recorder();
    const shared: Shared = {};
    const renders: RenderRow[] = [];
    let stats: Record<string, number> = {};

    beforeAll(() => { perf = buildPerfGraph(); stats = describeGraph(perf.graph); });

    it('the synthetic graph has the stats of the real one', () => {
        const s = PERF_STATS;
        expect(stats).toMatchObject({
            nodes: s.nodes, areas: s.areas, files: s.files, missing: s.missing, edges: s.edges, references: s.references, contains: s.contains, coChanged: s.coChanged, links: s.links,
            findings: s.findings, partitionViolation: s.partitionViolation, godModule: s.godModule, brokenLink: s.brokenLink, orphan: s.orphan, unpartitioned: s.unpartitioned,
            outlineFiles: s.outlineFiles, entryPoints: s.entryPoints, unpartitionedPct: 36,
        });
        expect(stats.maxInDegree).toBeGreaterThan(2000); // a few hubs with thousands of in-edges
        expect(perf.graph.stats.truncated).toBe(true);
    });

    it('times every pure step', () => {
        const attempt = (name: string, fn: () => void): void => {
            try { fn(); } catch (error) { rec.unreachable(name, '', String((error as Error)?.message ?? error)); }
        };
        attempt('model layer', () => { runModelSteps(rec, perf, shared); });
        const drawn = shared.visible;
        expect.soft(drawn?.nodes.length).toBe(PERF_STATS.drawnNodes);
        expect.soft(drawn?.edges.length).toBe(PERF_STATS.drawnEdges);
        expect.soft(shared.stations?.stations.length).toBe(PERF_STATS.stations);
        expect.soft(shared.stations?.stations.filter((x) => x.entry).length).toBe(PERF_STATS.stationLayers.entry);
        expect.soft(shared.lines?.lines.length).toBe(8);
        attempt('Graph 2D + 3D scene', () => runSceneSteps(rec, perf, shared));
        attempt('Worker path (main-thread halves)', () => runWorkerSteps(rec, perf, shared));
        attempt('Transit map + Tower map', () => runTransitSteps(rec, perf, shared));
        attempt('Mind map', () => runMindSteps(rec, perf));
        attempt('Sequence', () => runSequenceSteps(rec, shared));
        rec.unreachable('WebGL canvas (GraphScene / Towers / Pipes meshes, three.js)', '3D scene, Towers', 'no WebGL in jsdom: only the pure inputs to the canvas are measured');
    }, HOUR);

    describe('renders (jsdom, one render each)', () => {
        let rect: ReturnType<typeof vi.spyOn> | undefined;
        beforeAll(() => {
            rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 1280, bottom: 720, width: 1280, height: 720, toJSON: () => ({}) });
        });
        afterAll(() => rect?.mockRestore());

        async function measure(view: string, el: () => ReactElement, first: string, complete?: string): Promise<void> {
            const row: RenderRow = { view, syncRenderMs: 0, firstFrameMs: null, completeMs: null, longestStallMs: 0, domElements: 0 };
            let last = performance.now();
            const beat = setInterval(() => { const n = performance.now(); row.longestStallMs = Math.max(row.longestStallMs, n - last - 5); last = n; }, 5);
            const t0 = performance.now();
            try {
                const utils = render(el());
                row.syncRenderMs = performance.now() - t0;
                const reach = async (selector: string): Promise<number> => {
                    await waitFor(() => { if (!utils.container.querySelector(selector)) throw new Error(`no ${selector} yet`); }, { timeout: 600_000, interval: 20 });
                    return performance.now() - t0;
                };
                row.firstFrameMs = await reach(first);
                if (complete) row.completeMs = await reach(complete);
                row.domElements = utils.container.querySelectorAll('*').length;
            } catch (error) {
                row.error = String((error as Error)?.message ?? error).slice(0, 300);
            } finally {
                clearInterval(beat);
                cleanup();
            }
            for (const k of ['syncRenderMs', 'firstFrameMs', 'completeMs', 'longestStallMs'] as const) if (row[k] !== null) row[k] = Math.round((row[k] as number) * 10) / 10;
            renders.push(row);
        }

        it('renders the four views', async () => {
            const { stations, lines, overlay, drawn } = shared;
            const g = perf.graph;
            const files = g.nodes.filter((n) => n.kind === 'file');
            const none = () => undefined;
            if (drawn) {
                await measure('Graph 2D', () => h(Graph2D, {
                    rootId: g.scope.rootId, nodes: drawn.nodes, edges: drawn.edges, lens: LENSES.structure, selected: null, onSelect: none,
                    planeLabel: (x: string) => x || L.partitionNone, labels: L, label: L.regionLabel,
                }), 'g[data-id]', 'path[data-edge]');
            }
            await measure('Mind map', () => h(MindMap, {
                nodes: files, findings: g.findings, rootTitle: 'perf', selected: null, focus: [], onSelect: none, onShow: none, labels: L, label: L.regionLabel,
            }), 'g[data-id]');
            if (stations && lines && overlay) {
                for (const variant of ['map', 'tower'] as const) {
                    await measure(variant === 'map' ? 'Transit map' : 'Tower map', () => h(TransitMap, {
                        stations, lines, overlay, labels: L, lit: null, lineId: lines.lines[0]?.id ?? null, selectedStation: null, pins: [], reducedMotion: true,
                        onSelectStation: none, onSelectLine: none, label: 'map', graph: g, variant,
                    }), '[data-station]');
                }
            }
            const best = lines && stations ? [...lines.lines].sort((a, b) => b.stops.length - a.stops.length)[0] : undefined;
            if (best && stations) {
                const path = { stops: best.stops.map((id) => ({ id, name: stations.byId.get(id)?.name ?? id })), hops: best.hops.map((x) => ({ kind: 'references', count: x.count })) };
                await measure('Sequence', () => h(SequenceView, { path: path as never, step: 0, onStep: none, labels: L }), '[data-testid="kg-sequence"]');
            }
            expect(renders.length).toBeGreaterThan(0);
        }, HOUR);
    });

    afterAll(() => {
        const rows = [...rec.rows].sort((a, b) => b.median - a.median);
        console.log(`\nKnowledge-graph view pipelines (median of 3, ms; "(!)" = a single step over 50 ms)\n${rec.table()}`);
        const longest = rec.longestSteps();
        console.log(`\nLongest single main-thread step per sliced pipeline / worker half (limit ${LOCK_MS} ms; (!) = over)\n${longest.map((l) => `${String(l.ms).padStart(9)}${l.over ? ' (!)' : '    '}  ${l.step}`).join('\n')}`);
        console.log(`\nRenders (jsdom)\n${renders.map((r) => JSON.stringify(r)).join('\n')}`);
        writeReport({ generatedAt: new Date().toISOString(), node: process.version, graph: stats, steps: rows, longestMainThreadSteps: longest, overBudget: longest.filter((l) => l.over).map((l) => l.step), renders });
        console.log(`\nwrote ${LAST_RUN_JSON}`);
    });
});

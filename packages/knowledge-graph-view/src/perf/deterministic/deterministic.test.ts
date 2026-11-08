/// <reference types="node" />
/**
 * The deterministic performance gate for the knowledge-graph visualizer: counts and bytes that are IDENTICAL on every run, so
 * a regression is a failing test rather than a noisy chart. It proves that the heavy work runs off the main thread, what still
 * crosses the wire, and what the main thread still does, in two layers:
 *
 *  - HARD INVARIANTS, true whatever any baseline says (no main-thread compute on a big graph, an index-only wire, bounded upload
 *    slices, worker == in-process results, two runs identical, small graphs computed inline);
 *  - a RATCHETED BASELINE (`baseline.gate.json`, `baseline.full.json`, committed): every metric is lower-is-better and compared
 *    exactly. A regression fails; an improvement is printed and locked in with `KG_PERF_UPDATE=1`. A missing file is written
 *    on the first run.
 *
 * The gate scale runs in the normal `npm test`; the full-size graph (the real user's) only with `KG_PERF=1`. The wall-clock
 * harness next to it (`viewPipelines.perf.test.ts`) says which step is slow; this says whether the move off-thread held.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { INLINE_WEIGHT } from '../../compute/size';
import { DEFER_EDGES_ABOVE } from '../../scene/edgeBudget';
import { compareMetrics, formatComparison, readBaseline, UPDATE_BASELINE, writeBaseline, type Metrics } from './baseline';
import { profile, type Profile } from './profile';
import { formatTable } from './report';
import type { ViewHost } from './renderProbe';

// jsdom has no WebGL: the 3D scene is stubbed exactly as KnowledgeGraphView.views.test.tsx does.
vi.mock('../../scene/GraphScene', () => ({ default: () => null }));

/**
 * 15% of the real user graph: the smallest size at which every worker path is still taken (asserted below: the graph outweighs
 * INLINE_WEIGHT several times over, and the drawn edges pass DEFER_EDGES_ABOVE), so each view renders in seconds, not minutes.
 */
const GATE_SCALE = 0.15;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOUR = 3_600_000;

const host: ViewHost = {
    render: (element) => render(element).container,
    act: async (work) => { await act(work); },
    click: (element) => { fireEvent.click(element); },
    cleanup,
    environment: () => {
        const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 1280, bottom: 720, width: 1280, height: 720, toJSON: () => ({}) });
        const webgl = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({})) as never);
        vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
        return () => { vi.unstubAllGlobals(); webgl.mockRestore(); rect.mockRestore(); };
    },
};

/** Writes the baseline when there is none (or `KG_PERF_UPDATE=1`); otherwise fails on a regression or a vanished metric. */
function ratchet(name: string, metrics: Metrics): void {
    const file = path.join(HERE, `baseline.${name}.json`);
    const baseline = readBaseline(file);
    if (baseline === null || UPDATE_BASELINE) {
        writeBaseline(file, metrics);
        console.log(`deterministic profile (${name}): baseline written to ${file} (${Object.keys(metrics).length} metrics)`);
        return;
    }
    const change = compareMetrics(metrics, baseline);
    console.log(`deterministic profile (${name}) against its baseline\n${formatComparison(change)}`);
    if (change.improvements.length > 0) console.log('improvements found: KG_PERF_UPDATE=1 to ratchet the baseline');
    if (change.added.length > 0) console.log('new metrics are not in the baseline: KG_PERF_UPDATE=1 to record them');
    // A view or task that vanished would hide whatever it cost: re-recording the baseline is a deliberate act.
    expect(change.regressions, formatComparison(change)).toEqual([]);
    expect(change.removed, `metrics missing from this run (KG_PERF_UPDATE=1 if intended): ${change.removed.join(', ')}`).toEqual([]);
}

function defineProfile(name: string, scale: number, timeout: number): void {
    let first: Profile, second: Profile;
    beforeAll(async () => {
        first = await profile(scale, host);
        second = await profile(scale, host); // the whole profile twice: determinism is asserted, not hoped for
        console.log(`deterministic profile (${name}, scale ${scale}): views ${first.viewIds.join(', ')}\n${formatTable(first.metrics)}`);
    }, timeout);

    it('is large enough to take every worker path', () => {
        expect(first.invariants.weight).toBeGreaterThan(INLINE_WEIGHT);
        expect(first.invariants.drawnEdges).toBeGreaterThan(DEFER_EDGES_ABOVE);
        expect(first.invariants.skippedViews, 'every view of the camera bar is visited').toEqual([]);
    });

    it('computes nothing on the main thread, in any view', () => {
        expect(first.invariants.mainThreadEvents).toEqual([]);
    });

    it('sends only indices: no graph element in a run request or a done reply, no failed reply', () => {
        expect(first.invariants.runDoneElementRefs).toBe(0);
        expect(first.invariants.failedReplies).toBe(0);
    });

    it('uploads the graph in bounded slices', () => {
        expect(first.invariants.oversizedChunks).toEqual([]);
    });

    it('answers exactly what the main thread would have, for every task kind', () => {
        expect(first.invariants.parity.length).toBe(12);
        for (const row of first.invariants.parity) expect(row.worker, row.kind).toBe(row.inProcess);
    });

    it('is the same on every run', () => {
        expect(second.metrics).toEqual(first.metrics);
        expect(second.invariants.parity).toEqual(first.invariants.parity);
    });

    it('computes a small graph in the same render', () => {
        expect(first.invariants.smallNotInline).toEqual([]);
        expect(first.invariants.smallInline).toBeGreaterThan(0);
    });

    it('does not regress against the committed baseline', () => { ratchet(name, first.metrics); });
}

describe('deterministic profile (gate scale)', () => { defineProfile('gate', GATE_SCALE, 600_000); });
describe.skipIf(!process.env.KG_PERF)('deterministic profile (full scale)', () => { defineProfile('full', 1, HOUR); });

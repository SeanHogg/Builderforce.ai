/**
 * One deterministic profile of the visualizer at a given scale: the numbers the suite ratchets (`metrics`, flat ids, all
 * lower-is-better) and the facts it asserts regardless of any baseline (`invariants`). Sharing one function lets the gate scale
 * and the full scale differ only in the size of the graph.
 *
 * Three independent measurements, each on its OWN freshly built graph (the pure functions memoise on array identity, so a graph
 * shared between them would make a later measurement cheaper than a cold one):
 *   1. parity + GPU budget: every task kind through the loopback worker and in-process, then the scene budget from the results;
 *   2. the whole view on the large graph: per-view main-thread work, the wire, the worker's task ledger;
 *   3. the whole view on a small graph: the other side of the INLINE_WEIGHT threshold.
 */

import type { ComputeTaskEvent } from '../../compute/client';
import { LINK_SLICE, UPLOAD_SLICE } from '../../compute/loader';
import type { TaskKind } from '../../compute/protocol';
import { weightOf } from '../../compute/size';
import { makeGraph } from '../../compute/testKit';
import { makeOverlay, PRESETS } from '../../surface/overlays';
import { buildPerfGraph } from '../syntheticGraph';
import type { Metrics } from './baseline';
import { sceneBudget } from './gpuBudget';
import { runParity, type ParityRow } from './parity';
import { probeViews, type RenderReport, type ViewHost } from './renderProbe';

/** Kinds whose call sites choose inline-or-worker by the size of the graph (the others always go to the worker). */
export const SIZE_GATED: readonly TaskKind[] = ['focus', 'insights', 'partitionMatrix', 'antiPatterns', 'surface', 'path', 'rankEdges', 'edgePaths'];

export interface Invariants {
    weight: number;
    drawnEdges: number;
    /** Compute events that ran on the main thread over every view of the large graph. */
    mainThreadEvents: ComputeTaskEvent[];
    /** Graph elements found inside `run` requests and `done` replies. */
    runDoneElementRefs: number;
    failedReplies: number;
    /** Upload slices larger than the loader's limit. */
    oversizedChunks: string[];
    parity: ParityRow[];
    skippedViews: string[];
    /** Small graph: size-gated events that did not run inline, and how many ran inline. */
    smallNotInline: ComputeTaskEvent[];
    smallInline: number;
}

export interface Profile { invariants: Invariants; metrics: Metrics; viewIds: string[] }

function viewMetrics(report: RenderReport, into: Metrics): void {
    for (const v of report.views) {
        into[`view:${v.id}:main.reads.mount`] = v.mountReads;
        into[`view:${v.id}:main.reads.settle`] = v.settleReads;
        into[`view:${v.id}:commits`] = v.commits;
        into[`view:${v.id}:dom`] = v.dom;
        into[`view:${v.id}:tasks.worker`] = v.workerTasks;
    }
}

function wireMetrics(report: RenderReport, into: Metrics): void {
    for (const [key, g] of Object.entries(report.wire.groups)) {
        into[`wire:${key}:bytes`] = g.bytes;
        into[`wire:${key}:messages`] = g.messages;
        into[`wire:${key}:maxBytes`] = g.maxBytes;
    }
    into['wire:maxMessageBytes'] = report.wire.maxMessageBytes;
}

function taskMetrics(report: RenderReport, into: Metrics): void {
    for (const t of report.tasks) {
        into[`worker:${t.kind}:reads`] = (into[`worker:${t.kind}:reads`] ?? 0) + t.totalReads;
        into[`worker:${t.kind}:maxReadsPerStep`] = Math.max(into[`worker:${t.kind}:maxReadsPerStep`] ?? 0, t.maxReadsPerStep);
        into[`worker:${t.kind}:steps`] = (into[`worker:${t.kind}:steps`] ?? 0) + t.steps;
    }
}

/** Slices larger than the loader promises. `outlineLinks` travels as four numbers per link, so its limit is four times LINK_SLICE. */
function oversized(report: RenderReport): string[] {
    return report.wireEntries
        .filter((e) => e.type === 'load-chunk' && (e.items ?? 0) > (e.field === 'outlineLinks' ? LINK_SLICE * 4 : UPLOAD_SLICE))
        .map((e) => `${e.field}: ${e.items}`);
}

export async function profile(scale: number, host: ViewHost): Promise<Profile> {
    const metrics: Metrics = {};

    const measured = buildPerfGraph({ scale }).graph;
    const parity = await runParity(measured);
    const { drawn, surface, layout3, picked } = parity;
    const overlay = makeOverlay(PRESETS.risk, surface.stations.stations);
    for (const [key, value] of Object.entries(sceneBudget({ nodes: drawn.nodes, edges: drawn.edges, picked, layout: layout3, stations: surface.stations, overlay, findings: measured.findings }))) metrics[`gpu:${key}`] = value;

    const large = await probeViews(buildPerfGraph({ scale }).graph, host);
    viewMetrics(large, metrics);
    wireMetrics(large, metrics);
    taskMetrics(large, metrics);

    const small = await probeViews(makeGraph(50), host);
    const smallGated = small.probe.events.filter((e) => SIZE_GATED.includes(e.kind));

    return {
        metrics,
        viewIds: large.views.map((v) => v.id),
        invariants: {
            weight: weightOf(measured), drawnEdges: drawn.edges.length,
            mainThreadEvents: large.probe.mainThread(),
            runDoneElementRefs: large.wireEntries.filter((e) => (e.dir === 'in' && e.type === 'run') || (e.dir === 'out' && e.type === 'done')).reduce((n, e) => n + e.elementRefs, 0),
            failedReplies: large.wireEntries.filter((e) => e.type === 'failed').length,
            oversizedChunks: oversized(large),
            parity: parity.rows,
            skippedViews: large.skipped,
            smallNotInline: smallGated.filter((e) => e.realm !== 'main-inline'),
            smallInline: smallGated.filter((e) => e.realm === 'main-inline').length,
        },
    };
}

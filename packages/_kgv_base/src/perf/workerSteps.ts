/**
 * The worker path, main-thread halves only. The worker itself cannot run under Node/vitest, and its compute is off-thread, so
 * what is timed here is what the main thread still pays per task: `encode` (name the elements by index, `Residency.locate`) plus
 * the `postMessage` structured clone of the request (`structuredClone` stands in for it), and on the way back the reply's
 * deserialisation (`structuredClone` of the raw reply) plus `decode` (map it onto the caller's own objects). The worker's compute
 * is produced UNTIMED, by the same `HANDLERS` the worker runs, to give `decode` a real reply. Graph upload is measured as the
 * `ComputeClient.stream` loop does it: slices of UPLOAD_SLICE elements, each cloned by one `postMessage` (one task step per slice).
 *
 * Cold: every encode gets a fresh `Residency` (its index caches are WeakMaps keyed by the arrays), so the first-use cost shows.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { CODECS } from '../compute/codecs';
import { LINK_SLICE, UPLOAD_SLICE } from '../compute/loader';
import type { KindInput, KindResult } from '../compute/kinds';
import type { TaskKind } from '../compute/protocol';
import { Residency } from '../compute/residency';
import { ComputeStore } from '../compute/store';
import { HANDLERS } from '../compute/tasks';
import { pickEdges } from '../scene/edgeBudget';
import { stepLabels, type Recorder } from './harness';
import type { Shared } from './modelSteps';
import type { PerfGraph } from './syntheticGraph';
import { sceneInputs } from './taskInputs';


interface AnyCodec { encode(input: never, residency: Residency): { graph: number; req: unknown }; decode(raw: never, input: never): unknown }

const noop = (): void => undefined;

function roundTrip<K extends TaskKind>(rec: Recorder, p: PerfGraph, kind: K, views: string, inputs: string, input: KindInput<K>): KindResult<K> | undefined {
    const codec = CODECS[kind] as unknown as AnyCodec;
    const freshResidency = (): Residency => { const r = new Residency(noop); r.graphId(p.graph); return r; };
    let raw: unknown;
    try {
        // UNTIMED: the worker's side, run with the worker's own handler.
        const residency = freshResidency();
        const { graph, req } = codec.encode(input as never, residency);
        const store = new ComputeStore();
        store.adopt(graph, residency.handleOf(graph)!.graph);
        const task = HANDLERS[kind](store, req as never) as { step(): boolean; result(): unknown };
        while (!task.step());
        raw = task.result();
    } catch (error) {
        rec.unreachable(`worker main-thread: ${kind}`, views, `worker side failed: ${String((error as Error)?.message ?? error)}`);
        return undefined;
    }
    rec.time(`worker main-thread: encode + post (${kind})`, views, inputs, (r: Residency) => structuredClone(codec.encode(input as never, r).req), freshResidency);
    return rec.time(`worker main-thread: receive + decode (${kind})`, views, inputs, () => codec.decode(structuredClone(raw) as never, input as never)) as KindResult<K> | undefined;
}

/** The graph upload as steps: one slice cloned per step, as `ComputeClient.stream` posts them. */
function uploadTask(graph: KnowledgeGraph): { step(): boolean; result(): number } {
    const fields: Array<readonly unknown[]> = [graph.nodes, graph.edges, graph.findings, graph.outline?.files ?? []];
    const links = graph.outline?.links ?? [];
    const jobs: Array<() => void> = [];
    for (const list of fields) for (let at = 0; at < list.length; at += UPLOAD_SLICE) jobs.push(() => { structuredClone(list.slice(at, at + UPLOAD_SLICE)); });
    for (let at = 0; at < links.length; at += LINK_SLICE) {
        jobs.push(() => {
            const flat = new Uint32Array(Math.min(LINK_SLICE, links.length - at) * 4);
            for (let i = 0; i < flat.length / 4; i++) flat.set(links[at + i]!, i * 4);
            structuredClone(flat, { transfer: [flat.buffer] });
        });
    }
    let n = 0;
    return { step: () => { jobs[n++]?.(); return n >= jobs.length; }, result: () => n };
}

export function runWorkerSteps(rec: Recorder, p: PerfGraph, s: Shared): void {
    const drawn = rec.need(s.drawn, 'the drawn graph');
    const { graph } = p;
    const slices = (n: number, size: number = UPLOAD_SLICE): number => Math.max(1, Math.ceil(n / size));
    rec.task('worker main-thread: graph upload (one postMessage clone per slice)', 'all (first task on a graph)', `nodes=${graph.nodes.length} edges=${graph.edges.length} findings=${graph.findings.length} outline files=${graph.outline?.files.length ?? 0}`, () => uploadTask(graph),
        stepLabels([['nodes slice', slices(graph.nodes.length)], ['edges slice', slices(graph.edges.length)], ['findings slice', slices(graph.findings.length)], ['outline files slice', slices(graph.outline?.files.length ?? 0)], ['outline links slice', slices(graph.outline?.links.length ?? 0, LINK_SLICE)]]));

    const size = `nodes=${drawn.nodes.length} edges=${drawn.edges.length}`;
    const input = sceneInputs(graph.scope.rootId, drawn);
    const layout2 = roundTrip(rec, p, 'layout2d', 'Graph 2D', size, input.layout2d);
    const layout3 = roundTrip(rec, p, 'layout3d', '3D scene, Towers', size, input.layout3d);
    const ranked = roundTrip(rec, p, 'rankEdges', 'Graph 2D, 3D scene (lines)', size, input.rankEdges);
    if (!ranked) return;
    const picked = pickEdges(ranked, null);
    const pickedSize = `nodes=${drawn.nodes.length} picked edges=${picked.length}`;
    if (layout2) roundTrip(rec, p, 'edgePaths', 'Graph 2D', pickedSize, input.edgePaths(picked, layout2));
    if (layout3) roundTrip(rec, p, 'edgeBuffers', '3D scene (lines)', pickedSize, input.edgeBuffers(picked, layout3));
}

/**
 * "The worker answers what the main thread would have": every task kind is run twice on the same request, once through a
 * `ComputeClient` whose worker is the {@link LoopbackWorker} (encode, clone, the real worker loop, clone back, decode) and once
 * through `runSync` on a client with no worker, and the two results are fingerprinted with `canonicalHash`. Equal hashes for all
 * twelve kinds mean the off-thread move changed WHERE the work runs and nothing about WHAT it returns.
 *
 * The requests are the ones the views make (`perf/taskInputs.ts`), chained the way the views chain them: the drawn graph feeds
 * the layouts and the ranking, the ranking feeds the picked edges, the layouts and picked edges feed the path and buffer tasks,
 * the surface feeds the path and the anti-patterns. The in-process results feed the next request, for both sides.
 */

import type { KEdge, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { ComputeClient } from '../../compute/client';
import type { KindInput, KindResult, SurfaceResult } from '../../compute/kinds';
import type { TaskKind } from '../../compute/protocol';
import { changedRefs } from '../../surface/stations';
import { lensGraph, type VisibleGraph } from '../../graphModel';
import { LENSES } from '../../lenses';
import type { Layout3D } from '../../scene/layout3d';
import { pickEdges } from '../../scene/edgeBudget';
import { MAX_DRAWN_NODES } from '../modelSteps';
import { graphInputs, pinnedRefs, sceneInputs } from '../taskInputs';
import { canonicalHash } from './canonicalHash';
import { LoopbackWorker } from './loopbackWorker';
import { WorkMeter } from './meter';

export interface ParityRow { kind: TaskKind; worker: string; inProcess: string }

/** The in-process results the later suites reuse (the GPU budget is computed from them). */
export interface ParityReport {
    rows: ParityRow[];
    drawn: VisibleGraph;
    surface: SurfaceResult;
    layout3: Layout3D;
    picked: readonly KEdge[];
}

export async function runParity(graph: KnowledgeGraph): Promise<ParityReport> {
    const warn = console.warn;
    console.warn = () => undefined; // a client with no worker says so once; that is the point here
    const loop = new LoopbackWorker({ main: new WorkMeter('parity-main'), worker: new WorkMeter('parity-worker') });
    const remote = new ComputeClient(() => loop);
    const local = new ComputeClient(() => null);
    const rows: ParityRow[] = [];
    try {
        const onWorker = async <K extends TaskKind>(kind: K, input: KindInput<K>): Promise<KindResult<K>> => {
            const answer = remote.once(kind, input);
            const [value] = await Promise.all([answer, loop.settle()]);
            return value;
        };
        const step = async <K extends TaskKind>(kind: K, input: KindInput<K>): Promise<KindResult<K>> => {
            const inProcess = local.runSync(kind, input);
            const worker = await onWorker(kind, input);
            rows.push({ kind, worker: canonicalHash(worker), inProcess: canonicalHash(inProcess) });
            return inProcess;
        };

        const whole = graphInputs(graph, MAX_DRAWN_NODES);
        const drawn = lensGraph(await step('focus', whole.focus), LENSES.structure);
        const scene = sceneInputs(graph.scope.rootId, drawn);
        const surface = await step('surface', whole.surface([...changedRefs(graph, null)]));
        const layout2 = await step('layout2d', scene.layout2d);
        const layout3 = await step('layout3d', scene.layout3d);
        const picked = pickEdges(await step('rankEdges', scene.rankEdges), null);
        await step('edgePaths', scene.edgePaths(picked, layout2));
        await step('edgeBuffers', scene.edgeBuffers(picked, layout3));
        await step('mindMap', whole.mindMap);
        await step('insights', whole.insights);
        await step('partitionMatrix', whole.partitionMatrix);
        await step('path', whole.path(pinnedRefs(surface.lines, surface.stations), surface.stations));
        const layer = surface.stations.stations.find((s) => s.layer)?.layer ?? null;
        await step('antiPatterns', whole.antiPatterns(layer, surface.stations));
        return { rows, drawn, surface, layout3, picked };
    } finally {
        remote.dispose();
        local.dispose();
        loop.terminate();
        console.warn = warn;
    }
}

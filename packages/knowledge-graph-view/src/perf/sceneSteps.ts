/**
 * The pure steps behind the Graph 2D and the 3D scene / Towers: the idle-step layouts (all steps driven, the slowest
 * single step reported), the edge ranking and pick, the instance / edge / tower / pipe buffers, and the 2D view's own
 * derivations. The WebGL canvas itself is out of reach in jsdom (see the report).
 */

import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { EMPTY_LAYOUT_2D, fitView, layout2dTask } from '../graph2d/layout2d';
import { byImportance } from '../graphModel';
import { LENSES } from '../lenses';
import { canonicalEdges, EDGE_SLICE } from '../scene/canonicalEdges';
import { edgeBuffers, groupEdges, nodeInstances } from '../scene/buffers';
import { nodeChannels, pipeWidthOf, pipes, towerBodies } from '../scene/channels';
import { DEFER_EDGES_ABOVE, incidentOf, pickEdges, rankEdges, rankTask, type RankedEdges } from '../scene/edgeBudget';
import { applyRoles } from '../scene/highlightRoles';
import { layoutTask, planeOrder, type Layout3D } from '../scene/layout3d';
import { layoutSprings } from '../scene/layoutSprings';
import { sortStepCount } from '../scene/chunkedSort';
import { highlightFor } from '../surface/towerHighlight';
import { stepLabels, type Recorder } from './harness';
import type { Shared } from './modelSteps';
import type { PerfGraph } from './syntheticGraph';

export function runSceneSteps(rec: Recorder, p: PerfGraph, s: Shared): void {
    const drawn = rec.need(s.drawn, 'the drawn graph');
    const stations = rec.need(s.stations, 'stations');
    const overlay = rec.need(s.overlay, 'overlay');
    const { nodes, edges } = drawn;
    const size = `nodes=${nodes.length} edges=${edges.length}`;
    const rootId = p.graph.scope.rootId;
    const defer = `(edges > DEFER_EDGES_ABOVE=${DEFER_EDGES_ABOVE}: deferred to idle in the app)`;

    rec.time('planeOrder', '3D scene, Graph 2D', size, () => planeOrder(nodes, edges));
    const sortedRefs = [...nodes].map((n) => n.ref as string).sort();
    const rank = new Map(sortedRefs.map((r, i) => [r, i] as const));
    const sorted = canonicalEdges(edges, rank);
    // Every timed iteration is COLD: the memos (canonicalEdges, rankStages, ...) are WeakMaps keyed by the edges array, so each
    // run gets a fresh array (built untimed). The "(warm)" rows keep the memo-hit cost, reported separately.
    const coldEdges = (): readonly KEdge[] => edges.slice();
    rec.time('canonicalEdges (standalone, cold)', '3D scene, Graph 2D, edge ranking', size, (e: readonly KEdge[]) => canonicalEdges(e, rank), coldEdges);
    rec.time('canonicalEdges (warm: memo hit)', '3D scene, Graph 2D, edge ranking', size, () => canonicalEdges(edges, rank));
    rec.time('layoutSprings (standalone)', '3D scene, Graph 2D', `sorted edges=${sorted.length}`, (s: readonly KEdge[]) => layoutSprings(s, rank), () => sorted.slice());

    // Step labels mirror the real step functions: canonicalEdges.build (kinds / SLICE-sized resolves / packed sort), then the
    // consumer's own stages. `ranked` (untimed) supplies the counts the rank stages slice over.
    const SLICE = EDGE_SLICE; // the real slice size, shared with canonicalEdges / rankStages / layoutSprings / planeOrder
    const slices = (n: number): number => Math.max(1, Math.ceil(n / SLICE));
    const canonGroups = (n: number, placed: number = n): Array<readonly [string, number]> => [['canonicalEdges: kinds', 1], ['canonicalEdges: resolve slice', slices(n)], ['canonicalEdges: packed key sort', sortStepCount(placed)], ['canonicalEdges: materialise slice', slices(placed)]];
    const layoutLabels = stepLabels([['plane order slice', slices(edges.length)], ...canonGroups(edges.length, sorted.length), ['layoutSprings slice', slices(sorted.length)], ['createRelaxation', 1]], 'relax pass', false);
    const coldPair = (): { nodes: readonly KNode[]; edges: readonly KEdge[] } => ({ nodes: nodes.slice(), edges: edges.slice() });

    const layout: Layout3D | undefined = rec.task('layoutTask (3D; start + every idle step, cold)', '3D scene, Towers', size, (c: { nodes: readonly KNode[]; edges: readonly KEdge[] }) => layoutTask(rootId, c.nodes, c.edges), layoutLabels, coldPair);
    rec.task('layout2dTask (start + every idle step + project, cold)', 'Graph 2D', size, (c: { nodes: readonly KNode[]; edges: readonly KEdge[] }) => layout2dTask(rootId, c.nodes, c.edges), layoutLabels, coldPair);
    const l2 = layout2dTask(rootId, nodes, edges);
    while (!l2.step());
    const layout2 = l2.result() ?? EMPTY_LAYOUT_2D;
    rec.time('fitView', 'Graph 2D', `positions=${layout2.positions.size}`, () => fitView(layout2, 1280, 720));
    rec.time('sort nodes by importance (ordered)', 'Graph 2D', `nodes=${nodes.length}`, () => [...nodes].sort(byImportance));
    rec.time('neighbours map (ref -> linked refs)', 'Graph 2D', `edges=${edges.length}`, () => {
        const out = new Map<string, string[]>();
        const add = (a: string, b: string): void => { const l = out.get(a); if (l) l.push(b); else out.set(a, [b]); };
        for (const e of edges) { add(e.from, e.to); add(e.to, e.from); }
        return out;
    });

    const counted = rankEdges(edges.slice(), nodes); // untimed: how many links the split stages slice over
    const quiet = counted.rest.length;
    const rankLabels = stepLabels([
        ['index maps', 1], ...canonGroups(edges.length, sorted.length),
        ['classify links (loud / weighted)', slices(counted.total)], ['distinct weights (sort)', sortStepCount(counted.rest.length)],
        ['packed weight keys', slices(quiet)], ['keys sort', sortStepCount(quiet)], ['materialise rest + breaking', slices(quiet)],
        ['incident index', slices(counted.total)],
    ]);
    const ranked: RankedEdges | undefined = rec.task('rankTask (edge ranking, cold)', 'Graph 2D, 3D scene (lines) ' + defer, size, (e: readonly KEdge[]) => rankTask(e, nodes), rankLabels, coldEdges);
    const r = rec.need(ranked, 'rankTask');
    const picked = rec.time('pickEdges (no selection)', 'Graph 2D, 3D scene', `ranked=${r.total}, cap=15000`, () => pickEdges(r, null)) ?? [];
    rec.time('pickEdges (hub selected)', 'Graph 2D, 3D scene (every selection)', `hub in-edges=${incidentOf(r, p.hub).length}`, () => pickEdges(r, p.hub));
    if (layout) {
        const at2 = (ref: string) => layout2.positions.get(ref);
        const paths = (es: readonly KEdge[]) => groupEdges(es, at2).map((g) => ({ bucket: g.bucket, d: g.pairs.map(([a, b]) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`).join('') }));
        rec.time('groupEdges + SVG path strings (picked edges)', 'Graph 2D ' + defer, `picked=${picked.length}`, () => paths(picked));
        rec.time('groupEdges + SVG path strings (ALL drawn edges)', 'Graph 2D (what the cap avoids)', size, () => paths(edges));
        rec.time('edgeBuffers (picked edges)', '3D scene (lines)', `picked=${picked.length}`, () => edgeBuffers(picked, layout));
        const lens = LENSES.structure;
        const inst = rec.time('nodeInstances', '3D scene, Towers', size, () => nodeInstances(nodes as KNode[], layout, lens));
        const channels = rec.time('nodeChannels', '3D Towers', `nodes=${nodes.length} stations=${stations.stations.length}`, () => nodeChannels(nodes, stations, overlay));
        if (inst && channels) {
            const bodies = rec.time('towerBodies', '3D Towers', `instances=${inst.refs.length}`, () => towerBodies(inst, channels)) ?? [];
            const violations = p.graph.findings.filter((f) => f.kind === 'partition-violation');
            const roles = highlightFor(violations).roles;
            rec.time('applyRoles (anti-pattern highlight)', '3D Towers', `bodies=${bodies.length} roles=${roles.size}`, () => applyRoles(bodies, roles));
            const radius = pipeWidthOf(stations, overlay);
            rec.time('pipes', '3D Towers (pipes replace lines)', `edges=${edges.length} bodies=${bodies.length}, cap=1500`, () => pipes(edges, bodies, radius ?? (() => null)));
        }
    }
}

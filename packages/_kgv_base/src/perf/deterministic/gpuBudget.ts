/**
 * What the 3D scene hands the GPU, as counts and bytes. The numbers come from the REAL scene functions called exactly as
 * `perf/sceneSteps.ts` calls them (instances, edge buffers, channels, tower bodies, pipes); nothing here re-derives scene
 * logic, so a change to the scene moves these numbers and a ratchet against a baseline catches it.
 */

import type { Finding, KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { LENSES, type LensDef } from '../../lenses';
import { edgeBuffers, nodeInstances } from '../../scene/buffers';
import { nodeChannels, pipeWidthOf, pipes, towerBodies } from '../../scene/channels';
import { applyRoles } from '../../scene/highlightRoles';
import type { Layout3D } from '../../scene/layout3d';
import type { OverlayModel } from '../../surface/overlays';
import type { StationModel } from '../../surface/stations';
import { highlightFor } from '../../surface/towerHighlight';

/**
 * Sum of byteLength over every typed array reachable from `value` (objects, arrays, Maps, Sets). Views sharing one
 * ArrayBuffer count once, via the first view met.
 */
export function typedBytes(value: unknown): number {
    const seenObjects = new WeakSet<object>();
    const seenBuffers = new WeakSet<object>();
    let total = 0;
    const walk = (v: unknown): void => {
        if (typeof v !== 'object' || v === null) return;
        if (ArrayBuffer.isView(v)) {
            if (!seenBuffers.has(v.buffer)) { seenBuffers.add(v.buffer); total += v.byteLength; }
            return;
        }
        if (v instanceof ArrayBuffer) {
            if (!seenBuffers.has(v)) { seenBuffers.add(v); total += v.byteLength; }
            return;
        }
        if (seenObjects.has(v)) return;
        seenObjects.add(v);
        if (Array.isArray(v)) for (const x of v) walk(x);
        else if (v instanceof Map) for (const x of v.values()) walk(x);
        else if (v instanceof Set) for (const x of v) walk(x);
        else for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k]);
    };
    walk(value);
    return total;
}

export interface SceneBudgetInput {
    nodes: readonly KNode[];
    edges: readonly KEdge[];
    /** The edges the scene draws as lines (the `pickEdges` result). */
    picked: readonly KEdge[];
    layout: Layout3D;
    stations: StationModel;
    overlay: OverlayModel;
    findings: readonly Finding[];
    lens?: LensDef;
}

export function sceneBudget(input: SceneBudgetInput): Record<string, number> {
    const { nodes, edges, picked, layout, stations, overlay, findings } = input;
    const inst = nodeInstances(nodes as KNode[], layout, input.lens ?? LENSES.structure);
    const buffers = edgeBuffers(picked, layout);
    const channels = nodeChannels(nodes, stations, overlay);
    const bodies = towerBodies(inst, channels);
    const roles = highlightFor(findings.filter((f) => f.kind === 'partition-violation')).roles;
    const painted = applyRoles(bodies, roles);
    const radius = pipeWidthOf(stations, overlay);
    const pipeList = pipes(edges, bodies, radius ?? (() => null));
    return {
        nodes: nodes.length,
        edges: edges.length,
        pickedEdges: picked.length,
        instances: inst.refs.length,
        instanceBytes: typedBytes(inst),
        edgeBuffers: buffers.length,
        edgeSegments: buffers.reduce((n, b) => n + b.count, 0),
        edgeBufferBytes: typedBytes(buffers),
        towerBodies: bodies.length,
        towerShells: bodies.filter((b) => b.shell).length,
        towerFilled: bodies.filter((b) => b.fill !== undefined).length,
        highlightRoles: roles.size,
        dimmedTowers: painted.filter((b) => b.dim).length,
        pipes: pipeList.length,
        planes: layout.planes.length,
        placed: layout.positions.size,
    };
}

/**
 * The shared fixtures of the surface's component suites: the surface graph folded to stations,
 * lines and the Risk overlay, an unused-export finding (the one kind with a deterministic fix),
 * and a probe that records what a camera registered as its zoom. Not a test file; it imports no
 * testing library.
 */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { lensesFor } from '../lenses';
import { surfaceFixture } from '../testing';
import { buildLines } from './lines';
import { makeOverlay, PRESETS } from './overlays';
import { buildStations } from './stations';
import type { ZoomApi } from './zoom';

export const graph = surfaceFixture();
export const model = buildStations(graph);
export const lines = buildLines(graph, model);
export const overlay = makeOverlay(PRESETS.risk, model.stations);
export const lenses = lensesFor(graph);

export const unusedFinding: Finding = {
    id: 'f-unused', kind: 'unused-export', pack: 'code', nodes: ['src:sys::api/routes.ts' as Finding['nodes'][number]], severity: 'warn', params: {},
};

/** A probe registry: what the active camera registered. */
export function probe() {
    const seen: { api: ZoomApi | null } = { api: null };
    const host = { register: (a: ZoomApi) => { seen.api = a; }, unregister: (a: ZoomApi) => { if (seen.api === a) seen.api = null; } };
    return { seen, host };
}

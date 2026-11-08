/**
 * The scope of the Act panel: which findings belong to the line or station the person is
 * looking at, and where each one comes from (deterministic analysis, a heuristic, or a
 * runtime measurement). Pure; the panel only draws it.
 */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import type { Provenance } from './layers';
import { stationOfRef, type StationModel } from './stations';

/** Findings that need a model's judgement or a guess from names are heuristic. */
const HEURISTIC_KINDS: ReadonlySet<string> = new Set([
    'near-duplicate', 'possible-same', 'contradiction', 'unlayered', 'unpartitioned', 'pattern', 'anti-pattern', 'god-module',
]);
const RUNTIME_KINDS: ReadonlySet<string> = new Set(['untested', 'coverage-gap', 'slow']);

export function findingProvenance(f: Pick<Finding, 'kind'>): Provenance {
    if (RUNTIME_KINDS.has(f.kind)) return 'runtime';
    return HEURISTIC_KINDS.has(f.kind) ? 'heuristic' : 'deterministic';
}

/** The findings that touch any of `stationIds`; every finding when `stationIds` is null. */
export function scopeFindings(findings: readonly Finding[], model: Pick<StationModel, 'stationOf'>, stationIds: ReadonlySet<string> | null): Finding[] {
    if (!stationIds) return [...findings];
    return findings.filter((f) => f.nodes.some((ref) => {
        const id = stationOfRef(model, ref);
        return id !== undefined && stationIds.has(id);
    }));
}

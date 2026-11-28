/**
 * Recorded runs as station sequences: the pure half of `useRunTraces`. A trace step names a root-relative file path; the
 * station model keys files by their `src:<root>::<path>` ref (memory's `srcRef`), so a step's station is `stationOfRef` of that
 * ref (`stationOfStep`, the ONE rule the sequences and the recorded values both use). Consecutive steps in the same station are
 * ONE visit (a call inside a station is not a hop), and a step in no station is dropped.
 */

import { srcRef } from '@seanhogg/builderforce-memory/knowledge';
import type { RunTraces, RunTraceStep } from '../../types';
import { stationOfRef, type StationModel } from '../stations';
import type { StationSequences } from '../transitionTable';

/** The station a recorded step ran in; undefined when its file is in no station. */
export const stationOfStep = (model: Pick<StationModel, 'stationOf'>, rootId: string, step: Pick<RunTraceStep, 'path'>): string | undefined =>
    stationOfRef(model, srcRef(rootId, step.path));

/** The station sequence of every recorded run, oldest first; a run that touches fewer than two stations has no hop and is left out. */
export function stationSequencesOf(traces: RunTraces | null, rootId: string, model: Pick<StationModel, 'stationOf'>): StationSequences {
    if (!traces) return [];
    const out: string[][] = [];
    for (const run of traces.runs) {
        const seq: string[] = [];
        for (const step of run.steps) {
            const id = stationOfStep(model, rootId, step);
            if (id !== undefined && seq[seq.length - 1] !== id) seq.push(id);
        }
        if (seq.length > 1) out.push(seq);
    }
    return out;
}

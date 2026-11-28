/**
 * The values the NEWEST recorded run saw at a path's stops, built from the root's `RunTraces` with the same station rule the
 * transition table uses (`stationOfStep`). The FIRST call a run made in a stop is the one shown: its arguments are inputs, its
 * return the output. A stop the run never entered records nothing: absent data is absent.
 */

import type { RecordedRun, RecordedValue } from '../../fixPorts';
import type { RunTraces } from '../../types';
import type { StationModel } from '../stations';
import { stationOfStep } from './runTraceStations';

export function recordedRunOfTraces(traces: RunTraces | null, rootId: string, model: Pick<StationModel, 'stationOf'>, stopIds: readonly string[]): RecordedRun | null {
    const newest = traces?.runs[traces.runs.length - 1];
    if (!newest) return null;
    const stops = new Set(stopIds);
    const first = new Map<string, RunTraces['runs'][number]['steps'][number]>();
    for (const step of newest.steps) {
        const id = stationOfStep(model, rootId, step);
        if (id !== undefined && stops.has(id) && !first.has(id)) first.set(id, step);
    }
    const values: RecordedValue[] = [];
    for (const stopId of stopIds) {
        const step = first.get(stopId);
        if (!step) continue;
        for (const [name, value] of Object.entries(step.args ?? {})) values.push({ stopId, name, value, direction: 'in' });
        if (step.ret !== undefined) values.push({ stopId, name: 'return', value: step.ret, direction: 'out' });
    }
    return values.length > 0 ? { values } : null;
}

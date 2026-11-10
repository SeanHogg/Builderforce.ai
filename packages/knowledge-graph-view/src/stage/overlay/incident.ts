/**
 * The ranked incident index on the main thread (PRD 43 B5): the worker's `stageIncident` reply, read in place. Selecting a
 * slot slices its neighbours (`subarray`, no copy, no worker trip); the overlay draws the first {@link INCIDENT_SHOWN}.
 */

import type { SlotIncidentRaw } from '../../compute/tasks/stageIncident';

/** How many of a selection's neighbours the overlay draws (best first). */
export const INCIDENT_SHOWN = 24;

const EMPTY = new Uint32Array(0);

export class SlotIncident {
    constructor(private readonly raw: SlotIncidentRaw) {}

    get generation(): number { return this.raw.generation; }

    /** Slot `s`'s neighbours, best first, at most `limit`. */
    of(s: number, limit = Number.POSITIVE_INFINITY): Uint32Array {
        const { offsets, neighbours } = this.raw;
        if (s < 0 || s + 1 >= offsets.length) return EMPTY;
        const start = offsets[s]!, end = Math.min(offsets[s + 1]!, start + limit);
        return neighbours.subarray(start, end);
    }
}

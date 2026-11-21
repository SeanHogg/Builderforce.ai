/**
 * The plain-language walkthrough of a journey. A door is where you enter or leave (an entry
 * point or an endpoint), a hallway is a call between rooms, and a room is a module or a class.
 * One sentence per step, filled only from the path and the label catalog — never a model call.
 */

import { fillTemplate } from '../labels';
import type { WalkLabels } from '../labels/surface.act';
import type { PathModel } from './path';

/** The step, clamped onto the path. A missing or empty path is -1. */
function stepIndex(path: PathModel | null | undefined, step: number): number {
    if (!path || path.stops.length === 0) return -1;
    const n = Number.isFinite(step) ? Math.floor(step) : 0;
    return Math.min(Math.max(n, 0), path.stops.length - 1);
}

/**
 * The sentence for one step of a journey.
 * Step 0 is the entry door. The last step of a longer journey is the endpoint door.
 * Every step between is a room, and every step after the first says which hallway you walked to get there.
 * A single stop is a room with no hallway. No path says to choose a journey.
 */
export function walkthroughSentence(path: PathModel | null | undefined, step: number, labels: WalkLabels): string {
    const i = stepIndex(path, step);
    if (i < 0 || !path) return labels.empty;
    const stop = path.stops[i]!;
    const last = path.stops.length - 1;
    if (last === 0) return fillTemplate(labels.only, { name: stop.name });
    const place = i === 0
        ? fillTemplate(labels.doorIn, { name: stop.name })
        : i === last
            ? fillTemplate(labels.doorOut, { name: stop.name })
            : fillTemplate(labels.room, { name: stop.name });
    if (i === 0) return place;
    const from = path.stops[i - 1]!;
    const count = path.hops[i - 1]?.count ?? 0;
    const hallway = count <= 0
        ? fillTemplate(labels.hallwayNone, { from: from.name, to: stop.name })
        : fillTemplate(count === 1 ? labels.hallwayOne : labels.hallway, { from: from.name, to: stop.name, count });
    return fillTemplate(labels.arrived, { hallway, place });
}

/** Every step's sentence, in order, as one walk a reader can follow from the entry door to the end. */
export function walkthroughStory(path: PathModel | null | undefined, labels: WalkLabels): string {
    if (!path || path.stops.length === 0) return labels.empty;
    return path.stops.map((_, i) => walkthroughSentence(path, i, labels)).join(' ');
}

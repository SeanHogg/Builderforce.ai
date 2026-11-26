/**
 * Keeps a drill standing when the map is rebuilt under the person. A package station's id is partly
 * community-derived, and communities are recomputed per build, so the SAME files can come back under
 * another id. A package frame therefore remembers the files it was entered with and, when its id is
 * gone, moves to the station that now holds most of them; it is dropped (and named) only when none
 * of its files survive. Class and function frames key on file / symbol refs, which are stable, so
 * they are checked as before, after the package frame above them is re-anchored. Pure.
 */

import { cmp } from '../../order';
import type { StationModel } from '../stations';
import type { DrillFrame } from './drillView';

/** How many member files a package frame remembers: enough to find its station again, cheap to carry. */
export const ANCHOR_FILES = 32;

export interface ReanchoredDrill {
    /** The same array reference when nothing changed. */
    stack: readonly DrillFrame[];
    /** The name of the level the map no longer has; null when the drill is intact (or re-anchored). */
    notice: string | null;
    /** Package ids that moved, old → new (for state keyed by the id). */
    moved: ReadonlyMap<string, string>;
}

/** The files a package frame is entered with (the first {@link ANCHOR_FILES} of its station). */
export function anchorFilesOf(world: StationModel, stationId: string): string[] {
    return (world.byId.get(stationId)?.refs ?? []).slice(0, ANCHOR_FILES);
}

/** The station of `world` that holds most of `files`; null when none of them is on the map. */
function stationHolding(world: StationModel, files: readonly string[]): string | null {
    const counts = new Map<string, number>();
    for (const f of files) {
        const id = world.stationOf.get(f);
        if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    let best: string | null = null;
    for (const [id, n] of counts) {
        if (best === null || n > counts.get(best)! || (n === counts.get(best)! && cmp(id, best) < 0)) best = id;
    }
    return best;
}

export function reanchorDrill(stack: readonly DrillFrame[], world: StationModel, hasNode: (ref: string) => boolean): ReanchoredDrill {
    const next: DrillFrame[] = [];
    const moved = new Map<string, string>();
    let changed = false;
    for (const frame of stack) {
        let kept = frame;
        if (frame.level === 'package') {
            if (!world.byId.has(frame.ref)) {
                const to = stationHolding(world, frame.files ?? []);
                if (to === null) return { stack: stack.slice(0, next.length), notice: frame.name, moved };
                kept = { ...frame, ref: to, name: world.byId.get(to)?.name ?? frame.name, files: anchorFilesOf(world, to) };
                moved.set(frame.ref, to);
                changed = true;
            }
        } else if (frame.level === 'class' ? !world.stationOf.has(frame.ref) : !hasNode(frame.ref)) {
            return { stack: stack.slice(0, next.length), notice: frame.name, moved };
        }
        next.push(kept);
    }
    return { stack: changed ? next : stack, notice: null, moved };
}

/**
 * The stage's rig, found from its bus (PRD 43 B1a rule 9). The semantic zoom lives with the camera's wiring, outside
 * the stage component that owns the rig; the stage binds its rig here for as long as both live, so "Go inside" can fly
 * the SAME camera the wheel moves and the zoom watcher can read the zoom point. One rig per bus (one stage per renderer).
 */

import type { StageBus } from '../anchor/stageBus';
import type { RigController } from './rig';

const RIGS = new WeakMap<StageBus, RigController>();

/** Binds `rig` to `bus`; returns the unbind (only this rig's binding is released). */
export function bindRig(bus: StageBus, rig: RigController): () => void {
    RIGS.set(bus, rig);
    return () => { if (RIGS.get(bus) === rig) RIGS.delete(bus); };
}

/** The rig of `bus`'s stage; null before the stage mounts (or with no stage). */
export const rigOf = (bus: StageBus): RigController | null => RIGS.get(bus) ?? null;

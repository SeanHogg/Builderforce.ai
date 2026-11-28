/**
 * The structural levels above a package (system, app) as drill FRAMES. ONE hierarchy, the outline's (`systemsOf`,
 * `modulesOfFiles`): a system or an app is a folder, drawn on the stage as the folder slot `dir:<path>`; its frame is
 * `system:<path>` / `app:<path>` (the ref is the stable folder path, so a rebuilt map never re-anchors it).
 *
 * What a level holds is the placement's own `LevelDescriptor` (computed once, by `levelChildren`, in the compute realm):
 * this file only turns a mark key the person zoomed into (a folder slot, or a station) into the frame to push. The skip rule
 * (a level with exactly one child is not shown, the child is entered instead) reads that same descriptor, in the zoom. Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { dirKey } from '../../compute/tasks/markSet';
import { tailOf } from '../outlineGraph';
import type { StationModel } from '../stations';
import { modulesOfFiles, systemName, systemsOf } from '../systems';
import type { DrillFrame, DrillLevel } from './drillView';
import { anchorFilesOf } from './reanchorDrill';

/** How deep a level is: a frame may only be entered from a shallower one. */
export const LEVEL_RANK: Readonly<Record<DrillLevel | 'world', number>> = { world: 0, system: 1, app: 2, package: 3, class: 4, function: 5 };

/** The levels whose marks are folders and stations, drawn by the level scene (no `DrillView` of their own). */
export const isStructuralLevel = (level: DrillLevel | 'world'): level is 'world' | 'system' | 'app' => LEVEL_RANK[level] < LEVEL_RANK.package;

/** How many frames of `stack` are structural (they are always the first ones). */
export const structuralDepth = (stack: readonly Pick<DrillFrame, 'level'>[]): number => stack.filter((f) => isStructuralLevel(f.level)).length;

const FOLDER = dirKey('');

/** The folder path a slot key names (`dir:<path>`); null for any other key. */
export const folderOfKey = (key: string): string | null => (key.startsWith(FOLDER) ? key.slice(FOLDER.length) : null);

const appPaths = new WeakMap<KnowledgeGraph, ReadonlySet<string>>();
function appsOf(graph: KnowledgeGraph): ReadonlySet<string> {
    const hit = appPaths.get(graph);
    if (hit) return hit;
    const out = new Set(modulesOfFiles(graph).values());
    appPaths.set(graph, out);
    return out;
}

/** The frame of the system or app at folder `path`; null when the folder is neither. A system wins over an app of the same path. */
export function folderFrameOf(graph: KnowledgeGraph, path: string): DrillFrame | null {
    const systems = systemsOf(graph);
    if (systems.some((s) => s.path === path)) return { level: 'system', ref: path, name: systemName(systems, path) ?? tailOf(path) };
    return appsOf(graph).has(path) ? { level: 'app', ref: path, name: tailOf(path) } : null;
}

/** A station's own frame (a package). */
export const packageFrameOf = (world: StationModel, id: string): DrillFrame | null => {
    const station = world.byId.get(id);
    return station ? { level: 'package', ref: id, name: station.name, files: anchorFilesOf(world, id) } : null;
};

/** The frame of a child mark of a structural level (its slot key: `dir:<path>` or `st:<id>`), else null. */
export function frameOfChildKey(graph: KnowledgeGraph, world: StationModel, key: string): DrillFrame | null {
    const folder = folderOfKey(key);
    if (folder !== null) return folderFrameOf(graph, folder);
    return key.startsWith('st:') ? packageFrameOf(world, key.slice('st:'.length)) : null;
}

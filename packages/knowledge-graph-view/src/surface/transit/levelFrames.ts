/**
 * The structural levels above a package (system, app) as drill FRAMES. ONE hierarchy, the outline's (`systemsOf`,
 * `modulesOfFiles`): a system or an app is a folder, drawn on the stage as the folder slot `dir:<path>`; its frame is
 * `system:<path>` / `app:<path>` (the ref is the stable folder path, so a rebuilt map never re-anchors it).
 *
 * What a level holds is `levelChildren` (the placement's own pure function): this file only turns a mark the person
 * zoomed into (a folder slot or a station) into the frame(s) to push, applying the one skip rule: a level with exactly one
 * child is not shown, the child is entered instead (the mockup's root opens straight onto areas). Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { dirKey } from '../../compute/tasks/markSet';
import { levelChildren } from '../../compute/tasks/placement/levelChildren';
import { tailOf } from '../outlineGraph';
import type { StationModel } from '../stations';
import { modulesOfFiles, systemName, systemsOf } from '../systems';
import type { DrillFrame, DrillLevel } from './drillView';

/** How deep a level is: a frame may only be entered from a shallower one. */
export const LEVEL_RANK: Readonly<Record<DrillLevel | 'world', number>> = { world: 0, system: 1, app: 2, package: 3, class: 4, function: 5 };

/** The levels whose marks are folders and stations, drawn by the level scene (no `DrillView` of their own). */
export const isStructuralLevel = (level: DrillLevel | 'world'): level is 'world' | 'system' | 'app' => LEVEL_RANK[level] < LEVEL_RANK.package;

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
    return station ? { level: 'package', ref: id, name: station.name, files: station.refs.slice(0, 32) } : null;
};

/** The frame of a child mark of a structural level (its slot key), else null. */
function frameOfKey(graph: KnowledgeGraph, world: StationModel, key: string): DrillFrame | null {
    const folder = folderOfKey(key);
    if (folder !== null) return folderFrameOf(graph, folder);
    return key.startsWith('st:') ? packageFrameOf(world, key.slice('st:'.length)) : null;
}

/**
 * The frame to push to enter `target` (a system, app or package frame): the frame itself, or, when it holds exactly one
 * child, that child (skipped through as far as that rule goes).
 */
export function frameToEnter(graph: KnowledgeGraph, world: StationModel, target: DrillFrame): DrillFrame {
    let at = target;
    for (let guard = 0; guard < 3 && isStructuralLevel(at.level); guard++) {
        const kids = levelChildren(graph, world, at);
        const only = kids.length === 1 ? frameOfKey(graph, world, kids[0]!.key) : null;
        if (!only || LEVEL_RANK[only.level] <= LEVEL_RANK[at.level]) break;
        at = only;
    }
    return at;
}

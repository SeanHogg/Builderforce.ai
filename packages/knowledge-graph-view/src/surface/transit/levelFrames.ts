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
import type { LevelDescriptor } from '../../stage/types';
import { modulesOfFiles, systemName, systemsOf } from '../systems';
import type { DrillFrame, DrillLevel } from './drillView';

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

/**
 * What the drill is asked to enter for the child of the level on show whose mark key is `key`: `dir:<folder>` when the child is
 * a system or an app (by its descriptor's `folder`, whatever slot it was drawn on), else null (a station is entered by its id).
 */
export function folderIdOfMark(level: Pick<LevelDescriptor, 'children'> | undefined, key: string): string | null {
    const folder = level?.children.find((c) => c.key === key)?.folder;
    return folder === undefined ? null : `${FOLDER}${folder}`;
}

/** The mark key a folder id (`dir:<path>`) is drawn on in the level on show; the id itself when it is not a child there. */
export const markOfFolderId = (level: Pick<LevelDescriptor, 'children'> | undefined, id: string): string => {
    const folder = folderOfKey(id);
    return folder === null ? id : level?.children.find((c) => c.folder === folder)?.key ?? id;
};

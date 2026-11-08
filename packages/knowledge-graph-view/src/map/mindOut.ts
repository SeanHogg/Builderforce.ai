/**
 * The mind map's way back up: the folder above the focused one, and the refs that focus it (none = clear the focus, back to the whole map).
 * The result carries the parent FOLDER PATH itself: the refs alone cannot name it (a parent whose only child is the focused folder has the
 * same files, so deriving the folder from them lands on the folder we left). PURE.
 */

import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { dirParts } from './folderTree';

export interface OutTarget {
    /** The name of the level above: its folder, or the root's title. */
    name: string;
    /** The folder to expand: the parent's path, or null for the top level (nothing focused). */
    folder: string | null;
    refs: string[];
}

/** Null at the root (`folder === ''`): there is no level above it. */
export function outTarget(nodes: readonly KNode[], folder: string, rootTitle: string): OutTarget | null {
    if (folder === '') return null;
    const parts = folder.split('/');
    parts.pop();
    if (parts.length === 0) return { name: rootTitle, folder: null, refs: [] };
    const parent = parts.join('/');
    const refs = nodes.filter((n) => {
        if (n.kind !== 'file') return false;
        const dir = dirParts(n.ref)?.join('/');
        return dir !== undefined && (dir === parent || dir.startsWith(`${parent}/`));
    }).map((n) => n.ref);
    return { name: parts[parts.length - 1]!, folder: parent, refs };
}

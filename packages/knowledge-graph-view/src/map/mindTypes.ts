/** The mind map's shapes: a tree of branches, and the same branches placed on rings. */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import type { Bounds } from '../graph2d/layout2d';
import type { ThemeTone } from '../scene/themeColors';

export type Severity = Finding['severity'];
export type MapKind = 'root' | 'folder' | 'file' | 'more';

export interface MapBranch {
    id: string;
    kind: MapKind;
    /** A folder or file name; empty for `more` (the view words it from `count`) and for the root (the view names it). */
    name: string;
    /** Files beneath (a file: 1, a "+N more" leaf: N). */
    count: number;
    /** Every file ref beneath: what a click focuses. */
    refs: string[];
    /** The file's own ref; `file` only. */
    ref?: string;
    /** `more` only: how many FOLDERS it stands for, when it folds folders rather than files ("+N folders"). */
    folders?: number;
    /**
     * A paging leaf only: clicking it pages `parent` (a folder path, `''` for the root) from `next` on, so everything is reachable.
     * "+N folders" pages the parent's folders; "+N more" (`of: 'files'`) pages the focused folder's files.
     */
    page?: { parent: string; next: number; of?: 'files' };
    severity?: Severity;
    tone: ThemeTone;
    children: MapBranch[];
}

export interface PlacedBranch extends MapBranch {
    depth: number;
    x: number;
    y: number;
    /** Radians; the label sits on this side. */
    angle: number;
    /** The angular share this branch owns on its ring, in radians. */
    span: number;
    /** Its ring's radius. */
    radius: number;
    /** How far its label can run radially before it meets the next ring: the gap to that ring, or Infinity for a leaf. */
    room: number;
    parent?: string;
}

export interface MindMap {
    branches: PlacedBranch[];
    bounds: Bounds;
}

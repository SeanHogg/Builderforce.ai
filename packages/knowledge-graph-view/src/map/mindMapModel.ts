/**
 * The mind map's model — PURE and DETERMINISTIC. A radial tree built from the file nodes' paths, disclosed
 * progressively so a big folder stays readable:
 *
 *   - the root and every top-level folder are always placed;
 *   - subfolders are placed only for the FOCUSED folder (and the folders on the way to it); with nothing
 *     focused, only for the {@link OPEN_TOP_FOLDERS} largest top-level folders;
 *   - files are placed only for the focused folder: its top {@link FILES_PER_FOLDER} by importance, plus a
 *     "+N more" leaf;
 *   - everything else is folded into its parent, which carries the file count.
 *
 * Clicking a folder focuses it (the view's `onShow`), which is how a folder is expanded. At most
 * {@link MAX_BRANCHES} branches are placed: the folders with the most files stay and the rest fold into a
 * "+N folders" leaf on their parent. Equal input gives equal coordinates.
 */

import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../graphModel';
import { kindShape } from '../names';
import { cmp } from '../order';
import { buildDirs, refsOf, walkDirs, worst, worstSeverity, type Dir } from './folderTree';
import { layoutMindMap } from './mindLayout';
import type { MapBranch, MindMap, Severity } from './mindTypes';

export { focusFolder, MAX_FOLDER_DEPTH, worstSeverity } from './folderTree';
export { layoutMindMap, RING } from './mindLayout';
export type { MapBranch, MapKind, MindMap, PlacedBranch, Severity } from './mindTypes';

/** What a host draws when the map could not be computed: nothing placed (and, while a new map computes, the old one stays). */
export const EMPTY_MIND_MAP: MindMap = { branches: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };

export const FILES_PER_FOLDER = 8;
/** The largest top-level folders that show their subfolders while nothing is focused. */
export const OPEN_TOP_FOLDERS = 6;
/** The most branches (root included) the map places. */
export const MAX_BRANCHES = 400;

/** The folders of a paged parent that always stay placed, so every page makes progress. */
export const PAGE_MIN_FOLDERS = 40;

export interface MindOptions {
    /** The focused folder's path (`''` for the root), or null/absent for none. */
    focus?: string | null | undefined;
    /** Pages one parent's folders (a "+N folders" leaf was clicked): from the `start`-th largest folder of `parent` on. */
    window?: { parent: string; start: number } | null | undefined;
    /** Pages the focused folder's files (a "+N more" leaf was clicked): from the `start`-th most important file of `folder` on. */
    files?: { folder: string; start: number } | null | undefined;
}

type Tone = MapBranch['tone'];
/** Severity → tone, as data. Folders and files with nothing found keep their quiet tone. */
const SEVERITY_TONE: Record<Severity, Tone> = { error: 'violation', warn: 'cycle', info: 'nodeSection' };
const toneOf = (severity: Severity | undefined, quiet: Tone): Tone => (severity ? SEVERITY_TONE[severity] : quiet);

type Window = NonNullable<MindOptions['window']>;
interface Ctx {
    focus: string | null;
    open: ReadonlySet<string>;
    severities: ReadonlyMap<string, Severity>;
    window: Window | null;
    files: MindOptions['files'];
}

/** A parent's folders as the map lists them: all of them, or from the paged start on. */
const foldersOf = (dir: Dir, win: Window | null): Dir[] => (win && win.parent === dir.path ? dir.folders.slice(win.start) : dir.folders);

/** A page of a folder's files (`start` on, most important first) and, when files remain, the "+N more" leaf that pages to the next. */
function fileBranches(dir: Dir, severities: ReadonlyMap<string, Severity>, start: number): MapBranch[] {
    const shown: MapBranch[] = dir.files.slice(start, start + FILES_PER_FOLDER).map((n) => {
        const severity = severities.get(n.ref);
        return {
            id: n.ref, kind: 'file', name: pathOf(n.ref)?.split('/').pop() ?? n.label, count: 1, refs: [n.ref], ref: n.ref,
            ...(severity ? { severity } : {}), tone: toneOf(severity, 'nodeFile'), shape: kindShape(n), children: [],
        };
    });
    const rest = dir.files.slice(start + FILES_PER_FOLDER);
    if (rest.length) {
        const severity = rest.map((n) => severities.get(n.ref)).reduce<Severity | undefined>(worst, undefined);
        shown.push({
            id: `${dir.path}\u0000more`, kind: 'more', name: '', count: rest.length, refs: rest.map((n) => n.ref),
            page: { parent: dir.path, next: start + FILES_PER_FOLDER, of: 'files' },
            ...(severity ? { severity } : {}), tone: toneOf(severity, 'edge'), shape: 'circle', children: [],
        });
    }
    return shown;
}

function toBranch(dir: Dir, kind: 'root' | 'folder', ctx: Ctx): MapBranch {
    const expanded = kind === 'root' || ctx.open.has(dir.path);
    const children = [
        ...(expanded ? foldersOf(dir, ctx.window).map((f) => toBranch(f, 'folder', ctx)) : []),
        ...(ctx.focus === dir.path ? fileBranches(dir, ctx.severities, ctx.files?.folder === dir.path ? ctx.files.start : 0) : []),
    ];
    return {
        id: dir.path || '\u0000root', kind, name: dir.name, count: dir.count, refs: refsOf(dir),
        ...(dir.severity ? { severity: dir.severity } : {}), tone: toneOf(dir.severity, 'edge'), shape: 'circle', children,
    };
}

/** The focused folder and every folder on the way down to it (empty for no focus, or the root). */
function focusChain(focus: string | null): Set<string> {
    const parts = (focus ?? '').split('/').filter(Boolean);
    return new Set(parts.map((_, i) => parts.slice(0, i + 1).join('/')));
}

/**
 * Which folders show their subfolders: the focused one and the way down to it; with no focus (or the root, which is not a
 * folder to drill into) the largest top-level ones.
 */
function openFolders(root: Dir, chain: ReadonlySet<string>): Set<string> {
    return chain.size ? new Set(chain) : new Set(root.folders.slice(0, OPEN_TOP_FOLDERS).map((f) => f.path));
}

const total = (b: MapBranch): number => 1 + b.children.reduce((n, c) => n + total(c), 0);

/** The tree with every folder outside `keep` folded into a "+N folders" leaf on its parent. */
function fold(b: MapBranch, keep: ReadonlySet<string>, win: Window | null): MapBranch {
    const kept: MapBranch[] = [];
    const dropped: MapBranch[] = [];
    for (const c of b.children) (c.kind === 'folder' && !keep.has(c.id) ? dropped : kept).push(c);
    const children = kept.map((c) => fold(c, keep, win));
    if (dropped.length) {
        const severity = dropped.map((c) => c.severity).reduce<Severity | undefined>(worst, undefined);
        const parent = b.kind === 'root' ? '' : b.id;
        // The leaf pages its parent: the next page starts after the folders this parent shows now.
        const start = win && win.parent === parent ? win.start : 0;
        children.push({
            id: `${b.id}\u0000folders`, kind: 'more', name: '', count: dropped.reduce((n, c) => n + c.count, 0), refs: dropped.flatMap((c) => c.refs),
            folders: dropped.length, page: { parent, next: start + kept.filter((c) => c.kind === 'folder').length },
            ...(severity ? { severity } : {}), tone: toneOf(severity, 'edge'), shape: 'circle', children: [],
        });
    }
    return { ...b, children };
}

/** At most `max` branches: the folders with the most files first (a parent never has fewer files than its child, and shallower wins a tie). */
function capBranches(tree: MapBranch, max: number, must: ReadonlySet<string>, win: Window | null): MapBranch {
    if (total(tree) <= max) return tree;
    const folders: Array<{ b: MapBranch; depth: number }> = [];
    const walk = (b: MapBranch, depth: number): void => { for (const c of b.children) { if (c.kind === 'folder') folders.push({ b: c, depth }); walk(c, depth + 1); } };
    walk(tree, 1);
    // The focused folder and the way down to it always stay: that is the expansion the user asked for.
    folders.sort((a, b) => Number(must.has(b.b.id)) - Number(must.has(a.b.id)) || b.b.count - a.b.count || a.depth - b.depth || cmp(a.b.id, b.b.id));
    // Folding adds "+N folders" leaves, so find the most folders that can stay while the whole tree fits (the size only grows with the kept set).
    const foldTo = (n: number): MapBranch => fold(tree, new Set(folders.slice(0, n).map((f) => f.b.id)), win);
    let best = foldTo(0);
    let lo = 1, hi = Math.min(folders.length, max - 1);
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const out = foldTo(mid);
        if (total(out) <= max) { best = out; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
}

export function buildMindTree(nodes: readonly KNode[], findings: readonly Finding[], opts: MindOptions = {}): MapBranch {
    const severities = worstSeverity(findings);
    const root = buildDirs(nodes, severities);
    const focus = opts.focus ?? null;
    const chain = focusChain(focus);
    const paging = opts.window ?? null;
    // Stays placed whatever the count: the focus chain, and the first folders of a paged parent (so each page makes progress).
    const must = new Set(chain);
    if (paging) {
        const parent = paging.parent === '' ? root : [...walkDirs(root)].find((d) => d.path === paging.parent);
        // The paged parent itself (and the way down to it) stays placed, or its page would vanish with it.
        for (const path of focusChain(paging.parent)) must.add(path);
        for (const d of parent ? foldersOf(parent, paging).slice(0, PAGE_MIN_FOLDERS) : []) must.add(d.path);
    }
    const files = opts.files ?? null;
    return capBranches(toBranch(root, 'root', { focus, open: openFolders(root, chain), severities, window: paging, files }), MAX_BRANCHES, must, paging);
}

export const mindMap = (nodes: readonly KNode[], findings: readonly Finding[], opts: MindOptions = {}): MindMap =>
    layoutMindMap(buildMindTree(nodes, findings, opts));

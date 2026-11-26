import { describe, expect, it } from 'vitest';
import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import {
    buildMindTree, FILES_PER_FOLDER, focusFolder, MAX_BRANCHES, MAX_FOLDER_DEPTH, mindMap, OPEN_TOP_FOLDERS, worstSeverity, type MapBranch,
} from './mindMapModel';
import { outTarget } from './mindOut';

const file = (path: string, importance: number): KNode => ({
    ref: `src:r::${path}` as KNode['ref'], kind: 'file', label: path, pack: 'code', importance, origin: 'extracted',
});
const finding = (severity: Finding['severity'], path: string): Finding => ({
    id: `f:${path}`, kind: 'cycle', pack: 'code', nodes: [`src:r::${path}` as Finding['nodes'][number]], severity, params: {},
});

const pad = (n: number) => String(n).padStart(2, '0');
const many = Array.from({ length: 12 }, (_, i) => file(`a/f${pad(i)}.ts`, 1 - i / 20));
const nodes = [...many, file('b/c/d/e/deep.ts', 0.5), file('top.ts', 0.9)];
const findings = [finding('warn', 'a/f00.ts'), finding('error', 'b/c/d/e/deep.ts'), finding('info', 'a/f01.ts')];

describe('mind map tree', () => {
    const tree = buildMindTree(nodes, findings, { focus: 'a' });
    type Branch = typeof tree;
    const child = (parent: Branch, name: string): Branch => parent.children.find((c) => c.name === name && c.kind !== 'file')!;

    it('is root, then folders (largest first); files and a "+N more" leaf only for the focused folder', () => {
        expect(tree.kind).toBe('root');
        expect(tree.count).toBe(14);
        expect(tree.children.map((c) => `${c.kind}:${c.name}`)).toEqual(['folder:a', 'folder:b']);
        const a = child(tree, 'a');
        expect(a.children.filter((c) => c.kind === 'file')).toHaveLength(FILES_PER_FOLDER);
        const more = a.children.at(-1)!;
        expect(more.kind).toBe('more');
        expect(more.count).toBe(12 - FILES_PER_FOLDER);
        expect(more.refs).toHaveLength(12 - FILES_PER_FOLDER);
        // The shown files are the most important ones, in order.
        expect(a.children[0]!.name).toBe('f00.ts');
        expect(a.refs).toHaveLength(12);
        // Nothing else is expanded: b stays one folded branch carrying its count.
        expect(child(tree, 'b').children).toEqual([]);
        expect(child(tree, 'b').count).toBe(1);
    });

    it('with nothing focused places no files at all', () => {
        const none = buildMindTree(nodes, findings);
        expect(none.children.map((c) => `${c.kind}:${c.name}`)).toEqual(['folder:a', 'folder:b']);
        const kinds = (b: MapBranch): string[] => [b.kind, ...b.children.flatMap(kinds)];
        expect(kinds(none)).not.toContain('file');
    });

    it('focusing the root shows the files that sit directly in it', () => {
        const root = buildMindTree(nodes, findings, { focus: '' });
        expect(root.children.map((c) => `${c.kind}:${c.name}`)).toEqual(['folder:a', 'folder:b', 'file:top.ts']);
        expect(root.children.find((c) => c.name === 'top.ts')!.severity).toBeUndefined();
    });

    it('treats the root focus like no focus for which folders open (the default top folders stay open)', () => {
        const top = Array.from({ length: 10 }, (_, i) => [file(`t${i}/s/x.ts`, 0.5), file(`t${i}/s/y.ts`, 0.5)]).flat();
        const opened = (focus: string | null) => buildMindTree(top, [], { focus }).children.filter((c) => c.children.length > 0).length;
        expect(opened('')).toBe(OPEN_TOP_FOLDERS);
        expect(opened('')).toBe(opened(null));
    });

    it('folds folders deeper than the depth cap into their ancestor', () => {
        const deep = buildMindTree(nodes, findings, { focus: 'b/c/d' });
        let dir = child(deep, 'b');
        for (const name of ['c', 'd']) dir = child(dir, name);
        expect(MAX_FOLDER_DEPTH).toBe(3);
        expect(dir.children.map((c) => c.name)).toEqual(['deep.ts']);
    });

    it('tones a branch by the worst finding beneath it', () => {
        expect(child(tree, 'a').severity).toBe('warn');
        expect(child(tree, 'b').severity).toBe('error');
        expect(tree.severity).toBe('error');
        expect(worstSeverity(findings).get('src:r::a/f01.ts')).toBe('info');
    });

    it('leaves out facts and anything that is not a file', () => {
        const fact: KNode = { ref: 'fact:x', kind: 'fact', label: 'x', pack: 'docs', importance: 1, origin: 'human' };
        expect(buildMindTree([fact, { ...file('s.md', 1), kind: 'section' }], []).count).toBe(0);
    });
});

describe('mind map layout', () => {
    it('is deterministic whatever the input order', () => {
        for (const focus of [null, '', 'a', 'b/c/d']) {
            const a = mindMap(nodes, findings, { focus });
            const b = mindMap([...nodes].reverse(), [...findings].reverse(), { focus });
            expect(b).toEqual(a);
        }
    });

    it('places the root at the centre and each child one ring further out', () => {
        const { branches, bounds } = mindMap(nodes, findings);
        const root = branches[0]!;
        expect([root.x, root.y, root.depth]).toEqual([0, 0, 0]);
        for (const b of branches.slice(1)) {
            const parent = branches.find((p) => p.id === b.parent)!;
            expect(b.depth).toBe(parent.depth + 1);
            expect(b.radius).toBeGreaterThan(parent.radius);
        }
        expect(bounds.maxX).toBeGreaterThan(bounds.minX);
    });

    it('gives a branch an angular share proportional to its leaves', () => {
        const { branches } = mindMap(nodes, findings, { focus: 'a' });
        const a = branches.find((b) => b.name === 'a' && b.kind === 'folder')!;
        const b = branches.find((x) => x.name === 'b' && x.kind === 'folder')!;
        expect(a.refs.length).toBeGreaterThan(b.refs.length);
        expect(a.span).toBeCloseTo(b.span * 9, 6); // 8 files and "+4 more" against one folded folder
        expect(a.angle).not.toBe(b.angle);
    });
});

describe('mind map at scale', () => {
    // 1,000 folders of different sizes: 40 top-level ones, the rest nested under them.
    const big: KNode[] = [];
    for (let i = 0; i < 1000; i++) {
        const top = `t${pad(i % 40)}`;
        const dir = i < 40 ? top : `${top}/s${String(i).padStart(4, '0')}`;
        for (let k = 0; k <= i % 7; k++) big.push(file(`${dir}/f${k}.ts`, 0.5));
    }
    const wide = Array.from({ length: 1000 }, (_, i) => file(`d${String(i).padStart(4, '0')}/x.ts`, 0.5));

    it('places at most MAX_BRANCHES, folding the rest into a "+N folders" leaf', () => {
        for (const focus of [null, '', 't00', 't07/s0047']) {
            expect(mindMap(big, [], { focus }).branches.length).toBeLessThanOrEqual(MAX_BRANCHES);
        }
        const { branches } = mindMap(wide, []);
        expect(branches.length).toBeLessThanOrEqual(MAX_BRANCHES);
        const more = branches.find((b) => b.kind === 'more' && b.folders !== undefined)!;
        expect(more.folders).toBeGreaterThan(0);
        expect(more.parent).toBe(branches[0]!.id);
        expect(branches.filter((b) => b.kind === 'folder')).toHaveLength(MAX_BRANCHES - 2);
    });

    it('cuts the smallest folders first, deterministically', () => {
        const sized = [...Array.from({ length: 600 }, (_, i) => file(`s${String(i).padStart(3, '0')}/x.ts`, 0.5)), file('big/a.ts', 0.5), file('big/b.ts', 0.5), file('big/c.ts', 0.5)];
        const names = (ns: KNode[]) => mindMap(ns, []).branches.filter((b) => b.kind === 'folder').map((b) => b.name);
        expect(names(sized)).toContain('big');
        expect(names([...sized].reverse())).toEqual(names(sized));
    });

    it('expands exactly the focused folder, not its siblings', () => {
        const expanded = (focus: string | null) => buildMindTree(big, [], { focus }).children.filter((c) => c.children.length > 0).map((c) => c.name);
        expect(expanded('t05')).toEqual(['t05']);
        expect(expanded(null)).toHaveLength(OPEN_TOP_FOLDERS);
        const t05 = buildMindTree(big, [], { focus: 't05' }).children.find((c) => c.name === 't05')!;
        expect(t05.children.some((c) => c.kind === 'file')).toBe(true);
    });

    it('keeps the focused folder even when it is the smallest and the map is over budget', () => {
        const bigger = wide.flatMap((n, i) => [n, file(`d${String(i).padStart(4, '0')}/y.ts`, 0.5)]);
        const { branches } = mindMap([...bigger, file('zzz/only.ts', 0.5)], [], { focus: 'zzz' });
        expect(branches.some((b) => b.kind === 'file' && b.name === 'only.ts')).toBe(true);
        expect(branches.length).toBeLessThanOrEqual(MAX_BRANCHES);
    });

    it('reaches every folder by paging the "+N folders" leaf, one page after another', () => {
        const seen = new Set<string>();
        let start = 0;
        let pages = 0;
        for (; pages < 100; pages++) {
            const tree = buildMindTree(wide, [], { window: pages === 0 ? null : { parent: '', start } });
            for (const c of tree.children) if (c.kind === 'folder') seen.add(c.name);
            const leaf = tree.children.find((c) => c.kind === 'more' && c.page);
            if (!leaf) break;
            expect(leaf.page!.parent).toBe('');
            expect(leaf.page!.next).toBeGreaterThan(start); // every page makes progress
            start = leaf.page!.next;
        }
        expect(seen.size).toBe(1000);
        expect(pages).toBeGreaterThan(1);
        // And a page is a full map too.
        expect(mindMap(wide, [], { window: { parent: '', start: 400 } }).branches.length).toBeLessThanOrEqual(MAX_BRANCHES);
    });

    it('pages a nested parent too', () => {
        const nested = Array.from({ length: 700 }, (_, i) => file(`top/s${String(i).padStart(3, '0')}/x.ts`, 0.5));
        const seen = new Set<string>();
        let start = 0;
        for (let page = 0; page < 100; page++) {
            const tree = buildMindTree(nested, [], { focus: 'top', window: page === 0 ? null : { parent: 'top', start } });
            const top = tree.children.find((c) => c.name === 'top')!;
            for (const c of top.children) if (c.kind === 'folder') seen.add(c.name);
            const leaf = top.children.find((c) => c.kind === 'more' && c.page);
            if (!leaf) break;
            start = leaf.page!.next;
        }
        expect(seen.size).toBe(700);
    });

    it('spaces a crowded ring out so neighbouring dots keep their gap', () => {
        const { branches } = mindMap(big, []);
        const ring1 = branches.filter((b) => b.depth === 1);
        // The thinnest branch is never counted as thinner than a quarter of an even share, so one sliver cannot inflate the ring.
        const share = Math.max(Math.min(...ring1.map((b) => b.span)), (2 * Math.PI) / (4 * ring1.length));
        expect(ring1[0]!.radius * share).toBeGreaterThanOrEqual(6 - 1e-3);
        expect(ring1[0]!.radius).toBeGreaterThan(14);
    });

    it('does not let one very thin branch push a whole ring out', () => {
        // 30 plain folders and one that holds 300 subfolders: its subtree takes almost the whole circle, the others are slivers.
        const lopsided = [
            ...Array.from({ length: 30 }, (_, i) => file(`p${pad(i)}/x.ts`, 0.5)),
            ...Array.from({ length: 300 }, (_, i) => file(`big/s${String(i).padStart(3, '0')}/f.ts`, 0.5)),
        ];
        const { branches } = mindMap(lopsided, [], { focus: 'big' });
        const ring1 = branches.filter((b) => b.depth === 1);
        const radius = ring1[0]!.radius;
        const thinnest = Math.min(...ring1.map((b) => b.span));
        expect(radius).toBeLessThan(6 / thinnest); // clamped: not sized for the sliver
        expect(radius * ((2 * Math.PI) / (4 * ring1.length))).toBeGreaterThanOrEqual(6 - 1e-3);
    });

    it('pages the focused folder\'s files like it pages folders, until every file has been shown', () => {
        const flat = Array.from({ length: 30 }, (_, i) => file(`d/f${String(i).padStart(2, '0')}.ts`, 1 - i / 100));
        const seen: string[] = [];
        let start = 0;
        for (let page = 0; page < 10; page++) {
            const d = buildMindTree(flat, [], { focus: 'd', files: page === 0 ? null : { folder: 'd', start } }).children.find((c) => c.name === 'd')!;
            seen.push(...d.children.filter((c) => c.kind === 'file').map((c) => c.name));
            const leaf = d.children.find((c) => c.kind === 'more');
            if (!leaf) break;
            expect(leaf.page).toEqual({ parent: 'd', next: start + FILES_PER_FOLDER, of: 'files' });
            start = leaf.page!.next;
        }
        expect(seen).toEqual(Array.from({ length: 30 }, (_, i) => `f${String(i).padStart(2, '0')}.ts`));
    });

    it('keeps a paged nested parent and its first folders placed while a big sibling competes for the budget', () => {
        const rows = [
            ...Array.from({ length: 380 }, (_, i) => [file(`d${String(i).padStart(3, '0')}/a.ts`, 0.5), file(`d${String(i).padStart(3, '0')}/b.ts`, 0.5)]).flat(),
            ...Array.from({ length: 100 }, (_, i) => file(`tiny/s${String(i).padStart(3, '0')}/x.ts`, 0.5)),
        ];
        const { branches } = mindMap(rows, [], { focus: 'tiny', window: { parent: 'tiny', start: 60 } });
        expect(branches.some((b) => b.kind === 'folder' && b.id === 'tiny')).toBe(true);
        expect(branches.some((b) => b.kind === 'folder' && b.id === 'tiny/s060')).toBe(true);
        expect(branches.some((b) => b.kind === 'folder' && b.id === 'tiny/s099')).toBe(true);
        expect(branches.length).toBeLessThanOrEqual(MAX_BRANCHES);
    });
});

describe('focus and the way out', () => {
    it('names the folder every focused ref shares', () => {
        expect(focusFolder(['src:r::a/f00.ts', 'src:r::a/f01.ts'])).toBe('a');
        expect(focusFolder(['src:r::a/x/f.ts', 'src:r::a/y/g.ts'])).toBe('a');
        expect(focusFolder(['src:r::a/f.ts', 'src:r::b/g.ts'])).toBe('');
        expect(focusFolder(['src:r::b/c/d/e/deep.ts'])).toBe('b/c/d');
        expect(focusFolder([])).toBeNull();
        expect(focusFolder(['fact:x'])).toBeNull();
    });

    it('goes out to the parent folder, or clears the focus at the top level', () => {
        expect(outTarget(nodes, '', 'root')).toBeNull();
        expect(outTarget(nodes, 'a', 'My repo')).toEqual({ name: 'My repo', folder: null, refs: [] });
        const out = outTarget(nodes, 'b/c/d', 'My repo')!;
        expect(out.name).toBe('c');
        expect(out.folder).toBe('b/c');
        expect(out.refs).toEqual(['src:r::b/c/d/e/deep.ts']);
    });

    it('goes out exactly one level even when the parent holds the same files as the folder (a chain of single-child folders)', () => {
        const chain = [file('packages/foo/src/a.ts', 0.5), file('packages/foo/src/b.ts', 0.5), file('packages/bar/x.ts', 0.5)];
        const out = outTarget(chain, 'packages/foo/src', 'repo')!;
        expect(out.folder).toBe('packages/foo');
        // The refs alone would name the folder we left; the explicit path is what moves the map up.
        expect(focusFolder(out.refs)).toBe('packages/foo/src');
        const tree = buildMindTree(chain, [], { focus: out.folder });
        const foo = tree.children.find((c) => c.name === 'packages')!.children.find((c) => c.name === 'foo')!;
        expect(foo.children.map((c) => c.name)).toEqual(['src']);
        expect(foo.children[0]!.children).toEqual([]); // src is folded again: one level up
        // And again: foo -> packages -> the top level.
        expect(outTarget(chain, 'packages/foo', 'repo')!.folder).toBe('packages');
        expect(outTarget(chain, 'packages', 'repo')!.folder).toBeNull();
    });
});

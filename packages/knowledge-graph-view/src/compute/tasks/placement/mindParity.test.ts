/**
 * The Mind map placement against the retired SVG `MindMap` (PRD 43 B8, Tests): each of its structural assertions as a
 * placement assertion of the same fact. The tree model itself (budget, paging windows, Out) stays in
 * `map/mindMapModel.test.ts`; the label budget in `map/labelBudget.test.ts`.
 *
 * - "labels the root" → a label run for the root folder's slot, above it;
 * - "expands the clicked folder" → focusing a folder shows its subfolders, not a sibling's; an unfocused one stays folded;
 * - "pages the focused folder's files through '+N more'" → FILES_PER_FOLDER files shown and a localized "+N more" caption;
 * - "pages the '+N folders' leaf" → a localized "+N folders" caption when the map is over its branch budget.
 */

import { describe, expect, it } from 'vitest';
import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../../labels';
import { FILES_PER_FOLDER } from '../../../map/mindMapModel';
import { codeFixture } from '../../../testing';
import type { Placement } from '../../../stage/types';
import { buildStageModel, type StageModel } from '../stageModel';
import { dirKey } from '../markSet';
import { PLACEMENTS, type PlacementReq } from './index';

const file = (path: string): KNode => ({ ref: `src:r::${path}` as KNode['ref'], kind: 'file', label: path, pack: 'code', importance: 0.5, origin: 'extracted' });
const graphOf = (nodes: KNode[]): KnowledgeGraph => ({ ...codeFixture('r'), nodes, edges: [], findings: [] });
const STRINGS = { mapMore: L.mapMore, 'mind.moreFoldersOne': L.surface.mind.moreFoldersOne, 'mind.moreFoldersOther': L.surface.mind.moreFoldersOther };

function place(g: KnowledgeGraph, unfolded: string | null = null): { p: Placement; model: StageModel } {
    const model = buildStageModel(g, [], STRINGS);
    const req: PlacementReq = { graph: 1, generation: model.marks.generation, camera: 'mind', drill: null, unfolded, pins: [], pathId: null, viewportBand: 2, lod: 0 };
    const t = PLACEMENTS.mind(g, model, req);
    while (!t.step());
    return { p: t.result(), model };
}
const shownDirs = (p: Placement, model: StageModel): string[] =>
    p.a11y.map((a) => model.marks.keys[a.slot]!).filter((k) => k.startsWith('dir:')).map((k) => k.slice(4));

describe('the Mind map placement, the SVG mind map\'s facts (PRD 43 B8)', () => {
    // packages/foo holds only src: the files of foo and of foo/src are the same.
    const chain = graphOf([file('packages/foo/src/a.ts'), file('packages/foo/src/b.ts'), file('packages/bar/x.ts')]);

    it('labels the root, above its mark', () => {
        const { p, model } = place(chain);
        const root = model.marks.keys.indexOf(dirKey(''));
        const run = p.labels.find((l) => l.slot === root);
        expect(run).toBeDefined();
        expect(run!.anchor).toBe('middle');
        expect(run!.offsetPx[1]).toBeLessThan(0);
    });

    it('expands the focused folder and only that one: its subfolders show, a sibling\'s stay folded', () => {
        const top = place(chain);
        expect(shownDirs(top.p, top.model)).toContain('packages');
        const foo = place(chain, dirKey('packages/foo'));
        expect(shownDirs(foo.p, foo.model)).toContain('packages/foo/src');
        const bar = place(chain, dirKey('packages/bar'));
        expect(shownDirs(bar.p, bar.model)).not.toContain('packages/foo/src');
    });

    it('shows a focused folder\'s first FILES_PER_FOLDER files and says "+N more" for the rest', () => {
        const many = graphOf(Array.from({ length: 20 }, (_, i) => file(`docs/f${String(i).padStart(2, '0')}.ts`)));
        const { p, model } = place(many, dirKey('docs'));
        const files = p.a11y.filter((a) => model.marks.keys[a.slot]!.startsWith('node:'));
        expect(files).toHaveLength(FILES_PER_FOLDER);
        expect(p.captions.map((c) => c.text)).toContain(fillTemplate(L.mapMore, { count: 20 - FILES_PER_FOLDER }));
        expect(p.caption.capped).toBe(true);
    });

    it('folds the folders past the branch budget into a localized "+N folders" caption', () => {
        const wide = graphOf(Array.from({ length: 900 }, (_, i) => file(`d${String(i).padStart(4, '0')}/x.ts`)));
        const { p, model } = place(wide);
        expect(shownDirs(p, model).length).toBeLessThan(900);
        const folders = p.captions.map((c) => c.text).filter((t) => /\d/.test(t));
        expect(folders.length).toBeGreaterThan(0);
        const hidden = 900 - (shownDirs(p, model).length - 1);
        expect(folders).toContain(fillTemplate(L.surface.mind.moreFoldersOther, { count: hidden }));
    });
});

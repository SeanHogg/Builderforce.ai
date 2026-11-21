/**
 * The Mind map placement (PRD 43 B1a rules 4 and 8, B2): the SAME marks laid out on the mind map's own radial folder tree
 * (`buildMindTree` + `layoutMindMap`, read unchanged — the SVG mind map draws the same model). The root folder (`dir:`),
 * the placed folders (`dir:<path>`) and the focused folder's files (`node:<ref>`) are shown at their ring positions,
 * scaled into the viewport band; the tree edges are ONE `edge` link batch; a "+N more" / "+N folders" leaf has no slot,
 * so it is a localized caption. Depth turns the tree into a cone (each ring sinks by {@link CONE_STEP}). Everything else is
 * anchored at its nearest placed folder at scale 0 (scheme `folder`).
 *
 * The focused folder is `req.unfolded`: `dir:<path>` expands that folder, `node:<ref>` the folder its file sits in. The
 * worker has no labels object: the words come from `model.strings` ({@link MIND_WORD_KEYS}). Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { focusFolder } from '../../../map/folderTree';
import { maxLabelFont } from '../../../map/labelBudget';
import { BRANCH_RADIUS, clipBranchName, MIN_BRANCH_RADIUS_PX } from '../../../map/mindLayout';
import { mindMap, type PlacedBranch } from '../../../map/mindMapModel';
import { isOne } from '../../../surface/plural';
import { fillTemplate } from '../../../template';
import { CAPTION_FONT_PX } from '../../../stage/labels/lod';
import { BG_TONE, toneIndex } from '../../../stage/tones';
import { DASH_SOLID, type Caption, type LabelRun, type Placement } from '../../../stage/types';
import { dirSlotsOf } from '../markSet';
import type { StageModel } from '../stageModel';
import { anchorHidden, draftFor, show } from './anchor';
import { polylineBatch, type WorldPath } from './links';
import { placementKeyOf, VIEWPORT_BANDS, type PlacementReq } from './request';

const MARGIN = 24;
/** World units each ring sinks per folder depth at full depth (the tree becomes a cone, B2). */
export const CONE_STEP = 40;

/** The catalog words the Mind map placement reads from `model.strings` (the main thread copies them from its labels). */
export const MIND_WORD_KEYS = ['mapMore', 'mind.moreFoldersOne', 'mind.moreFoldersOther'] as const;

/** The focused folder `req.unfolded` names: `dir:<path>`, or the folder of `node:<ref>`; null for none. */
export function mindFocusOf(unfolded: string | null): string | null {
    if (!unfolded) return null;
    if (unfolded.startsWith('dir:')) return unfolded.slice(4);
    if (unfolded.startsWith('node:')) return focusFolder([unfolded.slice(5)]);
    return null;
}

/** The slot a branch draws, or undefined for a "+N more" leaf (no slot: it is a caption). */
function slotOf(b: PlacedBranch, model: StageModel, dirSlot: ReadonlyMap<string, number>): number | undefined {
    if (b.kind === 'root') return dirSlot.get('');
    if (b.kind === 'folder') return dirSlot.get(b.id);
    if (b.kind === 'file') return model.nodeSlot.get(b.ref ?? b.id);
    return undefined;
}

function moreText(b: PlacedBranch, strings: Readonly<Record<string, string>>): string {
    if (b.folders !== undefined) return fillTemplate(strings[isOne(b.folders) ? 'mind.moreFoldersOne' : 'mind.moreFoldersOther'], { count: b.folders });
    return fillTemplate(strings.mapMore, { count: b.count });
}

export function placeMind(g: KnowledgeGraph, model: StageModel, req: PlacementReq): Placement {
    const { marks } = model;
    const map = mindMap(g.nodes, [], { focus: mindFocusOf(req.unfolded) });
    const dirSlot = dirSlotsOf(marks.keys);

    const width = VIEWPORT_BANDS[req.viewportBand] ?? VIEWPORT_BANDS[2]!;
    const b = map.bounds;
    const k = (width - 2 * MARGIN) / Math.max(1, b.maxX - b.minX);
    const x = (v: number) => MARGIN + (v - b.minX) * k, z = (v: number) => MARGIN + (v - b.minY) * k;
    const sink = Math.max(0, Math.min(1, req.depth ?? 0)) * CONE_STEP;
    const at = (p: PlacedBranch): [number, number, number] => [x(p.x), -p.depth * sink, z(p.y)];

    const d = draftFor(marks.keys.length);
    const labels: LabelRun[] = [], captions: Caption[] = [], a11y: Placement['a11y'] = [], paths: WorldPath[] = [];
    const byId = new Map(map.branches.map((p) => [p.id, p] as const));
    const edgeTone = toneIndex('edge');
    const rootCount = map.branches.find((p) => p.kind === 'root')?.count ?? 0;
    let shown = 0;
    for (const p of map.branches) {
        const [px, py, pz] = at(p);
        const parent = p.parent !== undefined ? byId.get(p.parent) : undefined;
        if (parent) paths.push({ pts: [at(parent), [px, py, pz]], tone: edgeTone, width: 1, dash: DASH_SOLID, flags: 0 });
        const slot = slotOf(p, model, dirSlot);
        if (slot === undefined) {
            if (p.kind === 'more') captions.push({ text: moreText(p, model.strings), position: [px, py, pz], anchor: Math.cos(p.angle) < -0.01 ? 'end' : 'start', tone: toneIndex('muted') });
            continue;
        }
        const radius = BRANCH_RADIUS[p.kind] * k;
        show(d, slot, px, py, pz, radius);
        shown++;
        const name = p.kind === 'root' ? marks.label[slot] ?? '' : p.kind === 'folder' ? `${p.name} (${p.count})` : p.name;
        const text = clipBranchName(name);
        const left = Math.cos(p.angle) < -0.01;
        const root = p.kind === 'root';
        // Chosen by ROOM, as the SVG mind map labels (`labelFitsAt`), never by the dot's size: the root always, a branch
        // from the zoom at which its screen-size name fits its arc and radial room (layout units × k = world units).
        const fitsFrom = root ? 0 : CAPTION_FONT_PX / (k * maxLabelFont({ radius: p.radius, span: p.span, angle: p.angle, room: p.room, chars: text.length }));
        labels.push({
            slot, text, offsetWorld: root ? [0, -radius] : [(left ? -1 : 1) * radius, 0], offsetPx: root ? [0, -10] : [(left ? -1 : 1) * 6, 0],
            font: 'mono', size: CAPTION_FONT_PX, weight: p.kind === 'file' ? 400 : 700, anchor: root ? 'middle' : left ? 'end' : 'start',
            tone: toneIndex('text'), halo: { tone: BG_TONE, px: 3 }, priority: root ? 1 : Math.min(1, p.count / Math.max(1, rootCount)), scale: 'screen',
            minMarkPx: 0, ...(fitsFrom > 0 ? { zoomPx: [fitsFrom, Infinity] as [number, number] } : {}),
        });
        a11y.push({ slot, label: name });
    }
    const height = z(b.maxY) + MARGIN;
    anchorHidden(marks, d, 'folder', [width / 2, 0, height / 2]);
    const shownFiles = map.branches.filter((p) => p.kind === 'file').length;
    return {
        generation: marks.generation, cacheKey: placementKeyOf(marks, req), anchor: 'folder',
        position: d.position, scale: d.scale, extrude: d.extrude,
        links: paths.length ? [polylineBatch('edge', paths, 'px')] : [], planes: [], labels, captions, a11y,
        caption: { shown, total: shown + Math.max(0, rootCount - shownFiles), capped: shownFiles < rootCount },
        bounds: { min: [0, -sink * 8, 0], max: [width, 0, height] },
        // The SVG mind map's least dot: fitted into one band, a big tree's dots are otherwise a pixel or two across.
        minMarkPx: 2 * MIN_BRANCH_RADIUS_PX,
        rig: {
            projection: 'orthographic', frame: 'fill',
            home: { position: [width / 2, 1000, height / 2], target: [width / 2, 0, height / 2], up: [0, 0, -1] },
            depth: { tilt: [0, 60], orbit: false },
        },
    };
}

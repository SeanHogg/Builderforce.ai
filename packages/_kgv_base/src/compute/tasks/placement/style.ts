/**
 * The Style placement (PRD 43 B1a rule 8): the Architecture style camera's reading as planes of the SAME file marks.
 * The verdict (`architectureStyleOf`, unchanged — no model call) titles the stack; below it one plane per layer
 * (`LAYER_ORDER`, the five layers the style checks score), holding the source files (`sourceFilesOf`, the same files
 * the signals read) of that layer, most important first, at most {@link STYLE_ROW_CAP} per plane ("+N more"). Files in
 * no layer are not scored, so they stay hidden. A mark's radius is its importance (`nodeRadius`, the Graph camera's
 * reading). Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { nodeRadius } from '../../../graph2d/layout2d';
import { cmp, importanceOf } from '../../../order';
import { bandTitleIn } from '../../../surface/bands';
import { LAYER_ORDER } from '../../../surface/layers';
import { sourceFilesOf } from '../../../surface/sourceFiles';
import { architectureStyleOf, percentOf } from '../../../surface/style/architectureStyle';
import { fillTemplate } from '../../../template';
import type { Placement } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { draftFor } from './anchor';
import { CAMERA_WORD, styleNameKey, wordIn } from './cameraStrings';
import type { PlacementReq } from './request';
import { layoutRows, rowsPlacement, type Row } from './rows';

export const STYLE_METRICS = { pitch: 40, margin: 16 } as const;
/** Files drawn per layer plane; the rest are counted. */
export const STYLE_ROW_CAP = 120;
/** A file mark's radius per unit of `nodeRadius`. */
export const FILE_SCALE = 8;

const tail = (label: string): string => label.slice(label.lastIndexOf('/') + 1) || label;

/** The verdict line, in the DOM camera's words: the closest style and its fit, or "no clear style". */
export function styleVerdictOf(g: KnowledgeGraph, strings: Readonly<Record<string, string>>): string {
    const a = architectureStyleOf(g);
    const top = a.styles[0];
    if (!a.winner || !top) return wordIn(strings, CAMERA_WORD.styleVerdictNone);
    return fillTemplate(wordIn(strings, CAMERA_WORD.styleVerdict), { style: wordIn(strings, styleNameKey(a.winner)), percent: percentOf(top.fit) });
}

export function placeStyle(g: KnowledgeGraph, model: StageModel, req: PlacementReq): Placement {
    const { strings } = model;
    const files = sourceFilesOf(g);
    const rows: Row[] = LAYER_ORDER.flatMap((layer) => {
        const mine = files.filter((n) => n.partition === layer).sort((a, b) => importanceOf(b) - importanceOf(a) || cmp(a.ref, b.ref));
        if (mine.length === 0) return [];
        const items = mine.slice(0, STYLE_ROW_CAP).flatMap((n) => {
            const slot = model.nodeSlot.get(n.ref);
            return slot === undefined ? [] : [{ slot, scale: FILE_SCALE * nodeRadius(importanceOf(n)), label: tail(n.label), a11y: n.label, priority: importanceOf(n) }];
        });
        return [{ key: layer, title: bandTitleIn(strings, layer), items, more: mine.length - items.length }];
    });
    const d = draftFor(model.marks.keys.length);
    const out = layoutRows(d, [{ key: 'verdict', title: styleVerdictOf(g, strings), rows }], req, strings, STYLE_METRICS);
    return rowsPlacement(model, req, d, out, files.length);
}

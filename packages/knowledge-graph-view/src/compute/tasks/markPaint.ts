/**
 * MarkPaint (PRD 43 B1a rule 1, B7): tone / tone2 / fill / flags for every slot, from the lens, the question and the
 * overlay as DATA — the lens is looked up by id in the ONE lens registry (`LENSES`), the question by id in the ONE
 * question registry (`QUESTIONS` via `litStations`), the overlay is its `Bindings` run through the ONE `makeOverlay`.
 * No closure crosses the worker boundary. A lens, question, family or overlay change repaints; it never moves a mark.
 * Pure; runs in the worker.
 *
 * Lit / DIM: an explicit `lit` (the main thread's answer when a chosen line, the selection or a search decides it)
 * wins; otherwise `questionId` (+ `family`, the patterns narrowing) is answered here exactly as the surface answers it
 * with no line chosen and nothing selected (`useSurface`: `line` = the first line, `selected` = null). A station is lit
 * when it answers; a node when it or its station is named; a folder when any node in it is lit.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { LENSES } from '../../lenses';
import { ROLE_TONE, type TowerRole } from '../../scene/highlightRoles';
import { MARK_TYPE_ORDER } from '../../shapes';
import { makeOverlay, type Bindings } from '../../surface/overlays';
import { litStations, QUESTIONS, type QuestionId } from '../../surface/questions';
import { BG_TONE, toneIndex } from '../../stage/tones';
import { FLAG, SLOT_FOLDER, SLOT_NODE, type MarkPaint, type MarkSet } from '../../stage/types';
import type { LensId } from '../../types';
import type { StageModel } from './stageModel';

export interface PaintInput {
    lensId: string;
    overlay: Bindings;
    /** Keys, refs or station ids that stay lit; every other slot is dimmed. Null = the question (if any) decides. */
    lit: readonly string[] | null;
    /** An anti-pattern highlight: offenders and partners take their role's tone, every other slot dims. */
    roles: ReadonlyArray<readonly [ref: string, role: TowerRole]> | null;
    /** The question asked (a `QUESTIONS` id); null/unknown = none, nothing dims for it. */
    questionId?: string | null;
    /** The pattern family the patterns question is narrowed to; a family with no question asks `patterns`. */
    family?: string | null;
}

const DOC_TYPE = MARK_TYPE_ORDER.indexOf('doc');
const AREA_TONE = toneIndex('nodeArea');
const QUESTION_IDS: ReadonlySet<string> = new Set(QUESTIONS.map((q) => q.id));

export function paintMarks(g: KnowledgeGraph, model: StageModel, input: PaintInput): MarkPaint {
    const { marks, stations, lines } = model;
    const n = marks.keys.length;
    const tone = new Uint8Array(n), tone2 = new Uint8Array(n).fill(BG_TONE), fill = new Float32Array(n), flags = new Uint8Array(n);
    const lens = LENSES[input.lensId as LensId] ?? LENSES.structure;

    for (let i = 0; i < g.nodes.length; i++) {
        const style = lens.nodeStyle(g.nodes[i]!);
        tone[i] = toneIndex(style.tone);
        flags[i] = FLAG.SELECTABLE | (style.emphasis === 'dim' ? FLAG.DIM : 0);
    }

    const overlay = makeOverlay(input.overlay, stations.stations);
    const stopsAt = new Map<string, number>();
    for (const l of lines.lines) for (const id of new Set(l.stops)) stopsAt.set(id, (stopsAt.get(id) ?? 0) + 1);
    stations.stations.forEach((s) => {
        const slot = model.stationSlot.get(s.id)!;
        const st = overlay.style(s);
        tone[slot] = toneIndex(st.tone);
        if (st.ring) { tone2[slot] = toneIndex(st.ring.tone); fill[slot] = st.ring.frac; }
        flags[slot] = FLAG.SELECTABLE
            | (st.ring?.zeroCoverage ? FLAG.SHELL : 0) | (st.outline ? FLAG.OUTLINE : 0) | (st.pulse ? FLAG.PULSE : 0)
            | ((stopsAt.get(s.id) ?? 0) > 1 ? FLAG.INTERCHANGE : 0) | (marks.type[slot] === DOC_TYPE ? FLAG.DOC : 0);
    });

    for (let i = 0; i < n; i++) if (marks.slotKind[i] === SLOT_FOLDER) { tone[i] = AREA_TONE; flags[i] = FLAG.SELECTABLE; }

    const lit = input.lit ?? questionLit(model, input.questionId ?? null, input.family ?? null);
    if (lit) dimExcept(new Set(lit), marks, flags);
    if (input.roles) {
        const role = new Map(input.roles);
        for (let i = 0; i < n; i++) {
            if (marks.slotKind[i] !== SLOT_NODE) continue;
            const r = role.get(g.nodes[i]!.ref);
            if (r) tone[i] = toneIndex(ROLE_TONE[r]); else flags[i] = flags[i]! | FLAG.DIM;
        }
    }
    return { generation: marks.generation, tone, tone2, fill, flags };
}

/**
 * The stations a question lights, as the surface asks it with no line chosen and nothing selected (selection stays out
 * of paint, B1a). Null = nothing dims: no question, an unknown id, or a question whose answer is "every station".
 */
export function questionLit(model: Pick<StageModel, 'stations' | 'lines'>, questionId: string | null, family: string | null): readonly string[] | null {
    const id = questionId ?? (family ? 'patterns' : null);
    if (!id || !QUESTION_IDS.has(id)) return null;
    const { stations, lines } = model;
    const lit = litStations(id as QuestionId, stations.stations, { lines, line: lines.lines[0] ?? null, selected: null, family });
    return lit ? [...lit] : null;
}

/**
 * A slot is lit when its key or its bare id (`node:<ref>` → `<ref>`, `st:<id>` → `<id>`) is in `lit`; a node also when
 * its station is lit; a folder when any node in it is lit. Every other slot dims.
 */
function dimExcept(lit: ReadonlySet<string>, marks: Pick<MarkSet, 'keys' | 'slotKind' | 'parentStation' | 'parentFolder'>, flags: Uint8Array): void {
    const { keys } = marks;
    const on = new Uint8Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!;
        if (lit.has(key) || lit.has(key.slice(key.indexOf(':') + 1))) on[i] = 1;
    }
    for (let i = 0; i < keys.length; i++) {
        if (marks.slotKind[i] !== SLOT_NODE) continue;
        const st = marks.parentStation[i]!;
        if (!on[i] && st >= 0 && on[st]) on[i] = 1;
        // A folder lights with its lit nodes (and their ancestors).
        if (on[i]) for (let f = marks.parentFolder[i]!; f >= 0 && !on[f]; f = marks.parentFolder[f]!) on[f] = 1;
    }
    for (let i = 0; i < keys.length; i++) if (!on[i]) flags[i] = flags[i]! | FLAG.DIM;
}

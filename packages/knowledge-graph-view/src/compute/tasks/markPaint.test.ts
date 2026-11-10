import { describe, expect, it } from 'vitest';
import { LENSES } from '../../lenses';
import { PRESETS } from '../../surface/overlays';
import { litStations, QUESTIONS, type QuestionId } from '../../surface/questions';
import { withSymbols } from '../../surface/transit/testFixtures';
import { surfaceFixture } from '../../testing';
import { FLAG, SLOT_FOLDER, SLOT_NODE, SLOT_STATION, type MarkPaint } from '../../stage/types';
import { paintMarks, questionLit, type PaintInput } from './markPaint';
import { buildStageModel } from './stageModel';

const graph = withSymbols(surfaceFixture());
const model = buildStageModel(graph, []);
const { marks, stations, lines } = model;
const base: PaintInput = { lensId: 'structure', overlay: PRESETS.risk, lit: null, roles: null };
const paint = (over: Partial<PaintInput>): MarkPaint => paintMarks(graph, model, { ...base, ...over });
const dim = (p: MarkPaint, slot: number) => (p.flags[slot]! & FLAG.DIM) !== 0;

/** What the surface lights today (`useSurface`: no line chosen ⇒ the first line, nothing selected). */
const surfaceLit = (q: QuestionId, family: string | null = null) =>
    litStations(q, stations.stations, { lines, line: lines.lines[0] ?? null, selected: null, family });

describe('markPaint: the question and the family as data (PRD 43 B1a rule 1)', () => {
    it.each(QUESTIONS.map((q) => q.id))('%s: a station dims exactly when the surface would not light it', (q) => {
        const p = paint({ questionId: q });
        const lit = surfaceLit(q);
        for (const s of stations.stations) {
            const slot = model.stationSlot.get(s.id)!;
            expect(dim(p, slot), `${q} ${s.id}`).toBe(lit !== null && !lit.has(s.id));
        }
    });

    it('a node dims with its station (or by the lens); a folder stays lit while a node in it is', () => {
        const lit = surfaceLit('wrong');
        const p = paint({ questionId: 'wrong' });
        const lensDim = (i: number) => LENSES.structure.nodeStyle(graph.nodes[i]!).emphasis === 'dim';
        expect(lit).not.toBeNull();
        const nodeOn = (i: number) => { const st = marks.parentStation[i]!; return st >= 0 && lit!.has(stations.stations[st - graph.nodes.length]!.id); };
        let litNodes = 0;
        for (let i = 0; i < marks.keys.length; i++) {
            if (marks.slotKind[i] !== SLOT_NODE) continue;
            if (nodeOn(i)) litNodes++;
            expect(dim(p, i), marks.keys[i]).toBe(lensDim(i) || !nodeOn(i));
        }
        expect(litNodes).toBeGreaterThan(0);
        for (let f = 0; f < marks.keys.length; f++) {
            if (marks.slotKind[f] !== SLOT_FOLDER) continue;
            const anyLit = marks.keys.some((_, i) => {
                if (marks.slotKind[i] !== SLOT_NODE || !nodeOn(i)) return false;
                let at = marks.parentFolder[i]!;
                while (at >= 0 && at !== f) at = marks.parentFolder[at]!;
                return at === f;
            });
            expect(dim(p, f), marks.keys[f]).toBe(!anyLit);
        }
    });

    it('the family narrows the patterns question, and a family alone asks it', () => {
        const family = stations.stations.flatMap((s) => s.patterns)[0];
        expect(family, 'the fixture carries a pattern family').toBeDefined();
        const narrowed = surfaceLit('patterns', family!), all = surfaceLit('patterns');
        expect(narrowed).not.toBeNull();
        expect(questionLit(model, 'patterns', family!)?.slice().sort()).toEqual([...narrowed!].sort());
        expect(questionLit(model, null, family!)?.slice().sort()).toEqual([...narrowed!].sort());
        expect(questionLit(model, 'patterns', null)?.slice().sort()).toEqual([...all!].sort());
        const p = paint({ questionId: 'patterns', family: family! });
        for (const s of stations.stations) expect(dim(p, model.stationSlot.get(s.id)!)).toBe(!narrowed!.has(s.id));
    });

    it('no question, an unknown id, or "layers" dims nothing; an explicit lit wins over the question', () => {
        const none = paint({});
        for (const q of [null, 'nope', 'layers']) expect([...paint({ questionId: q }).flags]).toEqual([...none.flags]);
        const one = stations.stations[0]!;
        const p = paint({ questionId: 'changed', lit: [one.id] });
        for (const s of stations.stations) expect(dim(p, model.stationSlot.get(s.id)!)).toBe(s.id !== one.id);
        expect(marks.slotKind[model.stationSlot.get(one.id)!]).toBe(SLOT_STATION);
    });

    it('never moves anything: tone, tone2 and fill do not depend on the question', () => {
        const a = paint({}), b = paint({ questionId: 'wrong', family: 'x' });
        expect([...b.tone]).toEqual([...a.tone]);
        expect([...b.tone2]).toEqual([...a.tone2]);
        expect([...b.fill]).toEqual([...a.fill]);
    });
});

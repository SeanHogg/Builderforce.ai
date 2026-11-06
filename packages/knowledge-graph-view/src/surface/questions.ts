/**
 * The questions (PRD 38, Option B+): the old lenses recast as things a person asks. Each is
 * a ROW: the lens it opens where one exists (so `initialLens` and every lens id keep
 * working), a predicate over stations that says which ones answer it, a note per lit
 * station, and what data it needs. Nothing in the surface branches on a question id except
 * through this table.
 */

import type { KnowledgeGraphLabels } from '../labels';
import { fillTemplate } from '../template';
import type { LensId } from '../types';
import type { Line, LinesModel } from './lines';
import { metricStatus, type MetricStatus } from './overlays';
import type { Station } from './stations';

export type QuestionId =
    | 'where' | 'wrong' | 'untested' | 'patterns' | 'changed' | 'callers' | 'copied' | 'unused' | 'claims' | 'layers' | 'knowledge';

export type NoteKey = 'patterns' | 'copied' | 'unused' | 'claims' | 'layers' | 'knowledge' | 'changed';

export interface QuestionContext {
    lines: LinesModel;
    /** The selected line, if any. */
    line: Line | null;
    /** The selected station, if any. */
    selected: Station | null;
    /** The pattern family the patterns question is narrowed to ("Behavioural only"), if any. */
    family?: string | null;
}

export interface QuestionDef {
    id: QuestionId;
    /** The lens this question opens (the question set replaces the lens chips, not the ids). */
    lens?: LensId;
    /** Shown as a chip; the rest sit under More. */
    primary: boolean;
    /** Which stations answer it. */
    matches(s: Station, ctx: QuestionContext): boolean;
    /** The line of text a lit station carries, as a label key and its value. */
    note(s: Station): { key: NoteKey; value: string | number } | null;
    /** Whether the data it needs exists. */
    status(stations: readonly Station[]): MetricStatus;
}

const ready = (): MetricStatus => 'ready';
/** Ready once any station carries the reading; a graph no file carries it in has never been analysed for it. */
const carried = (pick: (s: Station) => number) => (stations: readonly Station[]): MetricStatus => (stations.some((s) => pick(s) > 0) ? 'ready' : 'not-set-up');
const linesOf = (ctx: QuestionContext, id: string): string[] => ctx.lines.lines.filter((l) => l.stops.includes(id)).map((l) => l.id);
const count = (key: NoteKey, value: number) => (value > 0 ? { key, value } : null);

export const QUESTIONS: readonly QuestionDef[] = [
    {
        id: 'where', lens: 'structure', primary: true, status: ready, note: () => null,
        matches: (s, ctx) => (ctx.line ? ctx.line.stops.includes(s.id) : true),
    },
    {
        id: 'wrong', primary: true, status: ready, note: () => null,
        matches: (s) => s.findingIds.length > 0 || s.anti >= 3,
    },
    {
        id: 'untested', primary: true, note: () => null,
        status: (stations) => metricStatus('cov', stations),
        matches: (s) => s.cov !== undefined && s.cov < 0.5,
    },
    {
        id: 'patterns', primary: true,
        note: (s) => (s.patterns.length ? { key: 'patterns', value: s.patterns.join(' · ') } : null),
        status: (stations) => (stations.some((s) => s.patterns.length > 0) ? 'ready' : 'not-set-up'),
        matches: (s, ctx) => s.patterns.length > 0 && (!ctx.family || s.patterns.includes(ctx.family)),
    },
    {
        id: 'changed', lens: 'live', primary: true, status: ready,
        note: (s) => (s.changed ? { key: 'changed', value: 1 } : null),
        matches: (s) => s.changed,
    },
    {
        id: 'callers', lens: 'links', primary: false, status: ready, note: () => null,
        matches: (s, ctx) => {
            const mine = linesOf(ctx, s.id);
            if (!ctx.selected) return mine.length > 1;
            const theirs = linesOf(ctx, ctx.selected.id);
            return mine.some((id) => theirs.includes(id));
        },
    },
    {
        id: 'copied', lens: 'duplication', primary: false, status: carried((s) => s.dup),
        note: (s) => count('copied', s.dup), matches: (s) => s.dup > 0,
    },
    {
        id: 'unused', lens: 'unused', primary: false, status: carried((s) => s.unused),
        note: (s) => count('unused', s.unused), matches: (s) => s.unused > 0,
    },
    {
        id: 'claims', lens: 'claims', primary: false, status: carried((s) => s.claims),
        note: (s) => count('claims', s.claims), matches: (s) => s.claims > 0,
    },
    {
        id: 'layers', lens: 'partitions', primary: false, status: ready,
        note: (s) => (s.layer ? { key: 'layers', value: s.layer } : null), matches: () => true,
    },
    {
        id: 'knowledge', lens: 'knowledge', primary: false, status: carried((s) => s.facts),
        note: (s) => count('knowledge', s.facts), matches: (s) => s.facts > 0,
    },
];

export const PRIMARY_QUESTIONS: readonly QuestionDef[] = QUESTIONS.filter((q) => q.primary);
export const MORE_QUESTIONS: readonly QuestionDef[] = QUESTIONS.filter((q) => !q.primary);

export function questionDef(id: QuestionId): QuestionDef {
    return QUESTIONS.find((q) => q.id === id) ?? QUESTIONS[0]!;
}

/** The question a lens belongs to, when one does (Compare has none). */
export function questionForLens(lens: LensId): QuestionId | undefined {
    return QUESTIONS.find((q) => q.lens === lens)?.id;
}

/** The ids of the stations that answer the question. `null` means every station does. */
export function litStations(id: QuestionId, stations: readonly Station[], ctx: QuestionContext): Set<string> | null {
    const q = questionDef(id);
    // A question whose data was never collected has no answer to light: it dims nothing (the answer line says "not set up").
    if (q.id === 'layers' || (q.id === 'where' && !ctx.line) || q.status(stations) === 'not-set-up') return null;
    return new Set(stations.filter((s) => q.matches(s, ctx)).map((s) => s.id));
}

/** What a question answers: its data is not there, nothing matches, N stations do, or every station does. */
export type Answer = { kind: 'not-set-up' } | { kind: 'none' } | { kind: 'count'; count: number } | { kind: 'all' };

/**
 * The ONE reading of a question's answer, for the ask bar's note and the scene alike. Pure:
 * `surface.lit` is what the surface lights (`null` = every station), so a search or a pinpoint
 * that focused refs is answered as the stations it lit.
 */
export function answerFor(question: QuestionId, surface: { stations: { stations: readonly Station[] }; lit: ReadonlySet<string> | null }): Answer {
    if (questionDef(question).status(surface.stations.stations) === 'not-set-up') return { kind: 'not-set-up' };
    if (surface.lit === null) return { kind: 'all' };
    return surface.lit.size === 0 ? { kind: 'none' } : { kind: 'count', count: surface.lit.size };
}

/** The answer in words ("No station matches", "Not set up…", "{n} stations"); empty when every station answers. */
export function answerLine(answer: Answer, labels: KnowledgeGraphLabels): string {
    const s = labels.surface;
    switch (answer.kind) {
        case 'not-set-up': return s.answerNotSetUp;
        case 'none': return s.answerNone;
        case 'count': return fillTemplate(s.answerCount, { count: answer.count });
        default: return '';
    }
}

/**
 * The actions of a lens line (PRD 43 Part C2) as ROWS of one table: `LensLine` maps the rows whose `when` holds and
 * draws them, so a new action is a new row here and nothing else. A row names its id, the predicate over the lens's
 * symbol and the context, its label (a `labels.surface.code` key, filled) and an optional glyph. The first four are the
 * old class / method links; `out`, `simulate` and `restructure` show only when the host wired their handler (`ctx.has`)
 * and, for the last two, the symbol's facts say so (`symbolFacts`: untested, carries an anti-pattern). Pure.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import type { SymbolFacts } from '../../surface/symbolFacts';
import type { Lens } from './codeText';

export type LensActionId = 'references' | 'show' | 'callers' | 'drill' | 'out' | 'simulate' | 'restructure';

type CodeLabels = KnowledgeGraphLabels['surface']['code'];

/** What a row's predicate and label read besides the lens: the facts (computed once), where you are, which handlers exist. */
export interface LensCtx {
    facts: SymbolFacts;
    /** The symbol whose level you are inside (the open method at the code level, else the drilled level's): `out` shows on it. */
    inside: string | null;
    /** Whether the host handles `id`; a row with no handler is hidden (the old four always show, as plain text when unhandled). */
    has(id: LensActionId): boolean;
}

export interface LensActionRow {
    id: LensActionId;
    /** Drawn on the accent: the action that goes somewhere. */
    go?: boolean;
    /** A short mark before the label, decorative (the label carries the meaning). */
    glyph?: string;
    when(lens: Lens, ctx: LensCtx | null): boolean;
    label(t: CodeLabels, lens: Lens, ctx: LensCtx | null): string;
}

const isClass = (l: Lens) => l.kind === 'class';
const isMethod = (l: Lens) => l.kind === 'method';

/** In display order. */
export const LENS_ACTIONS: readonly LensActionRow[] = [
    { id: 'references', when: isClass, label: (t, l) => fillTemplate(t.lensReferences, { count: l.count }) },
    { id: 'show', go: true, when: isClass, label: (t) => t.showInMap },
    { id: 'callers', when: isMethod, label: (t, l) => fillTemplate(l.count === 1 ? t.lensCaller : t.lensCallers, { count: l.count }) },
    { id: 'drill', go: true, when: isMethod, label: (t) => t.drillIn },
    { id: 'out', glyph: '⤒', when: (l, c) => !!c && c.inside === l.ref && c.has('out'), label: (t) => t.lensOut },
    { id: 'simulate', glyph: '▷', when: (l, c) => !!c && c.has('simulate') && c.facts.untested(l.ref), label: (t) => t.lensSimulate },
    {
        id: 'restructure', glyph: '⚒', when: (l, c) => !!c && c.has('restructure') && c.facts.antiPatternOf(l.ref) !== null,
        label: (t, l, c) => fillTemplate(t.lensRestructure, { name: c?.facts.antiPatternOf(l.ref)?.kind ?? '' }),
    },
];

/** The rows to draw for `lens`, in order. */
export function visibleLensActions(lens: Lens, ctx: LensCtx | null): LensActionRow[] {
    return LENS_ACTIONS.filter((row) => row.when(lens, ctx));
}

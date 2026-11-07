/**
 * The question chips: the five primary questions as pills, a *More questions* menu for the
 * rest, and a "{family} only ✕" chip while the patterns question is narrowed to a family.
 *
 * The lens row is gone: every lens is reachable here. A lens that is a question's twin opens
 * with that question (its menu item says "was the {lens} lens"); a lens with no question
 * (Compare) is a menu item of its own, and picking it does exactly what its old chip did. A
 * question whose data was never collected stays pickable and says so in its tooltip.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import type { LensDef } from '../lenses';
import type { LensId } from '../types';
import { MORE_QUESTIONS, PRIMARY_QUESTIONS, questionForLens, type QuestionId } from './questions';
import type { Station } from './stations';
import { Menu, Pill, pillStyle, type MenuItem } from './ui';

export interface QuestionBarProps {
    labels: KnowledgeGraphLabels;
    stations: readonly Station[];
    question: QuestionId;
    onQuestion(id: QuestionId): void;
    /** The lenses available now (the host's subset, applicable to the graph). Absent ⇒ questions only. */
    lenses?: readonly LensDef[] | undefined;
    lens?: LensId | undefined;
    /** Picks a lens that has no question of its own (Compare). */
    onLens?: ((id: LensId) => void) | undefined;
    /** The pattern family the patterns question is narrowed to; null/absent ⇒ no chip. */
    family?: string | null | undefined;
    onClearFamily?: (() => void) | undefined;
}

const LENS_PREFIX = 'lens:';

/** The picked lens when it has no question of its own (Compare) and is on offer; null otherwise. */
export function lensOnlyOf(lenses: readonly LensDef[] | undefined, lens: LensId | undefined): LensId | null {
    return lens !== undefined && questionForLens(lens) === undefined && lenses?.some((l) => l.id === lens) === true ? lens : null;
}

/** The More menu: the secondary questions, then every lens that has no question. */
export function moreItems(labels: KnowledgeGraphLabels, question: QuestionId, lenses: readonly LensDef[] | undefined, lens: LensId | undefined): MenuItem[] {
    const sub = (id: LensId) => fillTemplate(labels.surface.overlay.lensSub, { lens: labels.lenses[id] });
    const lensOnly = lensOnlyOf(lenses, lens);
    const items: MenuItem[] = MORE_QUESTIONS.map((q) => ({
        id: q.id, label: labels.surface.questions[q.id], selected: lensOnly === null && q.id === question, ...(q.lens ? { sub: sub(q.lens) } : {}),
    }));
    for (const l of lenses ?? []) {
        if (questionForLens(l.id)) continue;
        items.push({ id: `${LENS_PREFIX}${l.id}`, label: labels.lenses[l.id], sub: sub(l.id), selected: lens === l.id });
    }
    return items;
}

export function QuestionBar({ labels, stations, question, onQuestion, lenses, lens, onLens, family, onClearFamily }: QuestionBarProps) {
    const s = labels.surface;
    const items = moreItems(labels, question, lenses, lens);
    // A lens with no question (Compare) is a More item of its own; while it is the active pick no pill is lit, and the trigger names it.
    const lensOnly = lensOnlyOf(lenses, lens);
    const moreActive = lensOnly !== null || MORE_QUESTIONS.some((q) => q.id === question);
    const moreName = lensOnly !== null ? labels.lenses[lensOnly] : s.questions[question];
    const status = (id: QuestionId) => [...PRIMARY_QUESTIONS, ...MORE_QUESTIONS].find((q) => q.id === id)?.status(stations);
    const hint = (id: QuestionId, lensId: LensId | undefined) => [
        lensId && lenses?.some((l) => l.id === lensId) ? fillTemplate(s.overlay.lensSub, { lens: labels.lenses[lensId] }) : '',
        status(id) === 'not-set-up' ? s.answerNotSetUp : '',
    ].filter(Boolean).join(' · ') || undefined;
    const pick = (id: string) => {
        if (id.startsWith(LENS_PREFIX)) onLens?.(id.slice(LENS_PREFIX.length) as LensId);
        else onQuestion(id as QuestionId);
    };

    return (
        // One line, never wrapped (the scene sits below a measured controls block): the pills scroll sideways; the More menu
        // and the family chip stay put, so the menu's popover is not clipped by the scroller.
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, flexWrap: 'nowrap' }}>
            <div
                role="group" aria-label={s.questionsLabel}
                style={{ display: 'flex', gap: 6, minWidth: 0, flex: '0 1 auto', overflowX: 'auto', scrollSnapType: 'x proximity', scrollbarWidth: 'none' }}
            >
                {PRIMARY_QUESTIONS.map((q) => (
                    <Pill
                        key={q.id} data-question={q.id} on={lensOnly === null && q.id === question} title={hint(q.id, q.lens)}
                        style={{ scrollSnapAlign: 'start', ...(status(q.id) === 'not-set-up' ? { borderStyle: 'dashed' } : null) }}
                        onClick={() => onQuestion(q.id)}
                    >
                        {s.questions[q.id]}
                    </Pill>
                ))}
            </div>
            <Menu
                label={s.moreQuestions} active={moreActive} items={items} onSelect={pick} panelStyle={{ minWidth: 300, maxWidth: 'calc(100vw - 24px)' }}
                trigger={<>{moreActive ? moreName : s.moreQuestions}<span aria-hidden="true"> ▾</span></>}
            />
            {family && (
                <button
                    type="button" data-family-chip={family} aria-label={fillTemplate(s.overlay.clearFamily, { family })} title={fillTemplate(s.overlay.clearFamily, { family })}
                    style={pillStyle(true)} onClick={onClearFamily}
                >
                    {fillTemplate(s.overlay.familyOnly, { family })}<span aria-hidden="true"> ✕</span>
                </button>
            )}
        </div>
    );
}

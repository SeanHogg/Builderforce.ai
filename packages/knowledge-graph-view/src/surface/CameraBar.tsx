/**
 * The centre controls: the camera switcher (from the camera registry), the question chips
 * with a More menu for the rest, the answer line, and the lens row — the lenses stay (they
 * are the questions' ids and a host may ask for them as tabs), a compact scroller beneath.
 */

import { useState } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import type { LensDef } from '../lenses';
import { cssVar } from '../scene/themeColors';
import { chip, muted } from '../styles';
import type { LensId, ViewMode } from '../types';
import type { LensControl } from '../Toolbar';
import { MORE_QUESTIONS, PRIMARY_QUESTIONS, type QuestionDef, type QuestionId } from './questions';
import type { CameraDef } from './registry';
import type { Station } from './stations';

export interface CameraBarProps {
    labels: KnowledgeGraphLabels;
    cameras: readonly CameraDef[];
    mode: ViewMode;
    onMode(mode: ViewMode): void;
    stations: readonly Station[];
    question: QuestionId;
    onQuestion(id: QuestionId): void;
    /** How many stations answer the question; null = every station does. */
    litCount: number | null;
    lenses: LensDef[];
    lens: LensId;
    onLens(id: LensId): void;
    lensControl?: LensControl | undefined;
}

export function CameraBar({ labels, cameras, mode, onMode, stations, question, onQuestion, litCount, lenses, lens, onLens, lensControl = 'chips' }: CameraBarProps) {
    const s = labels.surface;
    const [more, setMore] = useState(false);
    const tabs = lensControl === 'tabs';
    const scroller = { display: 'flex', gap: 6, overflowX: 'auto', scrollSnapType: 'x proximity', paddingBottom: 2 } as const;
    const current = [...PRIMARY_QUESTIONS, ...MORE_QUESTIONS].find((q) => q.id === question);
    const missing = current?.status(stations) === 'not-set-up';
    const pick = (q: QuestionDef) => { setMore(false); onQuestion(q.id); };
    const moreActive = MORE_QUESTIONS.some((q) => q.id === question);

    const lensItems = lenses.map((l) => (
        <button
            key={l.id} type="button" role={tabs ? 'tab' : undefined} aria-selected={tabs ? l.id === lens : undefined}
            aria-pressed={tabs ? undefined : l.id === lens} title={labels.lensHints[l.id]} onClick={() => onLens(l.id)}
            style={{ ...chip(l.id === lens), scrollSnapAlign: 'start' }}
        >
            {labels.lenses[l.id]}
        </button>
    ));

    return (
        <div style={{ display: 'grid', gap: 6, padding: '8px 12px' }}>
            <div role="group" aria-label={labels.viewModesLabel} style={{ ...scroller, gap: 4 }}>
                {cameras.map((c) => (
                    <button key={c.id} type="button" aria-pressed={mode === c.id} style={chip(mode === c.id)} onClick={() => onMode(c.id)}>{labels[c.labelKey]}</button>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <div role="group" aria-label={s.questionsLabel} style={{ ...scroller, flex: 1, minWidth: 0 }}>
                    {PRIMARY_QUESTIONS.map((q) => (
                        <button key={q.id} type="button" data-question={q.id} aria-pressed={q.id === question} style={chip(q.id === question)} onClick={() => pick(q)}>
                            {s.questions[q.id]}
                        </button>
                    ))}
                </div>
                <div style={{ position: 'relative', flex: 'none' }} onKeyDown={(e) => { if (e.key === 'Escape' && more) { e.stopPropagation(); setMore(false); } }}>
                    <button type="button" aria-expanded={more} style={chip(moreActive)} onClick={() => setMore((v) => !v)}>
                        {moreActive ? s.questions[question] : s.moreQuestions}
                    </button>
                    {more && (
                        <div role="group" aria-label={s.moreQuestions} style={{ position: 'absolute', insetInlineEnd: 0, top: '100%', marginTop: 6, zIndex: 4, display: 'grid', gap: 2, padding: 6, minWidth: 240, background: cssVar('bg'), border: `1px solid ${cssVar('border')}`, borderRadius: 12 }}>
                            {MORE_QUESTIONS.map((q) => (
                                <button key={q.id} type="button" data-question={q.id} aria-pressed={q.id === question} style={{ ...chip(q.id === question), borderRadius: 8, justifyContent: 'flex-start', border: 'none' }} onClick={() => pick(q)}>
                                    {s.questions[q.id]}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <p aria-live="polite" data-testid="kg-answer" style={{ ...muted, margin: 0 }}>
                {missing ? s.answerNotSetUp : litCount === null ? '' : litCount === 0 ? s.answerNone : fillTemplate(s.answerCount, { count: litCount })}
            </p>
            {tabs
                ? <div role="tablist" aria-label={labels.lensesLabel} style={scroller}>{lensItems}</div>
                : <nav aria-label={labels.lensesLabel} style={scroller}>{lensItems}</nav>}
        </div>
    );
}

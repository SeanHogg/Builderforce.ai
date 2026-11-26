/**
 * The station card (the design's `#note`): the station that was clicked, in the ONE note-card shell docked at the stage's
 * top-left (`NoteCard`): its shape, name and kind, its facts (risk, tests, complexity, owner, anti-pattern), then its
 * actions and the answer to the question being asked. "Go inside" is disabled with its reason, never hidden; every other
 * action is offered only when it applies.
 */

import type { RefObject } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { kindLabel } from '../../names';
import { typeLegendKey, typeShape, type MarkType } from '../../shapes';
import { ShapeGlyph } from '../LegendGlyph';
import { TYPE } from '../ui/type';
import { CardAction, cardAction, CardFacts, SelectionActions } from './CardActions';
import type { CardModel } from './cardModel';
import { riskFactOf } from './noteFacts';
import { NoteCard, type NoteAnswer } from './NoteCard';

export { cardAction };

export interface CardActions {
    onEnter(): void;
    onUnfold(): void;
    onCallers(): void;
    onApi(): void;
    onPatterns(): void;
    /** Opens the docked code panel for this mark. Absent ⇒ no Code button. */
    onCode?(): void;
    /** Opens the path simulator through this station. Absent ⇒ no Simulate button. */
    onSimulate?(): void;
    /** Opens the anti-pattern's restructure compare; shown INSTEAD of Simulate when the station carries one. Absent ⇒ none. */
    onRestructure?(): void;
}

export interface StationCardProps extends CardActions {
    card: CardModel;
    labels: KnowledgeGraphLabels;
    /** The station's mark type: its glyph and its kind. */
    type: MarkType;
    /** The answer to the question being asked; absent ⇒ no answer row. */
    answer?: NoteAnswer | null | undefined;
    /** The stage box is narrow (≤ 900px). */
    narrow?: boolean | undefined;
    /** The card's element, for the host to find it. */
    boxRef?: RefObject<HTMLElement | null> | undefined;
    /** Definitions are being read: a station with no symbols yet says so rather than "none". */
    loading?: boolean | undefined;
}

export function StationCard({ card, labels, type, answer, narrow, boxRef, loading, onEnter, onUnfold, onCallers, onApi, onPatterns, onCode, onSimulate, onRestructure }: StationCardProps) {
    const t = labels.surface.map.card;
    const noSymbols = !card.enter.can && card.enter.reason === 'noSymbols';
    const complexity = card.stats.find((k) => k.key === 'complexity');
    return (
        <NoteCard
            role="station" ariaLabel={card.name} name={card.name} kind={kindLabel(labels, typeLegendKey(type))} narrow={narrow} boxRef={boxRef} answer={answer}
            glyph={<ShapeGlyph shape={typeShape(type)} size={14} />}
            meta={<span style={TYPE.meta}>{card.meta}{card.leaf ? ` · ${t.leaf}` : ''}</span>}
            facts={(
                <CardFacts
                    labels={labels} facts={card.facts ?? null} risk={riskFactOf(card.risk, labels)} owner={card.owner}
                    complexity={complexity && complexity.value !== '—' ? `${labels.surface.map.stats.complexity}: ${complexity.value}` : null}
                />
            )}
            acts={(
                <>
                    <CardAction id="enter" primary glyph="inside" label={t.goInside} disabled={!card.enter.can} title={card.enter.can ? undefined : noSymbols ? (loading ? t.loading : t.noSymbols) : t.leaf} onClick={onEnter} />
                    <SelectionActions labels={labels} facts={card.facts ?? null} onCallers={onCallers} onSimulate={onSimulate} onRestructure={onRestructure} restructureReady={card.restructureReady ?? true} />
                    {card.unfold > 0 && <CardAction id="unfold" pressed={card.unfolded} label={card.unfolded ? t.fold : fillTemplate(t.unfold, { count: card.unfold })} onClick={onUnfold} />}
                    {card.hasApi && <CardAction id="api" label={t.apiContract} onClick={onApi} />}
                    {card.hasPatterns && <CardAction id="patterns" label={t.patterns} onClick={onPatterns} />}
                    {onCode && <CardAction id="code" label={labels.surface.code.button} ariaLabel={fillTemplate(labels.surface.code.buttonAria, { name: card.name })} onClick={onCode} />}
                </>
            )}
        />
    );
}

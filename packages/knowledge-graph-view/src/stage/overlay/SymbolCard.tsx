/**
 * The symbol card: what a selected, read or pinned file or symbol mark is — its kind, name and lines, its counts, and
 * the ways in (drill in, zoom, show code, open the file). It rides the mark's SLOT with `useSlotAnchor` (as `StageCard`
 * does) and hides while the slot is off the stage. Station cards keep their own card; the open code level has the step card.
 */

import { useRef } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { kindLabel } from '../../names';
import { typeLegendKey, type MarkType } from '../../shapes';
import { selectionFacts } from '../../surface/transit/cardModel';
import { CardAction, cardActionRow, CardFacts, SelectionActions } from '../../surface/transit/CardActions';
import type { SymbolFacts } from '../../surface/symbolFacts';
import { TYPE } from '../../surface/ui/type';
import type { SourceLocation, SymbolRecord } from '../../types';
import { useSlotAnchor } from '../anchor/useSlotAnchor';
import { codeTargetOf, symbolCounts } from '../drill/codeText';
import { card, chip, chips, kicker } from './cardStyles';

export type SymbolCardState = 'selected' | 'reading' | 'pinned';

const STATE_LABEL: Readonly<Record<SymbolCardState, 'stateSelected' | 'stateReading' | 'statePinned'>> = {
    selected: 'stateSelected', reading: 'stateReading', pinned: 'statePinned',
};

export interface SymbolCardProps {
    /** The mark's slot key (`node:<ref>`); null = no card. */
    slotKey: string | null;
    /** The symbol's ref. */
    symbolRef: string;
    /** The symbol's name, for a mark with no loaded record. */
    name: string;
    state: SymbolCardState;
    records: readonly SymbolRecord[];
    markType: MarkType;
    labels: KnowledgeGraphLabels;
    onDrill(): void;
    onCode(): void;
    onZoomIn(): void;
    onZoomOut(): void;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
    /** The graph's facts, computed once by the wiring; absent ⇒ no facts row, no Restructure. */
    facts?: SymbolFacts | undefined;
    /** Each is optional: absent ⇒ its button is not shown. Restructure replaces Simulate when the symbol carries an anti-pattern. */
    onCallers?: (() => void) | undefined;
    onSimulate?: (() => void) | undefined;
    onRestructure?: (() => void) | undefined;
    /** False while the restructure's file is being read: Restructure shows disabled. Default true. */
    restructureReady?: boolean | undefined;
}

export function SymbolCard({ slotKey, symbolRef, name, state, records, markType, labels, onDrill, onCode, onZoomIn, onZoomOut, onOpenSource, facts: symbolFacts, onCallers, onSimulate, onRestructure, restructureReady }: SymbolCardProps) {
    const el = useRef<HTMLElement | null>(null);
    const { missing } = useSlotAnchor(slotKey, el);
    if (!slotKey) return null;
    const t = labels.surface.code;
    const target = codeTargetOf(symbolRef, records);
    const counts = symbolCounts(symbolRef, records);
    const facts: [string, string][] = [];
    if (counts.methods > 0) facts.push(['methods', fillTemplate(t.methodsCount, { count: counts.methods })]);
    if (counts.fields > 0) facts.push(['fields', fillTemplate(t.fieldsCount, { count: counts.fields })]);
    if (counts.calls > 0) facts.push(['calls', fillTemplate(t.callsCount, { count: counts.calls })]);
    if (counts.callers > 0) facts.push(['callers', fillTemplate(t.callers, { count: counts.callers })]);
    if (markType === 'external') facts.push(['imported', t.imported]);
    const shown = target?.name ?? name;
    const selection = selectionFacts(symbolFacts, [symbolRef], labels);
    return (
        <section
            ref={el} data-symbol-card data-state={state} hidden={missing} aria-label={shown}
            style={{ ...card('left'), top: 0, left: 0, zIndex: 2 }}
        >
            <div style={kicker}><span>{kindLabel(labels, typeLegendKey(markType))}</span><em>{t[STATE_LABEL[state]]}</em></div>
            <b style={TYPE.monoTitle}>{shown}</b>
            {target && <span style={TYPE.monoMeta}>{`${target.path}:${target.startLine}–${target.endLine}`}</span>}
            {facts.length > 0 && (
                <div style={chips}>{facts.map(([id, text]) => <span key={id} data-chip={id} style={chip}>{text}</span>)}</div>
            )}
            <CardFacts labels={labels} facts={selection} />
            <div style={cardActionRow}>
                {counts.calls > 0 && <CardAction id="drill-in" primary glyph="inside" label={t.drillInAction} onClick={onDrill} />}
                <SelectionActions labels={labels} facts={selection} onCallers={onCallers} onSimulate={onSimulate} onRestructure={onRestructure} restructureReady={restructureReady} />
                <CardAction id="zoom-in" label={labels.zoomIn} onClick={onZoomIn} />
                <CardAction id="show-code" label={t.showCode} onClick={onCode} />
                {target && onOpenSource && (
                    <CardAction id="open-file" label={t.openFile} onClick={() => onOpenSource({ path: target.path, startLine: target.startLine, endLine: target.startLine })} />
                )}
                <CardAction id="zoom-out" glyph="out" label={labels.zoomOut} onClick={onZoomOut} />
            </div>
        </section>
    );
}

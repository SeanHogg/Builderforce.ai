/**
 * The symbol card: what a selected, read or pinned file or symbol mark is, in the ONE note-card shell (`NoteCard`) docked
 * at the stage's top-left: its shape, name and kind, its facts, and the ways in (drill in, callers, simulate / restructure,
 * show code, open the file). Station cards keep their own card; the open code level has the step card.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { kindLabel } from '../../names';
import { typeLegendKey, typeShape, type MarkType } from '../../shapes';
import { ShapeGlyph } from '../../surface/LegendGlyph';
import { selectionFacts } from '../../surface/transit/cardModel';
import { CardAction, CardFacts, SelectionActions } from '../../surface/transit/CardActions';
import { riskFactOf } from '../../surface/transit/noteFacts';
import { NoteCard, type NoteAnswer } from '../../surface/transit/NoteCard';
import type { SymbolFacts } from '../../surface/symbolFacts';
import { TYPE } from '../../surface/ui/type';
import type { SourceLocation, SymbolRecord } from '../../types';
import { codeTargetOf, symbolCounts } from '../drill/codeText';
import { chip, chips } from './cardStyles';

export type SymbolCardState = 'selected' | 'reading' | 'pinned';

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
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
    /** The graph's facts, computed once by the wiring; absent ⇒ no facts row, no Restructure. */
    facts?: SymbolFacts | undefined;
    /** Each is optional: absent ⇒ its button is not shown. Restructure replaces Simulate when the symbol carries an anti-pattern. */
    onCallers?: (() => void) | undefined;
    onSimulate?: (() => void) | undefined;
    onRestructure?: (() => void) | undefined;
    /** False while the restructure's file is being read: Restructure shows disabled. Default true. */
    restructureReady?: boolean | undefined;
    /** The answer to the question being asked. */
    answer?: NoteAnswer | null | undefined;
    narrow?: boolean | undefined;
}

export function SymbolCard({ slotKey, symbolRef, name, state, records, markType, labels, onDrill, onCode, onOpenSource, facts: symbolFacts, onCallers, onSimulate, onRestructure, restructureReady, answer, narrow }: SymbolCardProps) {
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
        <NoteCard
            role="symbol" ariaLabel={shown} name={shown} kind={kindLabel(labels, typeLegendKey(markType))} narrow={narrow} answer={answer}
            glyph={<ShapeGlyph shape={typeShape(markType)} size={14} />}
            meta={(
                <span data-state={state} style={{ display: 'grid', gap: 4 }}>
                    {target && <span style={TYPE.monoMeta}>{`${target.path}:${target.startLine}–${target.endLine}`}</span>}
                    {facts.length > 0 && <span style={chips}>{facts.map(([id, text]) => <span key={id} data-chip={id} style={chip}>{text}</span>)}</span>}
                </span>
            )}
            facts={<CardFacts labels={labels} facts={selection} risk={riskFactOf(selection?.antiPattern ? { word: 'high', tone: 'sev4' } : null, labels)} />}
            acts={(
                <>
                    <CardAction id="drill-in" primary glyph="inside" label={t.drillInAction} disabled={counts.calls === 0} onClick={onDrill} />
                    <SelectionActions labels={labels} facts={selection} onCallers={onCallers} onSimulate={onSimulate} onRestructure={onRestructure} restructureReady={restructureReady} />
                    <CardAction id="show-code" label={t.showCode} onClick={onCode} />
                    {target && onOpenSource && (
                        <CardAction id="open-file" label={t.openFile} onClick={() => onOpenSource({ path: target.path, startLine: target.startLine, endLine: target.startLine })} />
                    )}
                </>
            )}
        />
    );
}

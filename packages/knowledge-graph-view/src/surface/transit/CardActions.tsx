/**
 * The selection card's shared parts, one primitive for the station card and the symbol card: an action button (glyph +
 * short label), the actions every selection offers (Callers, then Simulate or, with an anti-pattern, Restructure), and
 * the facts row (risk, test reach, anti-pattern name). An action whose callback is absent is not rendered: the
 * component decides its own visibility, the caller passes no booleans. Colours are `--kg-*` only; the rows wrap.
 */

import type { CSSProperties, ReactNode, Ref } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { CONTROL } from '../../styles';
import { actionGlyph, type ActionGlyphName } from '../ui/glyphs';
import { TYPE } from '../ui/type';
import type { SelectionFacts } from './cardModel';

/** The look of a card action button. */
export const cardAction: CSSProperties = {
    minHeight: CONTROL, padding: '0 10px', borderRadius: 7, cursor: 'pointer', font: 'inherit', ...TYPE.pill,
    display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%',
    border: `1px solid ${cssVar('border')}`, background: 'transparent', color: cssVar('text'),
};
const primaryAction: CSSProperties = { ...cardAction, background: cssVar('accent'), borderColor: cssVar('accent'), color: cssVar('onAccent') };

/** A card's row of actions: wraps, so a 360px card never overflows. */
export const cardActionRow: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 0 };

export interface CardActionProps {
    /** The `data-action` id. */
    id: string;
    label: string;
    glyph?: ActionGlyphName | undefined;
    /** Overrides the accessible name when the visible label is shorter than what the button does. */
    ariaLabel?: string | undefined;
    title?: string | undefined;
    primary?: boolean | undefined;
    disabled?: boolean | undefined;
    pressed?: boolean | undefined;
    buttonRef?: Ref<HTMLButtonElement> | undefined;
    onClick(): void;
}

export function CardAction({ id, label, glyph, ariaLabel, title, primary, disabled, pressed, buttonRef, onClick }: CardActionProps) {
    return (
        <button
            ref={buttonRef} type="button" data-action={id} disabled={disabled} aria-pressed={pressed} aria-label={ariaLabel} title={title}
            style={{ ...(primary ? primaryAction : cardAction), opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
            onClick={onClick}
        >
            {glyph && actionGlyph(glyph)}
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{label}</span>
        </button>
    );
}

export interface SelectionActionsProps {
    labels: KnowledgeGraphLabels;
    facts: SelectionFacts | null;
    onCallers?: (() => void) | undefined;
    onSimulate?: (() => void) | undefined;
    onRestructure?: (() => void) | undefined;
    /** False while the file's definitions are being read: Restructure shows disabled, with the loading tooltip. Default true. */
    restructureReady?: boolean | undefined;
}

/**
 * Callers, then Restructure in place of Simulate when the selection carries a RESTRUCTURABLE anti-pattern and the host
 * handles it; otherwise Simulate (an anti-pattern with no proposer, or no handler, falls back to it).
 */
export function SelectionActions({ labels, facts, onCallers, onSimulate, onRestructure, restructureReady = true }: SelectionActionsProps) {
    const t = labels.surface.map.card;
    const anti = facts?.antiPattern ?? null;
    const restructure = anti && anti.restructurable && onRestructure ? { anti, run: onRestructure } : null;
    return (
        <>
            {onCallers && <CardAction id="callers" glyph="callers" label={t.callers} ariaLabel={t.whoCalls} onClick={onCallers} />}
            {restructure
                ? <CardAction id="restructure" glyph="restructure" label={t.restructure} disabled={!restructureReady} title={restructureReady ? fillTemplate(t.restructureTip, { name: restructure.anti.name }) : t.loading} onClick={restructure.run} />
                : onSimulate && <CardAction id="simulate" glyph="simulate" label={t.simulate} title={t.simulateTip} onClick={onSimulate} />}
        </>
    );
}

const fact: CSSProperties = { ...TYPE.meta, display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, overflowWrap: 'anywhere' };

/** One fact of the row: an optional glyph or swatch, then its text, in an optional tone. */
function Fact({ id, tone, lead, children }: { id: string; tone?: ThemeTone | null; lead?: ReactNode; children: ReactNode }) {
    return <span data-fact={id} style={{ ...fact, color: tone ? cssVar(tone) : fact.color }}>{lead}{children}</span>;
}

/** The facts row: risk (a swatch and its word), test reach, and the anti-pattern's name. Nothing known ⇒ nothing drawn. */
export function CardFacts({ labels, facts, risk }: { labels: KnowledgeGraphLabels; facts: SelectionFacts | null; risk?: { value: string; tone: ThemeTone | null } | undefined }) {
    const t = labels.surface.map.card;
    if (!facts && !risk) return null;
    return (
        <div data-card-facts style={{ display: 'flex', gap: '2px 10px', flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}>
            {risk && (
                <Fact id="risk" tone={risk.tone} lead={<i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: risk.tone ? cssVar(risk.tone) : cssVar('border') }} />}>
                    {`${t.risk}: ${risk.value}`}
                </Fact>
            )}
            {facts?.tests && (
                facts.tests === 'none'
                    ? <Fact id="tests" tone="violation" lead={actionGlyph('testMissing')}>{t.testNone}</Fact>
                    : <Fact id="tests">{t.testReached}</Fact>
            )}
            {facts?.antiPattern && <Fact id="anti" tone="violation" lead={actionGlyph('warning')}>{facts.antiPattern.name}</Fact>}
        </div>
    );
}

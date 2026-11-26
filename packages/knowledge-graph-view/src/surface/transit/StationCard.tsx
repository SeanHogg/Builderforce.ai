/**
 * The station card (mockup 172-188): the stats, issues and actions of the station that was
 * clicked. A 270px popover beside the station; in a compact container the same body is the
 * view's bottom `Sheet`. It takes focus when it opens, closes on Escape and on a click outside
 * (focus returns to the station), and offers an action only when it applies; "Go inside" is
 * disabled with its reason, never hidden.
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { Sheet } from '../../Sheet';
import { cssVar } from '../../scene/themeColors';
import { actionGlyph } from '../ui/glyphs';
import { TYPE } from '../ui/type';
import { CARD_WIDTH } from './cardPlacement';
import { CardAction, cardAction, cardActionRow, CardFacts, SelectionActions } from './CardActions';
import type { CardModel } from './cardModel';

export { cardAction };

export interface CardActions {
    onClose(): void;
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
    compact: boolean;
    /** The popover's place inside the map's box (ignored in a sheet). */
    at: { left: number; top: number };
    /** The popover's element, for the map to measure its real size. */
    boxRef?: RefObject<HTMLDivElement | null> | undefined;
    /** Definitions are being read: a station with no symbols yet says so rather than "none". */
    loading?: boolean | undefined;
}

function CardBody({ card, labels, loading, onEnter, onUnfold, onCallers, onApi, onPatterns, onCode, onSimulate, onRestructure, first }: StationCardProps & { first: RefObject<HTMLButtonElement | null> }) {
    const t = labels.surface.map.card;
    const noSymbols = !card.enter.can && card.enter.reason === 'noSymbols';
    return (
        <div style={{ display: 'grid', gap: 8 }}>
            <span style={TYPE.meta}>{card.meta}{card.leaf ? ` · ${t.leaf}` : ''}</span>
            <CardFacts labels={labels} facts={card.facts ?? null} risk={card.stats.find((k) => k.key === 'issues')} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4 }}>
                {card.stats.map((k) => (
                    <span key={k.key} data-stat={k.key} title={k.title} style={{ display: 'flex', flexDirection: 'column', padding: '4px 6px', borderRadius: 6, background: cssVar('panel2'), minWidth: 0 }}>
                        <b style={{ ...TYPE.status, color: k.tone ? cssVar(k.tone) : cssVar('text'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.value}</b>
                        <span style={TYPE.caption}>{k.label}</span>
                    </span>
                ))}
            </div>
            {card.issues.length > 0 && (
                <ul data-card-issues style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 2 }}>
                    {card.issues.map((issue, i) => <li key={i} style={{ ...TYPE.status, color: cssVar('violation') }}>{issue}</li>)}
                    {card.issueMore > 0 && <li style={TYPE.meta}>{fillTemplate(t.issueMore, { count: card.issueMore })}</li>}
                </ul>
            )}
            <div style={cardActionRow}>
                <CardAction id="enter" primary glyph="inside" label={t.goInside} disabled={!card.enter.can} buttonRef={first} onClick={onEnter} />
                <SelectionActions labels={labels} facts={card.facts ?? null} onCallers={onCallers} onSimulate={onSimulate} onRestructure={onRestructure} />
                {card.unfold > 0 && <CardAction id="unfold" pressed={card.unfolded} label={card.unfolded ? t.fold : fillTemplate(t.unfold, { count: card.unfold })} onClick={onUnfold} />}
                {card.hasApi && <CardAction id="api" label={t.apiContract} onClick={onApi} />}
                {card.hasPatterns && <CardAction id="patterns" label={t.patterns} onClick={onPatterns} />}
                {onCode && <CardAction id="code" label={labels.surface.code.button} ariaLabel={fillTemplate(labels.surface.code.buttonAria, { name: card.name })} onClick={onCode} />}
            </div>
            {noSymbols && <span data-card-reason role="status" style={TYPE.meta}>{loading ? t.loading : t.noSymbols}</span>}
        </div>
    );
}

export function StationCard(props: StationCardProps) {
    const { card, labels, compact, at } = props;
    const own = useRef<HTMLDivElement>(null);
    const ref = props.boxRef ?? own;
    const first = useRef<HTMLButtonElement>(null);
    // One close per card, however it is asked for (Escape reaches both the sheet and the document in a compact view).
    const closed = useRef(false);
    const onClose = props.onClose;
    const close = useCallback(() => { if (closed.current) return; closed.current = true; onClose(); }, [onClose]);

    // Focus moves into the card (without scrolling the map); Escape and a press outside close it.
    useEffect(() => {
        const target = first.current && !first.current.disabled ? first.current : ref.current;
        target?.focus({ preventScroll: true });
        const key = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            // This Escape belongs to the card: nothing registered after it (a drawer, the unfold) hears it too.
            e.stopImmediatePropagation();
            close();
        };
        const press = (e: PointerEvent) => {
            const target = e.target as Element | null;
            if (!target || ref.current?.contains(target) || target.closest('[data-card-sheet]')) return;
            close();
        };
        document.addEventListener('keydown', key);
        document.addEventListener('pointerdown', press);
        return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', press); };
    }, [close, ref]);

    const body = <CardBody {...props} first={first} />;
    if (compact) {
        return (
            <div data-card-sheet ref={ref} tabIndex={-1}>
                <Sheet open compact title={card.name} closeLabel={labels.surface.map.card.close} onClose={close}>{body}</Sheet>
            </div>
        );
    }
    return (
        <div
            ref={ref} role="dialog" aria-label={card.name} data-station-card tabIndex={-1}
            style={{
                position: 'absolute', zIndex: 3, left: at.left, top: at.top, width: CARD_WIDTH, maxWidth: '100%', boxSizing: 'border-box', padding: 12,
                display: 'grid', gap: 8, borderRadius: 12, background: cssVar('bg'), color: cssVar('text'), border: `1px solid ${cssVar('border')}`,
                boxShadow: '0 8px 28px color-mix(in srgb, currentColor 18%, transparent)',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <b style={{ ...TYPE.monoTitle, overflowWrap: 'anywhere' }}>{card.name}</b>
                <button type="button" aria-label={labels.surface.map.card.close} onClick={close} style={{ ...cardAction, border: 0, minHeight: 24, minWidth: 24, padding: 0, justifyContent: 'center', color: cssVar('muted') }}>{actionGlyph('close')}</button>
            </div>
            {body}
        </div>
    );
}

/**
 * The station card (mockup 172-188): the stats, issues and actions of the station that was
 * clicked. A 270px popover beside the station; in a compact container the same body is the
 * view's bottom `Sheet`. It takes focus when it opens, closes on Escape and on a click outside
 * (focus returns to the station), and offers an action only when it applies; "Go inside" is
 * disabled with its reason, never hidden.
 */

import { useCallback, useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { Sheet } from '../../Sheet';
import { cssVar } from '../../scene/themeColors';
import { CONTROL } from '../../styles';
import { TYPE } from '../ui/type';
import { CARD_WIDTH } from './cardPlacement';
import type { CardModel } from './cardModel';

export interface CardActions {
    onClose(): void;
    onEnter(): void;
    onUnfold(): void;
    onCallers(): void;
    onApi(): void;
    onPatterns(): void;
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

const action: CSSProperties = {
    minHeight: CONTROL, padding: '0 10px', borderRadius: 7, cursor: 'pointer', font: 'inherit', ...TYPE.pill,
    border: `1px solid ${cssVar('border')}`, background: 'transparent', color: cssVar('text'),
};
const primary: CSSProperties = { ...action, background: cssVar('accent'), borderColor: cssVar('accent'), color: cssVar('onAccent') };

function CardBody({ card, labels, loading, onEnter, onUnfold, onCallers, onApi, onPatterns, first }: StationCardProps & { first: RefObject<HTMLButtonElement | null> }) {
    const t = labels.surface.map.card;
    const noSymbols = !card.enter.can && card.enter.reason === 'noSymbols';
    return (
        <div style={{ display: 'grid', gap: 8 }}>
            <span style={TYPE.meta}>{card.meta}{card.leaf ? ` · ${t.leaf}` : ''}</span>
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
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button ref={first} type="button" data-action="enter" disabled={!card.enter.can} style={{ ...primary, opacity: card.enter.can ? 1 : 0.5, cursor: card.enter.can ? 'pointer' : 'not-allowed' }} onClick={onEnter}>{t.goInside}</button>
                {card.unfold > 0 && <button type="button" data-action="unfold" aria-pressed={card.unfolded} style={action} onClick={onUnfold}>{card.unfolded ? t.fold : fillTemplate(t.unfold, { count: card.unfold })}</button>}
                <button type="button" data-action="callers" style={action} onClick={onCallers}>{t.whoCalls}</button>
                {card.hasApi && <button type="button" data-action="api" style={action} onClick={onApi}>{t.apiContract}</button>}
                {card.hasPatterns && <button type="button" data-action="patterns" style={action} onClick={onPatterns}>{t.patterns}</button>}
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
                <button type="button" aria-label={labels.surface.map.card.close} onClick={close} style={{ ...action, border: 0, minHeight: 24, minWidth: 24, padding: 0, color: cssVar('muted') }}><span aria-hidden="true">×</span></button>
            </div>
            {body}
        </div>
    );
}

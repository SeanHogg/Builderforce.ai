/**
 * The status strip above the header row (36px, one line, never wraps): the sync pill, the
 * server-parity line and the commit scrubber on the left; the overflow menu on the right.
 *
 * The sync pill is also the review's face. While a review is planning, awaiting confirm,
 * running or finished it opens the ReviewProgress card; otherwise it opens the Sync drawer. The
 * card opens by itself when a plan awaits confirmation, a review failed or one finished. Focus
 * moves into it only for confirm and error (they need an answer); a finished review is announced
 * through a live region instead, so focus is never stolen. Esc and a press outside close the card.
 *
 * Narrow (phone) containers keep only the dot, "Risk ▾" and ⋯ on the strip line, and the commit
 * scrubber becomes a second, horizontally scrolling line (parity stays hidden). The strip never
 * clips a popover or a focus ring: only the left cluster scrolls, and it carries padding for the ring.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { MONO, muted } from '../styles';
import type { ReviewState } from '../useReviewRun';
import type { SyncPill } from './syncPill';
import { StatusDot } from './ui';

export interface StatusStripProps {
    labels: KnowledgeGraphLabels;
    narrow: boolean;
    pill: SyncPill;
    /** "{n} files here and on the server"; null = the host reports none. */
    parity: string | null;
    reviewStatus: ReviewState['status'];
    /** The ReviewProgress card, shown from the pill. */
    reviewCard: ReactNode;
    /** Opens the Sync drawer (absent ⇒ the pill is a plain status). */
    onSync?: (() => void) | undefined;
    /** The commit scrubber. */
    time?: ReactNode;
    /** The overlay menu, which lives in the strip on a narrow container. */
    overlays?: ReactNode;
    /** The ⋯ menu. */
    overflow?: ReactNode;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
/** Room inside the scrolling cluster for a 2px focus ring, taken back by the negative margin. */
const RING = 3;

export function StatusStrip({ labels, narrow, pill, parity, reviewStatus, reviewCard, onSync, time, overlays, overflow }: StatusStripProps) {
    const [cardOpen, setCardOpen] = useState(false);
    const [focusCard, setFocusCard] = useState(false);
    const cardId = useId();
    const root = useRef<HTMLDivElement>(null);
    const card = useRef<HTMLDivElement>(null);
    const hasCard = reviewStatus !== 'idle';
    // What needs the person (a plan to confirm, a failure) opens by itself and takes focus; a finished review opens
    // without it (announced below); the card closes when the review is dismissed.
    useEffect(() => {
        if (reviewStatus === 'confirm' || reviewStatus === 'error') { setCardOpen(true); setFocusCard(true); }
        if (reviewStatus === 'done') setCardOpen(true);
        if (reviewStatus === 'idle') setCardOpen(false);
    }, [reviewStatus]);
    useEffect(() => {
        if (!cardOpen || !focusCard) return;
        (card.current?.querySelector<HTMLElement>(FOCUSABLE) ?? card.current)?.focus();
        setFocusCard(false);
    }, [cardOpen, focusCard]);
    useEffect(() => {
        if (!cardOpen) return undefined;
        const outside = (e: Event) => { if (root.current && !root.current.contains(e.target as Node)) setCardOpen(false); };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [cardOpen]);

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Escape' || !cardOpen) return;
        e.stopPropagation();
        setCardOpen(false);
        root.current?.querySelector<HTMLElement>('[data-state]')?.focus();
    };
    const onPill = hasCard ? () => { setFocusCard(false); setCardOpen((v) => !v); } : onSync;
    const gutter = narrow ? 12 : 16;
    const states = labels.surface.pillStates;

    return (
        <div
            ref={root} role="group" aria-label={labels.surface.header.statusLabel} data-testid="kg-status-strip" onKeyDown={onKeyDown}
            style={{ position: 'relative', flex: 'none', boxSizing: 'border-box', borderBottom: `1px solid ${cssVar('border')}`, background: cssVar('panel'), ...muted }}
        >
            <div style={{ height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, boxSizing: 'border-box', padding: `0 ${gutter}px` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: '1 1 auto', overflow: 'hidden', padding: RING, margin: -RING }}>
                    <StatusDot
                        state={pill.state} label={pill.text} stateLabel={states[pill.state]}
                        {...(onPill ? { onClick: onPill } : {})} {...(hasCard ? { expanded: cardOpen, controls: cardId } : {})}
                    />
                    {!narrow && parity && <span data-testid="kg-parity" style={{ fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '0 1 auto' }}>{parity}</span>}
                    {!narrow && time}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
                    {narrow && overlays}
                    {overflow}
                </div>
            </div>
            {narrow && time && (
                <div data-testid="kg-scrubber-line" style={{ overflowX: 'auto', padding: `0 ${gutter}px 6px` }}>{time}</div>
            )}
            {/* A finished review is announced here (not by stealing focus); the text differs from the card's title so neither reads as a duplicate. */}
            <span aria-live="polite" data-testid="kg-review-live" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
                {reviewStatus === 'done' ? `${labels.reviewDoneTitle} · ${pill.text}` : ''}
            </span>
            {hasCard && cardOpen && (
                <div
                    ref={card} id={cardId} data-testid="kg-review-card" tabIndex={-1}
                    style={{ position: 'absolute', top: '100%', insetInlineStart: gutter, marginTop: 6, zIndex: 5, width: 'min(420px, 92vw)', background: cssVar('bg'), borderRadius: 10, boxShadow: '0 8px 28px color-mix(in srgb, currentColor 18%, transparent)' }}
                >
                    {reviewCard}
                </div>
            )}
        </div>
    );
}

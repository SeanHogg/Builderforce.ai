/**
 * The status strip above the header row (36px, one line, never wraps): the sync pill, the
 * server-parity line and the commit scrubber on the left; the overflow menu on the right.
 *
 * The sync pill is also the review's face. While a review is planning, awaiting confirm,
 * running or finished it opens the ReviewProgress card (it opens by itself when a plan awaits
 * confirmation, a review failed or one finished, so the confirm step is never hidden); otherwise
 * it opens the Sync drawer.
 *
 * Narrow (phone) containers keep only the dot, "Risk ▾" and ⋯. The strip never clips a popover:
 * only its left cluster has `overflow: hidden`.
 */

import { useEffect, useState, type ReactNode } from 'react';
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

export function StatusStrip({ labels, narrow, pill, parity, reviewStatus, reviewCard, onSync, time, overlays, overflow }: StatusStripProps) {
    const [cardOpen, setCardOpen] = useState(false);
    const hasCard = reviewStatus !== 'idle';
    // What needs the person (a plan to confirm, a failure, the result with its Continue) opens by itself; the card closes when the review is dismissed.
    useEffect(() => {
        if (reviewStatus === 'confirm' || reviewStatus === 'error' || reviewStatus === 'done') setCardOpen(true);
        if (reviewStatus === 'idle') setCardOpen(false);
    }, [reviewStatus]);

    const onPill = hasCard ? () => setCardOpen((v) => !v) : onSync;
    return (
        <div
            role="group" aria-label={labels.surface.header.statusLabel} data-testid="kg-status-strip"
            style={{
                position: 'relative', height: 36, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, boxSizing: 'border-box',
                padding: `0 ${narrow ? 12 : 16}px`, borderBottom: `1px solid ${cssVar('border')}`, background: cssVar('panel'), ...muted,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }}>
                <StatusDot state={pill.state} label={pill.text} {...(onPill ? { onClick: onPill } : {})} />
                {!narrow && parity && <span data-testid="kg-parity" style={{ fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '0 1 auto' }}>{parity}</span>}
                {!narrow && time}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
                {narrow && overlays}
                {overflow}
            </div>
            {hasCard && cardOpen && (
                <div
                    data-testid="kg-review-card"
                    style={{ position: 'absolute', top: '100%', insetInlineStart: narrow ? 12 : 16, marginTop: 6, zIndex: 5, width: 'min(420px, 92vw)', background: cssVar('bg'), borderRadius: 10, boxShadow: '0 8px 28px color-mix(in srgb, currentColor 18%, transparent)' }}
                >
                    {reviewCard}
                </div>
            )}
        </div>
    );
}

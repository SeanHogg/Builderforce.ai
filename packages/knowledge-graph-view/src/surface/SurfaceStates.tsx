/**
 * The surface's frame and the screens shown before there is a graph to draw: loading, the
 * empty folder (with the review launcher), a failed read and a review whose graph is gone.
 */

import type { ReactNode, Ref } from 'react';
import type { KnowledgeGraphLabels } from '../labels';
import { ReviewLauncher } from '../ReviewLauncher';
import { cssVar } from '../scene/themeColors';
import { button, heading, muted } from '../styles';
import type { KnowledgeGraphSource } from '../types';
import type { GraphStatus } from '../useKnowledgeGraph';
import type { ReviewState } from '../useReviewRun';

export function SurfaceFrame({ ref, label, children }: { ref: Ref<HTMLElement>; label: string; children: ReactNode }) {
    return (
        <section
            ref={ref}
            aria-label={label}
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: cssVar('bg'), color: cssVar('text'), fontSize: 13 }}
        >
            {children}
        </section>
    );
}

export interface SurfaceStateProps {
    status: GraphStatus;
    labels: KnowledgeGraphLabels;
    source: KnowledgeGraphSource;
    /** The review progress card, shown under the empty and failed screens. */
    review: ReactNode;
    reviewStatus: ReviewState['status'];
    start: Parameters<typeof ReviewLauncher>[0]['start'];
    openReview?: boolean | undefined;
    onRetry(): void;
}

/** The screen for a status that has no graph yet, or null when there is one to draw. */
export function SurfaceState({ status, labels, source, review, reviewStatus, start, openReview, onRetry }: SurfaceStateProps): ReactNode {
    if (status === 'error') {
        return (
            <div role="alert" style={{ padding: 24, display: 'grid', gap: 10, justifyItems: 'start' }}>
                <h2 style={heading}>{labels.errorTitle}</h2>
                <p style={{ ...muted, margin: 0 }}>{labels.errorBody}</p>
                <button type="button" style={button} onClick={onRetry}>{labels.retry}</button>
            </div>
        );
    }
    if (status === 'load-failed') {
        // A scope exists but its graph is gone/unreadable — this is NOT the "never reviewed" empty state.
        return (
            <div role="alert" style={{ padding: 24, display: 'grid', gap: 12, justifyItems: 'start', maxWidth: 560 }}>
                <h2 style={heading}>{labels.loadFailedTitle}</h2>
                <p style={{ ...muted, margin: 0 }}>{labels.loadFailedBody}</p>
                <button type="button" style={button} onClick={onRetry}>{labels.retry}</button>
                {review}
            </div>
        );
    }
    const empty = status === 'empty';
    return (
        <div style={{ padding: 24, display: 'grid', gap: 12, justifyItems: 'start', maxWidth: 560 }}>
            {empty ? (
                <>
                    <h2 style={heading}>{labels.emptyTitle}</h2>
                    <p style={{ ...muted, margin: 0, fontSize: 13 }}>{labels.emptyBody}</p>
                    <ReviewLauncher source={source} labels={labels} start={start} defaultOpen={!!openReview} status={reviewStatus} />
                </>
            ) : <p role="status" style={muted}>{labels.loading}</p>}
            {review}
        </div>
    );
}

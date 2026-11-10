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
import { TYPE, TYPE_VARS } from './ui/type';
import type { ReviewState } from '../useReviewRun';
import { LoadingStatus, type LoadingProgress } from './LoadingStatus';

export function SurfaceFrame({ ref, label, children }: { ref: Ref<HTMLElement>; label: string; children: ReactNode }) {
    return (
        <section
            ref={ref}
            aria-label={label}
            style={{ ...TYPE_VARS, ...TYPE.body, position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: cssVar('bg'), color: cssVar('text') }}
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
    /** The host's review places, read once by the root. */
    targets: Parameters<typeof ReviewLauncher>[0]['targets'];
    openReview?: boolean | undefined;
    /** "Use the server's copy": a local review that reads the project's extracted output first. Absent ⇒ not offered (not linked, or offline). */
    onSeed?: (() => void) | undefined;
    /** While loading: the host's phase and the diagnostics a slow load offers to copy. */
    loading?: LoadingProgress | undefined;
    onRetry(): void;
}

/** The screen for a status that has no graph yet, or null when there is one to draw. */
export function SurfaceState({ status, labels, source, review, reviewStatus, start, targets, openReview, onSeed, loading, onRetry }: SurfaceStateProps): ReactNode {
    if (status === 'not-here') {
        // This machine holds no review of the root: never the server's cut, never a fault — Review, or the server's copy.
        return (
            <div style={{ padding: 24, display: 'grid', gap: 12, justifyItems: 'start', maxWidth: 560 }}>
                <h2 style={heading}>{labels.notHereTitle}</h2>
                <p style={{ ...muted, margin: 0, fontSize: TYPE.bodyLarge.fontSize }}>{onSeed ? labels.notHereBody : labels.notHereBodyLocal}</p>
                {onSeed && <button type="button" style={button} onClick={onSeed} disabled={reviewStatus === 'planning' || reviewStatus === 'running'}>{labels.useServerCopy}</button>}
                <ReviewLauncher source={source} labels={labels} targets={targets} start={start} defaultOpen status={reviewStatus} />
                {review}
            </div>
        );
    }
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
                    <p style={{ ...muted, margin: 0, fontSize: TYPE.bodyLarge.fontSize }}>{labels.emptyBody}</p>
                    <ReviewLauncher source={source} labels={labels} targets={targets} start={start} defaultOpen={!!openReview} status={reviewStatus} />
                </>
            ) : <LoadingStatus labels={labels} progress={loading} />}
            {review}
        </div>
    );
}

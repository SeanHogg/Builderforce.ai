/** How a review ended other than stopped: the finished summary (with Continue when sections are unjudged, and the files it did not store) or the failure (reason and Copy details). */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { ReviewFailed } from '../../ReviewFailed';
import { SkippedUploads } from '../../SkippedList';
import { button, card, heading, muted, primaryButton, quietButton } from '../../styles';
import type { ReviewRun } from '../../useReviewRun';
import { counted } from '../plural';

export interface ReviewDoneProps {
    labels: KnowledgeGraphLabels;
    state: Extract<ReviewRun['state'], { status: 'done' | 'error' }>;
    onContinue(rootId: string): void;
    onDismiss(): void;
}

export function ReviewDone({ labels, state, onContinue, onDismiss }: ReviewDoneProps) {
    const dismiss = <button type="button" style={quietButton} onClick={onDismiss}>{labels.close}</button>;
    if (state.status === 'error') {
        return <section data-testid="kg-review-failed" aria-live="polite" style={card}><ReviewFailed key={state.at} error={state} labels={labels} dismiss={dismiss} /></section>;
    }
    const r = state.report;
    return (
        <section data-testid="kg-review-done" aria-live="polite" style={{ ...card, display: 'grid', gap: 10 }}>
            <h3 style={heading}>{labels.reviewDoneTitle}</h3>
            <p style={{ margin: 0, fontSize: 13 }}>{fillTemplate(labels.reviewDoneBody, { extracted: r.extracted, judged: r.judged, facts: r.factsWritten })}</p>
            {r.unjudged > 0 && <p style={{ ...muted, margin: 0 }}>{counted(labels, 'sectionUnjudged', r.unjudged)}</p>}
            {state.skipped && <SkippedUploads items={state.skipped} labels={labels} />}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {r.unjudged > 0 && <button type="button" style={primaryButton} onClick={() => onContinue(state.rootId)}>{labels.reviewContinue}</button>}
                <button type="button" style={button} onClick={onDismiss}>{labels.close}</button>
            </div>
        </section>
    );
}

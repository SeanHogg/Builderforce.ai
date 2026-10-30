/**
 * A failed review: the sentence, the reason under it, and *Copy details* — the diagnostics
 * block (`reviewDiagnostics.ts`) a person can paste into a report. When the clipboard
 * refuses, the same text is shown to select by hand.
 */

import type { ReactNode } from 'react';
import { CopiedNote, CopyFallback, useCopyText } from './copyText';
import { fillTemplate, type KnowledgeGraphLabels } from './labels';
import { reviewDiagnosticsText } from './reviewDiagnostics';
import { button, muted } from './styles';
import type { ReviewErrorState } from './useReviewRun';

export interface ReviewFailedProps {
    error: ReviewErrorState;
    labels: KnowledgeGraphLabels;
    dismiss: ReactNode;
}

export function ReviewFailed({ error, labels, dismiss }: ReviewFailedProps) {
    const copier = useCopyText();
    const text = reviewDiagnosticsText(error);
    return (
        <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <p style={{ margin: 0, fontSize: 13, flex: 1, minWidth: 0 }}>{labels.reviewFailed}</p>
                {dismiss}
            </div>
            {error.message && (
                <p style={{ ...muted, margin: 0, overflowWrap: 'anywhere' }}>{fillTemplate(labels.reviewFailedReason, { message: error.message })}</p>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" style={button} onClick={() => void copier.copy(text)}>{labels.reviewCopyDetails}</button>
                <CopiedNote status={copier.status} labels={labels} />
            </div>
            <CopyFallback status={copier.status} text={text} label={labels.reviewCopyDetails} labels={labels} />
        </div>
    );
}

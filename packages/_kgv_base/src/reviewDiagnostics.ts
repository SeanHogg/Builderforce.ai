/**
 * A failed review as plain text for a bug report — what *Copy details* puts on the
 * clipboard. English on purpose: it is read by whoever triages the report, not by the
 * person who copied it. Only what is known is listed.
 */

import type { ReviewErrorState } from './useReviewRun';

export function reviewDiagnosticsText(s: ReviewErrorState): string {
    const lines = [
        'Knowledge review failed',
        `status: ${s.status}`,
        ...(s.rootId ? [`root: ${s.rootId}`] : []),
        ...(s.rootPath ? [`path: ${s.rootPath}`] : []),
        ...(s.lastPhase ? [`phase: ${s.lastPhase}`] : []),
        `message: ${s.message}`,
        ...(s.host ? [`host: ${s.host}`] : []),
        `time: ${s.at}`,
        ...(s.detail ? ['', 'detail:', s.detail] : []),
    ];
    return lines.join('\n');
}

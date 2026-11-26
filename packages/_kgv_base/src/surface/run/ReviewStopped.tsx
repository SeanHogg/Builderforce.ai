/**
 * A review the person stopped: where it stopped, what it kept and what is left, and Details (that run, in the Runs tab). Resume is the pinned footer's button
 * (a plan that is confirmed as soon as it lands: the files already read are not read again). All numbers are the run record's.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { button, card } from '../../styles';
import type { StoredReviewRun } from '../../types';
import { counted } from '../plural';
import { TYPE } from '../ui/type';
import { etaMs, extractProgress, paceOf } from './runPace';
import { rateText, runDurationMs, spanText, whenText } from './runModel';

export interface ReviewStoppedProps {
    labels: KnowledgeGraphLabels;
    /** The stopped run's record; null when the host kept none. */
    run: StoredReviewRun | null;
    onDetails(runId: string): void;
}

/** The files a stopped run left and the time they take at its own pace; undefined when the record has no extract phase. */
export function stoppedLeft(run: StoredReviewRun | null): { files: number; etaMs: number | undefined } | undefined {
    const read = run ? extractProgress(run) : undefined;
    if (!run || !read) return undefined;
    const files = Math.max(0, read.total - read.done);
    return { files, etaMs: etaMs(files, paceOf(run)?.rate) };
}

export function ReviewStopped({ labels, run, onDetails }: ReviewStoppedProps) {
    const r = labels.surface.run.review;
    const read = run ? extractProgress(run) : undefined;
    if (!run || !read) {
        return <section data-testid="kg-review-stopped" style={card}><p style={{ ...TYPE.subtitle, margin: 0 }}>{labels.reviewAborted}</p></section>;
    }
    const left = stoppedLeft(run)!;
    const pace = paceOf(run);
    return (
        <section data-testid="kg-review-stopped" style={{ ...card, display: 'grid', gap: 8 }}>
            <strong style={TYPE.subtitle}>{fillTemplate(r.stoppedTitle, { pct: read.pct })}</strong>
            <span style={TYPE.meta}>{fillTemplate(r.stoppedMeta, { time: whenText(run.endedAt ?? run.updatedAt), duration: spanText(labels, runDurationMs(run)) })}</span>
            <p style={{ ...TYPE.body, margin: 0 }}>{fillTemplate(r.stoppedBody, { files: counted(labels, 'file', read.done), left: counted(labels, 'file', left.files) })}</p>
            {left.files > 0 && pace && left.etaMs !== undefined && left.etaMs > 0 && (
                <span style={TYPE.meta}>{fillTemplate(r.stoppedPace, { eta: spanText(labels, left.etaMs), rate: rateText(pace.rate) })}</span>
            )}
            <div><button type="button" style={button} onClick={() => onDetails(run.id)}>{r.detailsButton}</button></div>
        </section>
    );
}

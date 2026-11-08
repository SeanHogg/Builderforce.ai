/**
 * The Reviews panel's header block (the host's panel draws the root's name and the close ×): a 44px ring that shows the live run's percent while one
 * runs and is a dot in the status colour otherwise, and ONE status line - when it was reviewed and whether that is out of date, how the running review is
 * doing, or where the stopped one stopped.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import type { StoredReviewRun } from '../../types';
import { STATUS_TONE } from '../ui/statusTone';
import { TYPE } from '../ui/type';
import { kindKey, runDurationMs, spanText, whenText } from './runModel';
import { extractProgress } from './runPace';
import { relativeTime, reviewDate, type SyncPill } from '../syncPill';

export interface ReviewsPanelHeaderProps {
    labels: KnowledgeGraphLabels;
    pill: SyncPill;
    /** The root's live run record. */
    run: StoredReviewRun | null;
    lastReviewedAt?: string | undefined;
}

const SIZE = 44;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The one line under the ring. */
export function statusLine(labels: KnowledgeGraphLabels, pill: SyncPill, run: StoredReviewRun | null, lastReviewedAt: string | undefined): string {
    const r = labels.surface.run.review;
    const read = run ? extractProgress(run) : undefined;
    if (pill.kind === 'counting') return r.chipCountingPlain;
    if ((pill.kind === 'running' || pill.kind === 'stopping') && run) {
        const head = fillTemplate(r.headRunning, { kind: labels.surface.run.kinds[kindKey(run.kind)], time: whenText(run.startedAt), elapsed: spanText(labels, runDurationMs(run)) });
        return read?.etaMs !== undefined && read.etaMs > 0 ? `${head} · ${fillTemplate(labels.surface.run.eta, { time: spanText(labels, read.etaMs) })}` : head;
    }
    if (pill.kind === 'stopped' && run && read) return fillTemplate(r.headStopped, { pct: read.pct, time: whenText(run.endedAt ?? run.updatedAt) });
    const date = lastReviewedAt ? reviewDate(lastReviewedAt) : '';
    if (!date) return r.headNever;
    const args = { date, age: relativeTime(lastReviewedAt!) };
    return pill.kind === 'outOfDate' || pill.kind === 'notStored' ? fillTemplate(r.headOutOfDate, args) : fillTemplate(r.headReviewed, args);
}

export function ReviewsPanelHeader({ labels, pill, run, lastReviewedAt }: ReviewsPanelHeaderProps) {
    const live = pill.frac !== undefined;
    const tone = cssVar(STATUS_TONE[pill.state]);
    return (
        <header data-testid="kg-reviews-header" data-state={pill.state} style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
            <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={pill.text} style={{ flex: 'none' }}>
                {live ? (
                    <>
                        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={cssVar('plane')} strokeWidth={STROKE} />
                        <circle
                            data-testid="kg-reviews-ring" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={cssVar('accent')} strokeWidth={STROKE} strokeLinecap="round"
                            strokeDasharray={`${CIRCUMFERENCE * Math.min(1, pill.frac!)} ${CIRCUMFERENCE}`} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                        />
                        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill={cssVar('text')} style={{ ...TYPE.status }}>{Math.round(Math.min(1, pill.frac!) * 100)}%</text>
                    </>
                ) : <circle data-testid="kg-reviews-dot" cx={SIZE / 2} cy={SIZE / 2} r={8} fill={tone} />}
            </svg>
            <p data-testid="kg-reviews-status" style={{ ...TYPE.bodyLarge, margin: 0, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{statusLine(labels, pill, run, lastReviewedAt)}</p>
        </header>
    );
}

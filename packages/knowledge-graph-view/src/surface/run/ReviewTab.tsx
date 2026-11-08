/** The Reviews panel's Review tab: by the review's state - nothing planned, counting, the plan, running, stopping, stopped, finished or failed. The pinned footer owns the one action. */

import type { KnowledgeGraphLabels } from '../../labels';
import type { StoredReviewRun } from '../../types';
import type { ReviewRun } from '../../useReviewRun';
import type { PaceRun } from './runPace';
import { ReviewDone } from './ReviewDone';
import { ReviewNow } from './ReviewNow';
import { ReviewIdle, ReviewPlanning, ReviewStart } from './ReviewStart';
import { ReviewStopped } from './ReviewStopped';
import { ReviewStopping } from './ReviewStopping';

export interface ReviewTabProps {
    labels: KnowledgeGraphLabels;
    review: ReviewRun;
    /** The root's live run record. */
    live: StoredReviewRun | null;
    /** A review the host runs on its own is watched here, though the view's state machine is idle. */
    hostRunning: boolean;
    /** When Stop was pressed on a review the host runs on its own (epoch ms). */
    hostStoppingSince?: number | undefined;
    history: readonly (PaceRun & { id: string })[];
    /** Changes queued to upload now. */
    queued?: number | undefined;
    root: string;
    /** Opens a run's detail (the Runs tab): a stopped run's Details, the running run's failures and slowest files. */
    onDetails(runId: string): void;
    onOpenRun(runId: string): void;
}

export function ReviewTab({ labels, review, live, hostRunning, hostStoppingSince, history, queued, root, onDetails, onOpenRun }: ReviewTabProps) {
    const state = review.state;
    if (hostRunning && live) {
        return hostStoppingSince !== undefined
            ? <ReviewStopping labels={labels} since={hostStoppingSince} />
            : <ReviewNow labels={labels} run={live} onOpenRun={onOpenRun} />;
    }
    switch (state.status) {
        case 'idle': case 'cancelled': return <ReviewIdle labels={labels} cancelled={state.status === 'cancelled'} />;
        case 'planning': return <ReviewPlanning labels={labels} root={root} count={state.progress?.done} />;
        case 'confirm': return <ReviewStart labels={labels} review={review} state={state} history={history} queued={queued} />;
        case 'running': return <ReviewNow labels={labels} run={live} progress={state.progress} judgeFiles={review.judgeFiles} onOpenRun={onOpenRun} />;
        case 'stopping': return <ReviewStopping labels={labels} progress={state.progress} since={state.stoppedAt} />;
        case 'aborted': return <ReviewStopped labels={labels} run={live?.endedAt !== undefined ? live : null} onDetails={onDetails} />;
        case 'done': case 'error': return <ReviewDone labels={labels} state={state} onContinue={(id) => review.start({ rootId: id })} onDismiss={review.dismiss} />;
    }
}

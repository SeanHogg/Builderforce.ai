/** The Reviews panel's Runs tab: the pace of each run (files per second), then the root's past runs; a row opens that run's detail, here, with Back. */

import type { KnowledgeGraphLabels } from '../../labels';
import type { KnowledgeGraphSource, ReplicaState } from '../../types';
import type { ReviewRun } from '../../useReviewRun';
import { reviewBusy } from '../../ReviewLauncher';
import { RunDetail } from './RunDetail';
import { RunHistory } from './RunHistory';
import { RunPaceBars } from './RunPaceBars';
import type { RunRecordRead } from './useReviewRunRecord';

export interface RunsTabProps {
    labels: KnowledgeGraphLabels;
    source: KnowledgeGraphSource | undefined;
    read: RunRecordRead;
    review: ReviewRun;
    diagnosticsText?: (() => string) | undefined;
    replica?: ReplicaState | undefined;
}

export function RunsTab({ labels, source, read, review, diagnosticsText, replica }: RunsTabProps) {
    const history = read.history.runs;
    const shown = read.opened;
    if (shown) {
        // Retry only the latest run's failures, once it has ended, while no review is going.
        const canRetry = history[0]?.id === shown.id && shown.endedAt !== undefined && !reviewBusy(review.state.status) && !!source?.review;
        const retry = (paths: string[]) => review.start({ rootId: shown.root, retry: paths, ...(shown.kind === 'seed' ? { seed: true } : {}) });
        return <RunDetail labels={labels} run={shown} history={history} onBack={read.close} onRetry={source?.review ? retry : undefined} canRetry={canRetry} diagnosticsText={diagnosticsText} replica={replica} />;
    }
    return (
        <div data-testid="kg-runs-tab" style={{ display: 'grid', gap: 16 }}>
            <RunPaceBars history={history} labels={labels} title={labels.surface.run.review.paceTabTitle} />
            <RunHistory history={read.history} labels={labels} shownId={read.live?.id} onOpen={read.open} openFailed={read.openFailed} />
        </div>
    );
}

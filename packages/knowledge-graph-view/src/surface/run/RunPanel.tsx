/**
 * The Run drawer (PRD 41 A8): a review as a run you can watch. The latest run's phase timeline, one
 * live lane per worker, the step feed, the failures with Retry, the replica row and Stop; below them
 * the root's past runs. Opening a past run shows it, frozen, in this same panel.
 *
 * The data is the root's (`useReviewRunRecord`, read once and handed down); this drawer fetches nothing.
 * Retry is a normal review request (the host owes the failed files a review again, then the usual plan and
 * confirm), so it is offered only on the root's latest run, once it has ended, and never while a review is going.
 */

import { fillTemplate } from '../../labels';
import { reviewBusy } from '../../ReviewLauncher';
import { button } from '../../styles';
import type { PanelProps } from '../registry';
import { SyncReplica } from '../drawers/SyncReplica';
import { Section } from '../drawers/ui';
import { TYPE } from '../ui/type';
import { RunFailures } from './RunFailures';
import { RunHistory } from './RunHistory';
import { RunLanes } from './RunLanes';
import { RunSteps } from './RunSteps';
import { RunTimeline } from './RunTimeline';
import { kindKey, outcomeKey, runDurationMs, spanText, whenText } from './runModel';

export function RunPanel({ labels, source, runs, sync }: PanelProps) {
    const t = labels.surface.run;
    const port = source?.runs;
    if (!port || !runs) return null;
    const { read, review } = runs;
    const frozen = read.opened !== null;
    const status = review.state.status;
    const shown = read.opened ?? read.live;
    const running = !!shown && !frozen && shown.endedAt === undefined;
    // A run that ended says where the queue stood then; one underway shows the queue now.
    const replica = shown ? (running ? sync?.replica : shown.replica) : undefined;
    // Retry only the latest run's failures, once it has ended, while no review is going.
    const latest = !frozen || read.history.runs[0]?.id === shown?.id;
    const canRetry = !!shown && latest && shown.endedAt !== undefined && !reviewBusy(status) && !!source?.review;

    const stop = () => {
        // The view's own review stops through its state machine; a run the host reports on its own by its id.
        if (status === 'running' || status === 'planning') review.stop();
        else if (shown) void port.stop(shown.id).catch(() => undefined);
    };
    const retry = (paths: string[]) => {
        if (!shown) return;
        review.start({ rootId: shown.root, retry: paths, ...(shown.kind === 'seed' ? { seed: true } : {}) });
    };

    return (
        <div data-testid="kg-run" style={{ display: 'grid', gap: 16 }}>
            {shown && (
                <>
                    <Section title={fillTemplate(t.headline, { kind: t.kinds[kindKey(shown.kind)], outcome: t.outcomes[outcomeKey(shown)] })}>
                        <p style={{ ...TYPE.bodyMuted, margin: 0 }}>
                            {fillTemplate(t.startedAt, { time: whenText(shown.startedAt) })}{' · '}{fillTemplate(t.duration, { time: spanText(labels, runDurationMs(shown)) })}
                        </p>
                        {shown.poolDown && <p role="status" data-testid="kg-run-pool-down" style={{ ...TYPE.meta, margin: 0 }}>{fillTemplate(t.poolDown, { reason: shown.poolDown })}</p>}
                        {frozen && (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={TYPE.meta}>{fillTemplate(t.frozenNote, { started: whenText(shown.startedAt) })}</span>
                                <button type="button" style={button} onClick={read.close}>{t.backToLive}</button>
                            </div>
                        )}
                        {running && <div><button type="button" style={button} onClick={stop}>{labels.reviewStop}</button></div>}
                    </Section>
                    <RunTimeline run={shown} labels={labels} />
                    <RunLanes run={shown} labels={labels} />
                    <RunSteps key={shown.id} run={shown} labels={labels} />
                    <RunFailures run={shown} labels={labels} onRetry={source?.review ? retry : undefined} canRetry={canRetry} />
                    {replica && <SyncReplica replica={replica} labels={labels} />}
                </>
            )}
            <RunHistory history={read.history} labels={labels} shownId={shown?.id} onOpen={read.open} openFailed={read.openFailed} />
        </div>
    );
}

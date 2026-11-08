/**
 * The Reviews panel (PRD 41 A8): the ONE place a review is started, watched, stopped and looked back on. A header (the live percent as a ring, one status line),
 * four tabs - Review, Runs, Server, Diagnostics - a body that scrolls on its own, and a footer OUTSIDE that scroller with the one action for the state. It composes;
 * each tab is its own file. The panel is a flex column that fills its host panel's body (`fill`), so the footer stays put at 360px as it does wide.
 *
 * Opening the panel with nothing planned counts the files at once (free and local), so the plan is ready when it is read. Closing it while a plan awaits an
 * answer cancels it (`useReviewsPanel` does that), and nothing is written. Closing it never stops a review that is running.
 */

import { useEffect, useId, useState } from 'react';
import { cssVar } from '../../scene/themeColors';
import type { ReviewRequest } from '../../types';
import type { PanelProps } from '../registry';
import { syncGap } from '../drawers/syncModel';
import { syncPill } from '../syncPill';
import { DiagnosticsTab } from './DiagnosticsTab';
import { ReviewsPanelFooter } from './ReviewsPanelFooter';
import { ReviewsPanelHeader } from './ReviewsPanelHeader';
import { ReviewsTabs, tabId } from './ReviewsTabs';
import { ReviewTab } from './ReviewTab';
import { stoppedLeft } from './ReviewStopped';
import { RunsTab } from './RunsTab';
import { ServerTab } from './ServerTab';
import type { RunPanelData } from './useReviewRunRecord';
import type { ReviewsTab } from './useReviewsTab';

export function RunPanel(props: PanelProps) {
    return props.runs ? <ReviewsPanelBody {...props} runs={props.runs} /> : null;
}

function ReviewsPanelBody({ labels, source, runs, reviews, sync, history, rootId, rootTitle, diagnostics, lastReviewedAt, revision, onCompose, onResendSkipped, surface }: PanelProps & { runs: RunPanelData }) {
    const { read, review } = runs;
    const state = review.state;
    const live = read.live;
    const port = source?.runs;
    const panelId = useId();
    const [localTab, setLocalTab] = useState<ReviewsTab>('review');
    // A host that cannot review (it only keeps a baseline) has nothing to start: its panel opens on the Server tab, where the revision is.
    const asked = reviews?.tab ?? localTab;
    const tab: ReviewsTab = !review.available && asked === 'review' ? 'server' : asked;
    const setTab = reviews?.setTab ?? setLocalTab;

    // ONE source of "running": the chip's own reading (this view's review, or the run record of a review the host runs on its own).
    const pill = syncPill({ labels, review: state, stale: false, refreshFailed: false, sync: sync ?? null, lastReviewedAt, run: live });
    const hostRunning = pill.kind === 'running' && state.status !== 'running';
    // Stop on a review the view does not own: remembered here, until the run record ends.
    const [hostStop, setHostStop] = useState<{ runId: string; at: number } | null>(null);
    const hostStoppingSince = hostStop && live && live.id === hostStop.runId && live.endedAt === undefined ? hostStop.at : undefined;
    const stoppingSince = state.status === 'stopping' ? state.stoppedAt : hostStoppingSince;
    const running = state.status === 'running' || hostRunning;

    const canStart = review.available && !!rootId;
    // Opening with nothing planned counts the files now. Once, on open: later states are the person's to move.
    useEffect(() => {
        if (canStart && !hostRunning && (state.status === 'idle' || state.status === 'cancelled')) review.start({ rootId: rootId! });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const request: ReviewRequest = rootId ? { rootId } : { pick: true };
    const stopHostRun = () => { if (live && port) { setHostStop({ runId: live.id, at: Date.now() }); void port.stop(live.id).catch(() => undefined); } };
    // Force stop: this view's review is let go at once (its state becomes stopped); a host-run one can only be asked again.
    const forceStop = () => { if (state.status === 'stopping') review.forceStop(); if (live && port) void port.stop(live.id).catch(() => undefined); };
    const left = state.status === 'aborted' && live?.endedAt !== undefined ? stoppedLeft(live) : undefined;
    const notStored = syncGap(sync).missing;

    return (
        <div data-testid="kg-run" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: cssVar('text') }}>
            <div style={{ flex: 'none', display: 'grid', gap: 12, padding: '16px 16px 0' }}>
                <ReviewsPanelHeader labels={labels} pill={pill} run={live} lastReviewedAt={lastReviewedAt} />
                <ReviewsTabs
                    labels={labels} tab={tab} onTab={setTab} panelId={panelId}
                    badges={{ runs: { count: read.history.runs.length }, server: { count: notStored, tone: 'cycle' } }}
                />
            </div>
            <div role="tabpanel" id={panelId} aria-labelledby={tabId(panelId, tab)} data-testid="kg-reviews-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'grid', gap: 16, alignContent: 'start' }}>
                {tab === 'review' && (
                    <ReviewTab
                        labels={labels} review={review} live={live} hostRunning={hostRunning} hostStoppingSince={hostStoppingSince} history={read.history.runs} queued={sync?.replica?.dirty}
                        root={rootTitle ?? rootId ?? ''} onDetails={(id) => { setTab('runs'); read.open(id); }} onOpenRun={(id) => { setTab('runs'); read.open(id); }}
                    />
                )}
                {tab === 'runs' && <RunsTab labels={labels} source={source} read={read} review={review} onDiagnose={() => setTab('diagnostics')} replica={sync?.replica} />}
                {tab === 'server' && <ServerTab
                        labels={labels} sync={sync} revision={revision} onDiagnose={() => setTab('diagnostics')}
                        more={{ source, history, lastReviewedAt, onCompose, onResend: onResendSkipped, onOpenPanel: (id) => surface.openPanel(id) }}
                    />}
                {tab === 'diagnostics' && <DiagnosticsTab labels={labels} diagnostics={diagnostics} />}
            </div>
            {review.available && (
                <ReviewsPanelFooter
                    labels={labels} state={state} running={running} stoppingSince={stoppingSince} left={left}
                    onCountAndStart={() => review.start(request, { autoConfirm: true })} onStart={() => review.answer(true)}
                    onStop={() => (hostRunning ? stopHostRun() : review.stop())} onForceStop={forceStop}
                    onResume={() => review.start(request, { autoConfirm: true })} onAgain={() => review.start(request)}
                />
            )}
        </div>
    );
}

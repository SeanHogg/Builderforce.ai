/**
 * The Agent runs drawer (PRD 46 §3.5): the host's recorded agent runs, and for the one selected its turn strip, its
 * findings and the files it touched. Reads only `source.agentRuns`; the registry hides the drawer without it.
 *
 * Each run row carries two actions beside its select button (AgentRunList): *Fix* hands the run's report to a new
 * chat through the host's `onCompose` (the `compose` op: a fresh Brain chat with the prompt pre-filled), and *Review*
 * focuses the run's files and evidence on the graph via the drawer's own `onShow` — the same focus API RunFiles uses —
 * while selecting the run so its detail is shown alongside. Both actions re-read the report through the port; a read
 * that fails or answers null is spent quietly, exactly like a report that arrives after another run was selected.
 */

import type { PanelProps } from '../../registry';
import { QuietButton } from '../../ui';
import { TYPE } from '../../ui/type';
import { Section } from '../ui';
import { AgentRunList } from './AgentRunList';
import { runFixPrompt, runFocusRefs } from './agentRunsModel';
import { RunFiles } from './RunFiles';
import { RunFindingList } from './RunFindingList';
import { TurnStrip } from './TurnStrip';
import { useAgentRuns } from './useAgentRuns';

export function AgentRunsPanel({ graph, source, labels, onShow, onCompose }: PanelProps) {
    const t = labels.surface.agentRuns;
    const port = source?.agentRuns;
    const { list, selected, detail, select, retry } = useAgentRuns(port, graph.scope.rootId);
    const note = (text: string, testId: string) => <p data-testid={testId} role="status" style={{ ...TYPE.bodyMuted, margin: 0 }}>{text}</p>;

    /** Re-reads one run's report; null when it could not be read (the action is spent quietly). */
    const reportOf = (id: string) => {
        try { return port?.report(id, graph.scope.rootId).catch(() => null) ?? null; } catch { return null; }
    };
    const fix = (id: string) => {
        if (!port || !onCompose) return;
        void reportOf(id)?.then((report) => { if (report) onCompose(runFixPrompt(report, t)); });
    };
    const review = (id: string) => {
        void reportOf(id)?.then((report) => {
            if (!report) return;
            select(id);
            const refs = runFocusRefs(graph, report);
            if (refs.length > 0) onShow(refs);
        });
    };

    if (list.state === 'loading') return note(t.loading, 'kg-agent-runs-loading');
    if (list.state === 'failed') {
        return (
            <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
                {note(t.failed, 'kg-agent-runs-failed')}
                <QuietButton data-testid="kg-agent-runs-retry" onClick={retry}>{labels.retry}</QuietButton>
            </div>
        );
    }
    if (list.runs.length === 0) return note(t.emptyRuns, 'kg-agent-runs-empty');

    return (
        <div data-testid="kg-agent-runs" style={{ display: 'grid', gap: 16, minWidth: 0 }}>
            <Section title={t.runsTitle}>
                <AgentRunList
                    runs={list.runs} selected={selected} labels={labels}
                    canFix={!!onCompose} onSelect={select} onFix={fix} onReview={review}
                />
            </Section>
            {detail.state === 'loading' && note(t.reportLoading, 'kg-agent-run-loading')}
            {detail.state === 'missing' && note(t.reportMissing, 'kg-agent-run-missing')}
            {detail.state === 'ready' && (
                <>
                    <Section title={t.stripTitle}><TurnStrip turns={detail.report.turns} labels={labels} /></Section>
                    <Section title={t.findingsTitle}><RunFindingList findings={detail.report.findings} labels={labels} /></Section>
                    <Section title={t.filesTitle}><RunFiles files={detail.report.files} root={detail.report.root} graph={graph} labels={labels} onShow={onShow} /></Section>
                </>
            )}
        </div>
    );
}

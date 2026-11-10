/**
 * The Agent runs drawer (PRD 46 §3.5): the host's recorded agent runs, and for the one selected its turn strip, its
 * findings and the files it touched. Reads only `source.agentRuns`; the registry hides the drawer without it.
 */

import type { PanelProps } from '../../registry';
import { TYPE } from '../../ui/type';
import { Section } from '../ui';
import { AgentRunList } from './AgentRunList';
import { RunFiles } from './RunFiles';
import { RunFindingList } from './RunFindingList';
import { TurnStrip } from './TurnStrip';
import { useAgentRuns } from './useAgentRuns';

export function AgentRunsPanel({ graph, source, labels, onShow }: PanelProps) {
    const t = labels.surface.agentRuns;
    const { list, selected, detail, select } = useAgentRuns(source?.agentRuns, graph.scope.rootId);
    const note = (text: string, testId: string) => <p data-testid={testId} role="status" style={{ ...TYPE.bodyMuted, margin: 0 }}>{text}</p>;

    if (list.state === 'loading') return note(t.loading, 'kg-agent-runs-loading');
    if (list.state === 'failed') return note(t.failed, 'kg-agent-runs-failed');
    if (list.runs.length === 0) return note(t.emptyRuns, 'kg-agent-runs-empty');

    return (
        <div data-testid="kg-agent-runs" style={{ display: 'grid', gap: 16, minWidth: 0 }}>
            <Section title={t.runsTitle}>
                <AgentRunList runs={list.runs} selected={selected} labels={labels} onSelect={select} />
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

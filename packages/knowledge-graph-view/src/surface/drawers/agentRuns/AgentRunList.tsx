/** The recorded agent runs, newest first: one button per run with its title, its turns and models, and its finding counts in words. */

import type { KnowledgeGraphLabels } from '../../../labels';
import { cssVar } from '../../../scene/themeColors';
import { CONTROL, list } from '../../../styles';
import type { AgentRunSummary } from '../../../types';
import { TYPE } from '../../ui/type';
import { runCounts, runMeta } from './agentRunsModel';

export interface AgentRunListProps {
    runs: readonly AgentRunSummary[];
    selected: string | null;
    labels: KnowledgeGraphLabels;
    onSelect(id: string): void;
}

export function AgentRunList({ runs, selected, labels, onSelect }: AgentRunListProps) {
    const t = labels.surface.agentRuns;
    return (
        <ul data-testid="kg-agent-run-list" style={{ ...list, gap: 6 }}>
            {runs.map((run) => {
                const on = run.id === selected;
                const worst = run.counts.error > 0 ? 'sev5' : run.counts.warn > 0 ? 'sev3' : 'muted';
                return (
                    <li key={run.id}>
                        <button
                            type="button" aria-pressed={on} data-run={run.id} onClick={() => onSelect(run.id)}
                            style={{
                                display: 'grid', gap: 2, width: '100%', minHeight: CONTROL, padding: '8px 12px', textAlign: 'left', cursor: 'pointer',
                                borderRadius: 8, font: 'inherit', color: cssVar('text'),
                                border: `1px solid ${on ? cssVar('accent') : cssVar('border')}`, background: on ? cssVar('accentSoft') : cssVar('panel'),
                            }}
                        >
                            <span style={{ ...TYPE.subtitle, overflowWrap: 'anywhere' }}>{run.title}</span>
                            <span style={{ ...TYPE.meta, overflowWrap: 'anywhere' }}>{runMeta(run, t)}</span>
                            <span style={{ ...TYPE.status, color: cssVar(worst) }}>{runCounts(run, t)}</span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

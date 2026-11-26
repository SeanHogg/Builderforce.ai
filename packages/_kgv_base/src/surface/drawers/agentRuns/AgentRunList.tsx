/**
 * The recorded agent runs, newest first: one row per run — its select button (title, turns and models, finding counts)
 * with the two actions beside it: *Fix* (hands the run's findings to a new chat, when the host can) and *Review*
 * (focuses the run's files on the graph). The action row is a SIBLING of the select button: buttons never nest.
 */

import type { KnowledgeGraphLabels } from '../../../labels';
import { cssVar } from '../../../scene/themeColors';
import { CONTROL, list, quietButton } from '../../../styles';
import type { AgentRunSummary } from '../../../types';
import { TYPE } from '../../ui/type';
import { runCounts, runMeta } from './agentRunsModel';

export interface AgentRunListProps {
    runs: readonly AgentRunSummary[];
    selected: string | null;
    labels: KnowledgeGraphLabels;
    /** The host takes a composed prompt into a new chat (the `compose` op); absent ⇒ Fix is disabled. */
    canFix: boolean;
    onSelect(id: string): void;
    onFix(id: string): void;
    onReview(id: string): void;
}

export function AgentRunList({ runs, selected, labels, canFix, onSelect, onFix, onReview }: AgentRunListProps) {
    const t = labels.surface.agentRuns;
    return (
        <ul data-testid="kg-agent-run-list" style={{ ...list, gap: 6 }}>
            {runs.map((run) => {
                const on = run.id === selected;
                const worst = run.counts.error > 0 ? 'sev5' : run.counts.warn > 0 ? 'sev3' : 'muted';
                return (
                    <li key={run.id} data-run-row={run.id} style={{ display: 'grid', gap: 4, minWidth: 0 }}>
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
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingInline: 4 }}>
                            <button
                                type="button" style={quietButton} data-run-fix disabled={!canFix}
                                title={canFix ? undefined : labels.surface.agentRuns.actionsFix}
                                aria-label={t.actionsFixAria} onClick={() => onFix(run.id)}
                            >
                                {t.actionsFix}
                            </button>
                            <button
                                type="button" style={quietButton} data-run-review
                                aria-label={t.actionsReviewAria} onClick={() => onReview(run.id)}
                            >
                                {t.actionsReview}
                            </button>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

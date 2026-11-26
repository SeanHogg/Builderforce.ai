/**
 * A run's findings, worst first: the severity in words (coloured by its tone, never colour alone), the localized title
 * and description of the finding's kind with its params filled in, and its evidence rows (turn, tool, path, excerpt).
 */

import type { KnowledgeGraphLabels } from '../../../labels';
import { cssVar } from '../../../scene/themeColors';
import { card, list } from '../../../styles';
import type { AgentRunFinding } from '../../../types';
import { TYPE } from '../../ui/type';
import { StateLabel } from '../ui';
import { evidenceNoteText, evidenceText, findingText, SEVERITY_TONE, sortFindings } from './agentRunsModel';

export function RunFindingList({ findings, labels }: { findings: readonly AgentRunFinding[]; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.agentRuns;
    if (findings.length === 0) return <p data-testid="kg-agent-run-no-findings" style={{ ...TYPE.bodyMuted, margin: 0 }}>{t.emptyFindings}</p>;
    return (
        <ul data-testid="kg-agent-run-findings" style={list}>
            {sortFindings(findings).map((f) => {
                const text = findingText(f, t);
                return (
                    <li key={f.id} data-kind={f.kind} data-severity={f.severity} style={{ ...card, display: 'grid', gap: 6, minWidth: 0, borderLeft: `3px solid ${cssVar(SEVERITY_TONE[f.severity])}` }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 8px' }}>
                            <StateLabel tone={SEVERITY_TONE[f.severity]}>{t.severity[f.severity]}</StateLabel>
                            <strong style={{ ...TYPE.subtitle, overflowWrap: 'anywhere' }}>{text.title}</strong>
                        </div>
                        {text.description && <p style={{ ...TYPE.body, margin: 0, overflowWrap: 'anywhere' }}>{text.description}</p>}
                        {f.evidence.length > 0 && (
                            <ul style={{ ...list, gap: 4 }}>
                                {f.evidence.map((e, i) => {
                                    const note = evidenceNoteText(e, t);
                                    return (
                                    <li key={`${e.step}:${i}`} style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                                        <span style={{ ...TYPE.meta, overflowWrap: 'anywhere' }}>{evidenceText(e, t)}</span>
                                        {note && <span data-testid="kg-agent-run-evidence-note" style={{ ...TYPE.meta, overflowWrap: 'anywhere' }}>{note}</span>}
                                        {e.path && <code style={{ ...TYPE.mono, color: cssVar('text'), overflowWrap: 'anywhere' }}>{e.path}</code>}
                                        {e.excerpt && (
                                            <pre style={{ ...TYPE.mono, margin: 0, maxHeight: 120, overflow: 'auto', padding: 8, borderRadius: 8, background: cssVar('bg'), color: cssVar('text'), whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                                                {e.excerpt}
                                            </pre>
                                        )}
                                    </li>
                                    );
                                })}
                            </ul>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

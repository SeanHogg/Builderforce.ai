/**
 * The Run panel's phase timeline (PRD 41 A8): each phase the run has reached, in order, with its
 * done of total, a bar, the rate it has sustained and an ETA from that rate. The current phase is
 * highlighted (and says so in words, never colour alone).
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import type { StoredReviewRun } from '../../types';
import { Bar, Section } from '../drawers/ui';
import { counted } from '../plural';
import { TYPE } from '../ui/type';
import { awaitingJudgeCount, phaseRows, rateText, spanText } from './runModel';

export function RunTimeline({ run, labels }: { run: StoredReviewRun; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.run;
    const rows = phaseRows(run);
    if (rows.length === 0) return null;
    const waiting = awaitingJudgeCount(run);
    return (
        <Section title={t.timelineTitle}>
            <ol data-testid="kg-run-timeline" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                {rows.map((row) => {
                    const name = labels.phases[row.phase];
                    if (row.milestone) {
                        return (
                            <li key={row.phase} data-phase={row.phase} data-state="done" style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', padding: '2px 8px' }}>
                                <span aria-hidden="true" style={{ ...TYPE.status, color: cssVar('agrees'), width: 14, textAlign: 'center', flex: 'none' }}>✓</span>
                                <span style={{ ...TYPE.subtitle, flex: 1, minWidth: 0 }}>{name}</span>
                            </li>
                        );
                    }
                    return (
                        <li
                            key={row.phase} data-phase={row.phase} data-state={row.state} aria-current={row.state === 'active' ? 'step' : undefined}
                            style={{
                                display: 'grid', gap: 4, padding: '6px 8px', borderRadius: 8,
                                background: row.state === 'active' ? cssVar('accentSoft') : 'transparent',
                                border: `1px solid ${row.state === 'active' ? cssVar('accent') : 'transparent'}`,
                            }}
                        >
                            <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                <span style={{ ...TYPE.subtitle, flex: 1, minWidth: 0 }}>{name}</span>
                                <span style={TYPE.monoValue}>{fillTemplate(t.phaseProgress, { done: row.done, total: row.total })}</span>
                            </span>
                            <Bar frac={row.frac} tone={row.state === 'done' ? 'agrees' : 'accent'} label={name} />
                            {row.rate > 0 && (
                                <span style={{ ...TYPE.meta, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                    <span>{fillTemplate(t.perSecond, { rate: rateText(row.rate) })}</span>
                                    {row.state === 'active' && row.etaMs !== undefined && row.etaMs > 0 && <span>{fillTemplate(t.eta, { time: spanText(labels, row.etaMs) })}</span>}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
            {waiting > 0 && <p data-testid="kg-run-awaiting-judge" style={{ ...TYPE.meta, margin: 0 }}>{counted(labels, 'awaitingJudge', waiting)}</p>}
        </Section>
    );
}

/** A run's phases on its own time axis: one bar per phase, from when it started to when it ended, on the run's span (the record's times, nothing drawn that did not happen). */

import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import type { StoredReviewRun } from '../../types';
import { TYPE } from '../ui/type';
import { RUN_PHASE_ORDER, runDurationMs, spanText } from './runModel';

export function RunAxis({ run, labels }: { run: StoredReviewRun; labels: KnowledgeGraphLabels }) {
    const span = Math.max(1, runDurationMs(run));
    const end = run.endedAt ?? run.updatedAt;
    const phases = [...run.phases].filter((p) => p.phase !== 'mapped').sort((a, b) => RUN_PHASE_ORDER.indexOf(a.phase) - RUN_PHASE_ORDER.indexOf(b.phase));
    if (phases.length === 0) return null;
    return (
        <ol data-testid="kg-run-axis" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
            {phases.map((p) => {
                const from = Math.min(1, Math.max(0, (p.startedAt - run.startedAt) / span));
                const to = Math.min(1, Math.max(from, ((p.endedAt ?? end) - run.startedAt) / span));
                return (
                    <li key={p.phase} data-phase={p.phase} style={{ display: 'grid', gap: 2 }}>
                        <span style={{ display: 'flex', gap: 8, ...TYPE.meta }}>
                            <span style={{ flex: 1, minWidth: 0 }}>{labels.phases[p.phase]}</span>
                            <span>{spanText(labels, (p.endedAt ?? end) - p.startedAt)}</span>
                        </span>
                        <div aria-hidden="true" style={{ position: 'relative', height: 8, borderRadius: 999, background: cssVar('plane') }}>
                            <div style={{ position: 'absolute', top: 0, bottom: 0, insetInlineStart: `${from * 100}%`, width: `${Math.max(1, (to - from) * 100)}%`, borderRadius: 999, background: cssVar(p.endedAt === undefined && run.endedAt === undefined ? 'accent' : 'agrees') }} />
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}

/** Pace compared with earlier runs: one horizontal bar per run of the root, scaled to the fastest, labelled with when it ran and its files per second; the run on screen is highlighted. */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import type { StoredReviewRun } from '../../types';
import { Bar, Section } from '../drawers/ui';
import { TYPE } from '../ui/type';
import { rateText, whenText } from './runModel';
import { paceBars, type PaceRun } from './runPace';

export function RunPaceBars({ run, history, labels, title }: { run?: StoredReviewRun | undefined; history: readonly (PaceRun & { id: string })[]; labels: KnowledgeGraphLabels; title?: string | undefined }) {
    const r = labels.surface.run.review;
    // The run on screen may not be in the history yet (a live one): it leads the list.
    const runs = !run || history.some((h) => h.id === run.id) ? history : [run, ...history];
    const bars = paceBars(runs);
    if (bars.length === 0) return null;
    return (
        <Section title={title ?? r.paceTitle}>
            <ul data-testid="kg-run-pace" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                {bars.map((b) => (
                    <li key={b.id} data-shown={b.id === run?.id ? 'true' : undefined} style={{ display: 'grid', gap: 2 }}>
                        <span style={{ display: 'flex', gap: 8, ...(b.id === run?.id ? TYPE.subtitle : TYPE.meta) }}>
                            <span style={{ flex: 1, minWidth: 0 }}>{whenText(b.startedAt)}</span>
                            <span>{fillTemplate(r.rowRate, { rate: rateText(b.rate) })}</span>
                        </span>
                        <Bar frac={b.frac} tone={b.id === run?.id ? 'accent' : 'muted'} label={fillTemplate(r.rowRate, { rate: rateText(b.rate) })} />
                    </li>
                ))}
            </ul>
        </Section>
    );
}

/**
 * The Review tab before a review runs: nothing planned yet (a button to count), the plan being counted, and the plan ready - three stat tiles of what was
 * counted, a two-way choice of what to read (what changed, or everything again) and the three steps this run will do, with the time from the last run's pace.
 * Counting is free and local, so the plan is ready when the person reads it; nothing is written until the footer's Start.
 */

import type { ReactNode } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { card } from '../../styles';
import type { ReviewRun } from '../../useReviewRun';
import { Bar, Section } from '../drawers/ui';
import { counted } from '../plural';
import { TYPE } from '../ui/type';
import { etaMs, lastRunPace, type PaceRun } from './runPace';
import { rateText, spanText } from './runModel';

type Confirming = Extract<ReviewRun['state'], { status: 'confirm' }>;

const formatCost = (usd: number): string =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: usd < 1 ? 2 : 0 }).format(usd);

/** Planning: the folder being counted, with a bar: determinate when the walk reports a total, else indeterminate, and the walk's own count when the host reports one. */
export function ReviewPlanning({ labels, root, count, total }: { labels: KnowledgeGraphLabels; root: string; count?: number | undefined; total?: number | undefined }) {
    const r = labels.surface.run.review;
    const title = fillTemplate(r.planning, { root });
    const known = total !== undefined && total > 0 && count !== undefined;
    return (
        <section data-testid="kg-review-planning" aria-live="polite" style={{ ...card, display: 'grid', gap: 8 }}>
            <p style={{ ...TYPE.subtitle, margin: 0, overflowWrap: 'anywhere' }}>{title}</p>
            {count !== undefined && count > 0 && <p style={{ ...TYPE.meta, margin: 0 }}>{fillTemplate(r.planningCount, { files: counted(labels, 'file', count) })}</p>}
            {known ? <Bar frac={count / total} label={title} height={8} /> : <Bar frac={0} indeterminate label={title} height={8} />}
        </section>
    );
}

/** Nothing is planned (idle, or the last plan was cancelled): the footer's button counts the files. */
export function ReviewIdle({ labels, cancelled }: { labels: KnowledgeGraphLabels; cancelled: boolean }) {
    const r = labels.surface.run.review;
    return (
        <section data-testid="kg-review-idle" style={{ ...card, display: 'grid', gap: 8 }}>
            <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{cancelled ? labels.reviewCancelled : r.idleBody}</p>
        </section>
    );
}

function Tile({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ ...card, padding: 10, display: 'grid', gap: 2, minWidth: 0 }}>
            <strong style={TYPE.figure}>{value}</strong>
            <span style={TYPE.caption}>{label}</span>
        </div>
    );
}

function Segment({ title, count, hint, selected, onSelect }: { title: string; count?: string | undefined; hint?: string | undefined; selected: boolean; onSelect(): void }) {
    return (
        <button
            type="button" role="radio" aria-checked={selected} onClick={onSelect}
            style={{
                flex: '1 1 140px', minWidth: 0, display: 'grid', gap: 2, textAlign: 'start', cursor: 'pointer', font: 'inherit', color: cssVar('text'), padding: '8px 12px', borderRadius: 10,
                border: `1px solid ${selected ? cssVar('accent') : cssVar('border')}`, background: selected ? cssVar('accentSoft') : 'transparent',
            }}
        >
            <span style={selected ? TYPE.pillOn : TYPE.pill}>{title}</span>
            {count && <span style={TYPE.monoValue}>{count}</span>}
            {selected && hint && <span style={TYPE.meta}>{hint}</span>}
        </button>
    );
}

function Will({ n, title, detail }: { n: number; title: string; detail?: ReactNode }) {
    return (
        <li style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span aria-hidden="true" style={{ ...TYPE.status, width: 18, textAlign: 'center', flex: 'none', color: cssVar('muted') }}>{n}</span>
            <span style={{ display: 'grid', gap: 2, minWidth: 0, flex: 1 }}>
                <span style={TYPE.subtitle}>{title}</span>
                {detail && <span style={TYPE.meta}>{detail}</span>}
            </span>
        </li>
    );
}

export interface ReviewStartProps {
    labels: KnowledgeGraphLabels;
    review: ReviewRun;
    state: Confirming;
    /** The root's past runs, newest first: the last one's pace is the estimate. */
    history: readonly (PaceRun & { id: string })[];
    /** Changes queued to upload now (the replica), for the third step. */
    queued?: number | undefined;
}

export function ReviewStart({ labels, review, state, history, queued }: ReviewStartProps) {
    const r = labels.surface.run.review;
    const { plan, estimate } = state;
    const forced = state.force === true;
    const pace = lastRunPace(history);
    const everything = forced ? plan.files : plan.files + plan.unchanged;
    const readMs = etaMs(plan.files, pace?.rate);
    const readTime = pace && readMs !== undefined ? fillTemplate(r.estimate, { duration: spanText(labels, readMs), rate: rateText(pace.rate) }) : r.estimateNone;
    const judge = plan.judgeFiles !== undefined && plan.judgeFiles > 0 ? plan.judgeFiles : undefined;
    const calls = counted(labels, 'modelCalls', estimate?.modelCalls ?? plan.estimatedModelCalls);
    const cost = estimate?.costUsd !== undefined && !estimate.local
        ? `${calls} · ${fillTemplate(labels.reviewPlanCost, { cost: formatCost(estimate.costUsd) })}`
        : `${calls} · ${estimate?.local ? labels.reviewPlanCostLocal : labels.reviewPlanCostPending}`;
    return (
        <div data-testid="kg-review-start" style={{ display: 'grid', gap: 16 }}>
            <Section title={r.countedTitle}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
                    <Tile label={r.tileFiles} value={everything.toLocaleString()} />
                    <Tile label={r.tileUnchanged} value={plan.unchanged.toLocaleString()} />
                    <Tile label={r.tileLeftOut} value={plan.skipped.length.toLocaleString()} />
                </div>
            </Section>
            <Section title={r.readTitle}>
                <div role="radiogroup" aria-label={r.readTitle} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Segment title={r.choiceChanged} selected={!forced} count={forced ? undefined : counted(labels, 'file', plan.files)} onSelect={() => { if (forced) review.start({ rootId: plan.rootId }); }} />
                    <Segment title={r.choiceAll} selected={forced} count={counted(labels, 'file', everything)} hint={r.choiceAllBody} onSelect={() => { if (!forced) review.rereviewAll(); }} />
                </div>
            </Section>
            <Section title={r.willTitle}>
                <ol data-testid="kg-review-will" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                    <Will n={1} title={r.willRead} detail={readTime} />
                    {judge !== undefined && <Will n={2} title={fillTemplate(r.willJudge, { count: judge })} detail={cost} />}
                    <Will n={judge !== undefined ? 3 : 2} title={r.willUpdate} detail={queued !== undefined && queued > 0 ? fillTemplate(r.willQueued, { count: queued }) : undefined} />
                </ol>
                {judge === undefined && (estimate !== undefined || plan.estimatedModelCalls > 0) && <p data-testid="kg-review-cost" style={{ ...TYPE.meta, margin: 0 }}>{cost}</p>}
            </Section>
        </div>
    );
}

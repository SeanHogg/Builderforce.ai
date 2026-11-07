/**
 * The review's chip — the view's face of the confirm handshake (`types.ts`).
 *
 * confirm: the scope before anything is written — files by pack, files unchanged since
 *          the last review, ≈ model calls (≈ cost when the host prices it) — with
 *          Confirm, Cancel and *Re-review all* (ignore the manifest).
 * running: the phase, n of m, the file, and Stop.
 * done:    what was read, judged and written; *Continue* when the budget left sections.
 */

import type { ReactNode } from 'react';
import type { KnowledgeGraphLabels } from './labels';
import { fillTemplate } from './labels';
import { counted } from './surface/plural';
import { packLabel } from './names';
import { reviewProgressText } from './reviewProgressText';
import { ReviewFailed } from './ReviewFailed';
import { SkippedUploads } from './SkippedList';
import type { ReviewRun } from './useReviewRun';
import { cssVar } from './scene/themeColors';
import { button, card, heading, muted, primaryButton, quietButton } from './styles';

export interface ReviewProgressProps {
    run: ReviewRun;
    labels: KnowledgeGraphLabels;
    /** The title of what is being reviewed (the plan's root, by the host's name). */
    titleOf(rootId: string): string;
    onContinue(rootId: string): void;
    /** Opens the Run drawer (PRD 41 A8); absent ⇒ the host records no runs and there is no Details button. */
    onDetails?: (() => void) | undefined;
}

const formatCost = (usd: number): string =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: usd < 1 ? 2 : 0 }).format(usd);

export function ReviewProgress({ run, labels, titleOf, onContinue, onDetails }: ReviewProgressProps) {
    const s = run.state;
    if (s.status === 'idle') return null;
    const details = onDetails ? <button type="button" style={quietButton} onClick={onDetails}>{labels.surface.run.details}</button> : null;
    const shell = (children: ReactNode, live: 'polite' | 'off' = 'polite') => (
        <section aria-label={labels.reviewFolder} aria-live={live} style={{ ...card, display: 'grid', gap: 10 }}>{children}</section>
    );
    const dismiss = <button type="button" style={quietButton} onClick={run.dismiss}>{labels.close}</button>;

    if (s.status === 'planning') return shell(<p style={{ ...muted, margin: 0 }}>{labels.reviewPlanning}</p>);

    if (s.status === 'confirm') {
        const { plan, estimate } = s;
        const calls = estimate?.modelCalls ?? plan.estimatedModelCalls;
        return shell(
            <>
                <h3 style={heading}>{fillTemplate(labels.reviewPlanTitle, { title: titleOf(plan.rootId) })}</h3>
                <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 13, display: 'grid', gap: 2 }}>
                    {Object.entries(plan.byPack).map(([pack, count]) => (
                        <li key={pack}>{counted(labels, 'packFiles', count, { pack: packLabel(labels, pack) })}</li>
                    ))}
                    <li>{fillTemplate(labels.reviewPlanUnchanged, { count: plan.unchanged })}</li>
                    {plan.skipped.length > 0 && <li>{fillTemplate(labels.reviewPlanSkipped, { count: plan.skipped.length })}</li>}
                    <li>
                        {counted(labels, 'modelCalls', calls)}
                        {estimate?.costUsd !== undefined && !estimate.local && ` · ${fillTemplate(labels.reviewPlanCost, { cost: formatCost(estimate.costUsd) })}`}
                    </li>
                    {plan.judgeFiles !== undefined && plan.judgeFiles > 0 && <li>{fillTemplate(labels.reviewPlanJudgeBudget, { count: plan.judgeFiles })}</li>}
                    {estimate?.local
                        ? <li style={muted}>{labels.reviewPlanCostLocal}</li>
                        : estimate?.costUsd === undefined && <li style={muted}>{labels.reviewPlanCostPending}</li>}
                </ul>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" style={primaryButton} onClick={() => run.answer(true)}>{labels.reviewConfirm}</button>
                    <button type="button" style={button} onClick={() => run.answer(false)}>{labels.reviewCancel}</button>
                    <button type="button" style={quietButton} onClick={run.rereviewAll}>{labels.reviewRereviewAll}</button>
                </div>
            </>,
            'off',
        );
    }

    if (s.status === 'running') {
        const p = s.progress;
        const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : undefined;
        return shell(
            <>
                <p style={{ margin: 0, fontSize: 13 }}>{reviewProgressText(labels, p)}</p>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height: 6, borderRadius: 999, background: cssVar('border') }}>
                    <div style={{ height: '100%', width: `${pct ?? 5}%`, borderRadius: 999, background: cssVar('accent') }} />
                </div>
                {p?.path && <p style={{ ...muted, margin: 0, overflowWrap: 'anywhere' }}>{p.path}</p>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" style={button} onClick={run.stop}>{labels.reviewStop}</button>
                    {details}
                </div>
            </>,
        );
    }

    if (s.status === 'done') {
        const r = s.report;
        return shell(
            <>
                <h3 style={heading}>{labels.reviewDoneTitle}</h3>
                <p style={{ margin: 0, fontSize: 13 }}>
                    {fillTemplate(labels.reviewDoneBody, { extracted: r.extracted, judged: r.judged, facts: r.factsWritten })}
                </p>
                {r.unjudged > 0 && <p style={{ ...muted, margin: 0 }}>{counted(labels, 'sectionUnjudged', r.unjudged)}</p>}
                {s.skipped && <SkippedUploads items={s.skipped} labels={labels} />}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {r.unjudged > 0 && <button type="button" style={primaryButton} onClick={() => onContinue(s.rootId)}>{labels.reviewContinue}</button>}
                    {details}
                    {dismiss}
                </div>
            </>,
        );
    }

    if (s.status === 'error') return shell(<ReviewFailed key={s.at} error={s} labels={labels} dismiss={dismiss} />);

    const text = s.status === 'cancelled' ? labels.reviewCancelled : labels.reviewAborted;
    return shell(<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><p style={{ margin: 0, fontSize: 13, flex: 1 }}>{text}</p>{dismiss}</div>);
}

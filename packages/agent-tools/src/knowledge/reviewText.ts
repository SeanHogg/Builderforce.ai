/**
 * knowledge/reviewText.ts — what a review SAYS on a host with no view of its own: the
 * confirm chip's one line (the plan's numbers) and the answer a finished review settles
 * the turn with (the report). The same words on every host that reviews in-process.
 * Pure.
 */

import type { ReviewPlan, ReviewReport } from '@seanhogg/builderforce-memory/knowledge';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "12 files (code 8 · docs 4) · 5 unchanged · ≈ 37 model calls" — the confirm chip's numbers. */
export function planDetailLine(plan: ReviewPlan, title?: string): string {
    const packs = Object.entries(plan.byPack).map(([pack, n]) => `${pack} ${n}`).join(' · ');
    const parts = [
        `${plural(plan.files, 'file')}${packs ? ` (${packs})` : ''}`,
        `${plan.unchanged} unchanged`,
        `≈ ${plural(plan.estimatedModelCalls, 'model call')}`,
    ];
    if (plan.skipped.length > 0) parts.push(`${plan.skipped.length} skipped`);
    return `${title ? `${title}: ` : ''}${parts.join(' · ')}`;
}

/** The answer a finished review settles the turn with. */
export function reviewReportText(report: ReviewReport, plan: ReviewPlan | undefined, title: string): string {
    const head = report.aborted ? `**Stopped reviewing ${title}.**` : `**Reviewed ${title}.**`;
    const lines = [
        `- ${plural(report.extracted, 'source')} read${plan ? ` (${plural(plan.unchanged, 'file')} unchanged, not re-read)` : ''}`,
        `- ${plural(report.judged, 'section')} judged, ${plural(report.factsWritten, 'fact')} and ${plural(report.relationsWritten, 'relation')} written`,
    ];
    if (report.unjudged > 0) lines.push(`- ${plural(report.unjudged, 'section')} left extracted-only: the model-call budget ran out — review again to continue`);
    if (report.invalidJudgements > 0) lines.push(`- ${plural(report.invalidJudgements, 'judgement')} dropped as invalid`);
    if (report.staleMarked > 0) lines.push(`- ${plural(report.staleMarked, 'source')} checked for stale knowledge`);
    if (report.aborted) lines.push('- Facts already written stay; each file was written whole or not at all.');
    return `${head}\n\n${lines.join('\n')}`;
}

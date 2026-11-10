/**
 * predict/labels/merge.ts — THE precedence between a stored label and a newly computed one of the same kind, shared by
 * the device record and the server tables so the two can never disagree:
 *   - nothing stored: the new one;
 *   - an observed event is never un-observed: a stored `value: true` is never replaced by a `null`/`false` one — except
 *     that a FINAL label may close a censored-true one, and then it carries the stored event forward
 *     ({@link carryStoredEvent});
 *   - a final label is never replaced by a censored one, and always replaces a censored one;
 *   - otherwise the newer `computedAt` wins; a tie keeps the stored one.
 */

import type { RunOutcomeLabel } from '../contract.js';

/** What precedence is decided on: a label, or a stored row of one (`computedAt` as ISO text or a Date). */
export interface LabelPrecedence {
    status: RunOutcomeLabel['status'];
    computedAt: string | Date;
    value?: boolean | null;
    eventAt?: string;
}

const timeOf = (at: string | Date): number => (typeof at === 'string' ? Date.parse(at) : at.getTime());

/** Whether `next` replaces `stored` (when it does and `stored` was true, keep its event: {@link carryStoredEvent}). */
export function labelSupersedes(stored: LabelPrecedence | undefined, next: LabelPrecedence): boolean {
    if (!stored) return true;
    if (stored.status === 'final' && next.status !== 'final') return false;
    const losesEvent = stored.value === true && next.value !== true;
    if (stored.status !== 'final' && next.status === 'final') return true;
    if (losesEvent) return false;
    return timeOf(next.computedAt) > timeOf(stored.computedAt);
}

/** `next` as it is stored over `stored`: an event `stored` observed and `next` lacks is carried forward. */
export function carryStoredEvent(stored: RunOutcomeLabel | undefined, next: RunOutcomeLabel): RunOutcomeLabel {
    if (stored?.value !== true || next.value === true) return next;
    return { ...next, value: true, ...(stored.eventAt ? { eventAt: stored.eventAt } : {}), evidence: stored.evidence };
}

/** `stored` with each of `next` applied by {@link labelSupersedes}: one label per kind, sorted by kind. */
export function mergeLabels(stored: readonly RunOutcomeLabel[], next: readonly RunOutcomeLabel[]): RunOutcomeLabel[] {
    const byKind = new Map(stored.map((l) => [l.kind, l] as const));
    for (const label of next) {
        const prior = byKind.get(label.kind);
        if (labelSupersedes(prior, label)) byKind.set(label.kind, carryStoredEvent(prior, label));
    }
    return [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}

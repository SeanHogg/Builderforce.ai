/**
 * predict/labels/window.ts — label windows and right-censoring (PRD 41 §D1, §12.10), shared by every labeller.
 *
 * A label is `final` only after its window ends. Before that the run is right-censored: an event already observed is
 * `value: true` (with `eventAt`, which survival estimates need), and no event yet is `value: null`, never `false`.
 * Pure: `now` is an input.
 */

import { LABELLER_VERSION, type RunLabelKind, type RunOutcomeLabel } from '../contract.js';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** `from` + `days`, as ISO. */
export function windowEnd(from: string, days: number): string {
    return new Date(Date.parse(from) + days * DAY_MS).toISOString();
}

/** Whether ISO `at` lies within `[from, until]`. */
export const within = (at: string, from: string, until: string): boolean => {
    const t = Date.parse(at);
    return t >= Date.parse(from) && t <= Date.parse(until);
};

/** Whether the window ending at `windowEndsAt` has passed at `now` (an open-ended window never has). */
export const windowElapsed = (windowEndsAt: string | undefined, now: string): boolean =>
    windowEndsAt !== undefined && Date.parse(now) >= Date.parse(windowEndsAt);

/**
 * The label of a windowed kind: an observed event (`event`) is `true`; otherwise `false` once the window elapsed, else
 * censored with `null`. `status` is `final` only once the window elapsed.
 */
export function windowedLabel(input: {
    kind: RunLabelKind;
    windowEndsAt?: string;
    now: string;
    event?: { at: string; evidence: Record<string, string | number> };
    evidence?: Record<string, string | number>;
}): RunOutcomeLabel {
    const elapsed = windowElapsed(input.windowEndsAt, input.now);
    return {
        kind: input.kind,
        value: input.event ? true : elapsed ? false : null,
        status: elapsed ? 'final' : 'censored',
        ...(input.event ? { eventAt: input.event.at } : {}),
        ...(input.windowEndsAt ? { windowEndsAt: input.windowEndsAt } : {}),
        evidence: input.event?.evidence ?? input.evidence ?? {},
        labellerVersion: LABELLER_VERSION[input.kind],
        computedAt: input.now,
    };
}

/**
 * A stored censored label re-read at `now`: once its window elapsed it becomes final, `false` when no event was
 * observed. A final label, or one whose window is still open, is returned unchanged.
 */
export function finalizeCensored(label: RunOutcomeLabel, now: string): RunOutcomeLabel {
    if (label.status === 'final' || !windowElapsed(label.windowEndsAt, now)) return label;
    return { ...label, value: label.value === true ? true : false, status: 'final', computedAt: now };
}

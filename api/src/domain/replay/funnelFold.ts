/**
 * The funnel fold (PRD 33 §2.1 "Funnels", §8 S4c) — pure, over kept recordings.
 *
 * Each recording is its ordered `steps` (route / event sequence: `page:<route>`,
 * `event:<name>`) plus its `clicked` selectors. A funnel step matches with the SAME
 * semantics as a smart event (`markMatchesRule`): a page step is a page mark on the
 * route, an event step a custom event (or built-in name), a click step a click on a
 * selector. A recording reaches step N when steps 1..N match IN ORDER and step N
 * falls within `windowMinutes` of step 1.
 *
 * Clicks are not positioned in `steps` (the row keeps them as a set), so a click
 * step is satisfied by any matching click and takes the time of the step before it.
 *
 * Counts are weighted by each recording's `sample_weight` (the funnel is ≈); the
 * median time between steps is over the recordings that made the transition.
 */

import { markMatchesRule, type SmartEventRule } from '@builderforce/interaction-contract';

export type FunnelStepKind = 'page' | 'click' | 'event';
export type FunnelMatchMode = SmartEventRule['matchMode'];

export interface FunnelStepSpec {
  ord: number;
  stepKind: FunnelStepKind;
  match: string;
  matchMode: FunnelMatchMode;
  label: string;
}

/** One `steps` entry with the time it happened, ms from the recording's start. */
export interface TimedStep {
  token: string;
  atMs: number;
}

export interface FunnelRecording {
  recordingId: string;
  weight: number;
  steps: readonly TimedStep[];
  clicked: readonly string[];
}

export interface FunnelStepResult {
  ord: number;
  label: string;
  visits: number;
  conversionFromPrevPct: number | null;
  medianTimeFromPrevMs: number | null;
  /** Recordings that reached the previous step but not this one (first {@link DROPPED_SAMPLE}). */
  droppedRecordingIds: string[];
}

export interface FunnelFoldResult {
  steps: FunnelStepResult[];
  /** More recordings were supplied than the fold may read. */
  truncated: boolean;
}

/** Recordings listed per drop-off ("watch who dropped at step N"). */
export const DROPPED_SAMPLE = 20;
/** Most recordings one evaluation folds. */
export const FUNNEL_MAX_RECORDINGS = 20_000;

function asRule(step: FunnelStepSpec): SmartEventRule {
  return {
    name: step.label,
    ruleKind: step.stepKind === 'event' ? 'custom' : step.stepKind,
    match: step.match,
    matchMode: step.matchMode,
  };
}

/** Whether one `steps` token satisfies a page / event step. */
export function tokenMatches(token: string, step: FunnelStepSpec): boolean {
  const colon = token.indexOf(':');
  if (colon <= 0) return false;
  const kind = token.slice(0, colon);
  const key = token.slice(colon + 1);
  if (step.stepKind === 'page' && kind === 'page') return markMatchesRule({ kind: 'page', key }, asRule(step));
  if (step.stepKind === 'event' && kind === 'event') return markMatchesRule({ kind: 'event', key }, asRule(step));
  return false;
}

/** Whether any clicked selector satisfies a click step. */
export function clickMatches(clicked: readonly string[], step: FunnelStepSpec): boolean {
  const rule = asRule(step);
  return clicked.some((selector) => markMatchesRule({ kind: 'click', key: selector, label: selector }, rule));
}

/**
 * How far one recording got: the time (ms from start) at which it reached each step,
 * stopping at the first step it did not reach in order and in the window.
 */
export function reachedTimes(recording: FunnelRecording, steps: readonly FunnelStepSpec[], windowMs: number): number[] {
  const times: number[] = [];
  let cursor = 0;
  for (const step of steps) {
    let at: number | null = null;
    if (step.stepKind === 'click') {
      if (clickMatches(recording.clicked, step)) at = times.length ? times[times.length - 1]! : 0;
    } else {
      for (let i = cursor; i < recording.steps.length; i++) {
        if (tokenMatches(recording.steps[i]!.token, step)) {
          at = recording.steps[i]!.atMs;
          cursor = i + 1;
          break;
        }
      }
    }
    if (at === null) break;
    if (times.length && at - times[0]! > windowMs) break;
    times.push(at);
  }
  return times;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Fold recordings through an ordered funnel. */
export function evaluateFunnel(
  recordings: readonly FunnelRecording[],
  steps: readonly FunnelStepSpec[],
  windowMinutes: number,
  opts: { maxRecordings?: number } = {},
): FunnelFoldResult {
  const max = opts.maxRecordings ?? FUNNEL_MAX_RECORDINGS;
  const truncated = recordings.length > max;
  const ordered = [...steps].sort((a, b) => a.ord - b.ord);
  const windowMs = Math.max(1, windowMinutes) * 60_000;

  const visits = new Array<number>(ordered.length).fill(0);
  const gaps: number[][] = ordered.map(() => []);
  const dropped: string[][] = ordered.map(() => []);

  for (const recording of truncated ? recordings.slice(0, max) : recordings) {
    const times = reachedTimes(recording, ordered, windowMs);
    const weight = recording.weight > 0 ? recording.weight : 1;
    times.forEach((at, i) => {
      visits[i] = (visits[i] ?? 0) + weight;
      if (i > 0) gaps[i]!.push(at - times[i - 1]!);
    });
    const stoppedAt = times.length;
    if (stoppedAt > 0 && stoppedAt < ordered.length && dropped[stoppedAt]!.length < DROPPED_SAMPLE) {
      dropped[stoppedAt]!.push(recording.recordingId);
    }
  }

  return {
    truncated,
    steps: ordered.map((step, i) => {
      const prev = i > 0 ? visits[i - 1]! : null;
      return {
        ord: step.ord,
        label: step.label,
        visits: Math.round(visits[i]!),
        conversionFromPrevPct: prev === null ? null : prev > 0 ? round1((visits[i]! / prev) * 100) : 0,
        medianTimeFromPrevMs: i === 0 ? null : median(gaps[i]!),
        droppedRecordingIds: dropped[i]!,
      };
    }),
  };
}

/**
 * A kept row's untimed `steps` as timed steps. The row records ORDER, not time, so
 * each step is placed proportionally along the recording's duration — an estimate,
 * which is why funnel times are shown as ≈ like every kept-recording number.
 */
export function interpolateStepTimes(steps: readonly string[], durationMs: number): TimedStep[] {
  const last = Math.max(1, steps.length - 1);
  return steps.map((token, i) => ({ token, atMs: steps.length > 1 ? Math.round((durationMs * i) / last) : 0 }));
}

/**
 * The cost-alert RULES (A5) — pure, so every threshold is unit-testable.
 *
 *   • SPEND SPIKE — a tenant's spend so far today exceeds 2× the median of its previous
 *     14 daily totals. Days with no spend count as $0 (a sporadic tenant's median is
 *     honestly low), and the baseline is floored at $1 so a tenant whose median is ~$0
 *     does not page on its first dollar. Today is a PARTIAL day, which only makes the
 *     rule more conservative as the day goes on.
 *   • RUN COST OUTLIER — a run cost more than 3× the p90 of its action type within the
 *     tenant over the trailing 30 days, given at least 20 runs of that type to know what
 *     p90 is, and at least $0.50 so a cheap action type's noise does not page.
 *
 * Costs are the write-time stamped (provider-reported usage × catalog price) figures.
 */
import { median } from '../shared/stats';

export const SPEND_SPIKE_MULTIPLIER = 2;
export const SPEND_BASELINE_DAYS = 14;
export const SPEND_BASELINE_FLOOR_USD = 1;

export const RUN_OUTLIER_MULTIPLIER = 3;
export const RUN_OUTLIER_PERCENTILE = 0.9;
export const RUN_OUTLIER_HISTORY_DAYS = 30;
export const RUN_OUTLIER_MIN_SAMPLES = 20;
export const RUN_OUTLIER_MIN_USD = 0.5;

export interface SpendSpikeVerdict {
  spike: boolean;
  medianUsd: number;
  thresholdUsd: number;
}

/**
 * `priorDailyUsd` is the tenant's spend on each of the previous days it HAD spend;
 * missing days are filled with $0 up to {@link SPEND_BASELINE_DAYS}.
 */
export function spendSpikeVerdict(todayUsd: number, priorDailyUsd: readonly number[]): SpendSpikeVerdict {
  const days = priorDailyUsd.slice(0, SPEND_BASELINE_DAYS);
  const filled = [...days, ...Array<number>(Math.max(0, SPEND_BASELINE_DAYS - days.length)).fill(0)];
  const medianUsd = median(filled) ?? 0;
  const thresholdUsd = SPEND_SPIKE_MULTIPLIER * Math.max(medianUsd, SPEND_BASELINE_FLOOR_USD);
  return { spike: todayUsd > thresholdUsd, medianUsd, thresholdUsd };
}

export function isRunCostOutlier(costUsd: number, p90Usd: number): boolean {
  return costUsd >= RUN_OUTLIER_MIN_USD && p90Usd > 0 && costUsd > RUN_OUTLIER_MULTIPLIER * p90Usd;
}

/** The hourly gate's KV key — one sweep per UTC hour however often the tick fires. */
export function costAlertHourKey(nowMs: number): string {
  return `cron:cost-alerts:${new Date(nowMs).toISOString().slice(0, 13)}`;
}

const usd = (n: number): string => `$${n.toFixed(2)}`;

export function spendSpikeMessage(todayUsd: number, v: SpendSpikeVerdict): string {
  return `LLM spend today is ${usd(todayUsd)} — above ${SPEND_SPIKE_MULTIPLIER}x the 14-day daily median `
    + `(${usd(v.medianUsd)}; alert threshold ${usd(v.thresholdUsd)}).`;
}

export function runCostOutlierMessage(executionId: number, actionType: string, costUsd: number, p90Usd: number): string {
  return `Run #${executionId} (${actionType}) cost ${usd(costUsd)} — more than ${RUN_OUTLIER_MULTIPLIER}x the 30-day p90 `
    + `for ${actionType} runs (${usd(p90Usd)}).`;
}

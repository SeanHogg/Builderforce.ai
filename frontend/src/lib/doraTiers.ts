import { toneColor, type StatusToneMap } from './statusTone';

/**
 * The DORA delivery bands — Elite / High / Medium / Low — and what each one MEANS as a
 * tone. `DoraLens` and the delivery widgets each declared this trio privately and
 * verbatim; it lives here so the lens and its widget can never colour a band differently.
 */
export const DORA_TIER_ORDER = ['elite', 'high', 'medium', 'low'] as const;
export type DoraTierKey = (typeof DORA_TIER_ORDER)[number];

export const DORA_TIER_TONE: StatusToneMap<DoraTierKey> = {
  elite: 'success',
  high: 'success',
  medium: 'warning',
  low: 'danger',
};

/** Solid (chart / dot) colour per band — the rendering both consumers draw. */
export const DORA_TIER_COLOR: Record<DoraTierKey, string> = {
  elite: toneColor('success', 'solid'),
  high: toneColor('success', 'solid'),
  medium: toneColor('warning', 'solid'),
  low: toneColor('danger', 'solid'),
};

// ── Classification: the published DORA bands, index 0 = Elite … 3 = Low ─────────
// One copy, so the lens and its dashboard widget cannot place a team in different bands.

/** Deployment frequency, per day — higher is better (daily / weekly / monthly / less). */
export function tierDeployFreq(perDay: number): number {
  return perDay >= 1 ? 0 : perDay >= 1 / 7 ? 1 : perDay >= 1 / 30 ? 2 : 3;
}

/** Lead time for changes, hours — lower is better (<1d / <1w / <1m / ≥1m). */
export function tierLeadTime(hours: number): number {
  return hours < 24 ? 0 : hours < 168 ? 1 : hours < 730 ? 2 : 3;
}

/** Change-failure rate, % — lower is better (≤5 / ≤15 / ≤30 / >30). */
export function tierCfr(percent: number): number {
  return percent <= 5 ? 0 : percent <= 15 ? 1 : percent <= 30 ? 2 : 3;
}

/** Time to restore, hours — lower is better (<1h / <1d / <1w / ≥1w). */
export function tierMttr(hours: number): number {
  return hours < 1 ? 0 : hours < 24 ? 1 : hours < 168 ? 2 : 3;
}

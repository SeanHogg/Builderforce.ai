/**
 * What a month of Insights would cost (PRD 33 D4), as the landing's calculator and
 * the Plan panel show it. Pure: the pack ladder is passed in (it is catalog data,
 * `capabilityApi.packs()`), never declared here.
 *
 * The estimate assumes one kept recording per visit — the default `keepRate` of 1
 * — and is shown as an estimate (≈), because kept recordings, not visits, are the
 * billable unit.
 */
import type { ReplayPackDto } from '@builderforce/interaction-contract';

export interface ReplayCostEstimate {
  recordings: number;
  /** Recordings above the free allowance. */
  overflow: number;
  /** True when the month fits inside the free allowance. */
  free: boolean;
  /** The pack that covers the overflow, bought `packCount` times; null when free or no ladder. */
  pack: ReplayPackDto | null;
  packCount: number;
  totalCents: number;
}

export function estimateReplayCost(
  recordings: number,
  freeAllowance: number,
  packs: readonly ReplayPackDto[],
): ReplayCostEstimate {
  const safe = Math.max(0, Math.round(recordings));
  const overflow = Math.max(0, safe - Math.max(0, freeAllowance));
  if (overflow === 0) return { recordings: safe, overflow, free: true, pack: null, packCount: 0, totalCents: 0 };
  const ladder = [...packs].filter((p) => p.units > 0).sort((a, b) => a.units - b.units);
  if (ladder.length === 0) return { recordings: safe, overflow, free: false, pack: null, packCount: 0, totalCents: 0 };
  // The smallest single pack that covers the month; past the top of the ladder,
  // the top pack as many times as it takes.
  const single = ladder.find((p) => p.units >= overflow);
  const pack = single ?? ladder[ladder.length - 1]!;
  const packCount = single ? 1 : Math.ceil(overflow / pack.units);
  return { recordings: safe, overflow, free: false, pack, packCount, totalCents: pack.amountCents * packCount };
}

/** The slider's stops: visits a month, from a side project to a large site. */
export const VISITOR_STOPS = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const;

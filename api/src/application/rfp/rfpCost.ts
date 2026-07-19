/**
 * RFP P&L composer (PRD 15) — pure, deterministic, unit-testable.
 *
 * Composes a quoted price from the real cost drivers: human build-out
 * (effort × blended weekly rate), agentic cost (a forward estimate grounded on the
 * project's historical LLM spend), marketing, and a contingency buffer — then applies
 * a profit MARGIN expressed as a share of the quoted price (margin = profit / revenue),
 * so `marginPct = 0.25` means a quarter of the quoted price is profit.
 *
 * No prebuilt margin calculator exists in the codebase; this is the single source of
 * truth for RFP economics (routes + doc renderer + frontend all read `RfpCostModel`).
 */
import type { RfpCostModel, RfpCostLineItem } from './types';

export const RFP_COST_DEFAULTS = {
  marginPct: 0.25,
  marketingPct: 0.12,
  contingencyPct: 0.1,
  /** Fallback blended weekly rate (USD) when no member cost rates are available. */
  blendedWeeklyRateUsd: 6000,
} as const;

export interface RfpCostInput {
  effortWeeks: number;
  blendedWeeklyRateUsd: number;
  agenticCostUsd: number;
  marginPct?: number;
  marketingPct?: number;
  contingencyPct?: number;
}

/** Clamp a percentage input to a sane [0, 0.9] band (margin at 1.0 diverges). */
function pct(v: number | undefined, def: number): number {
  if (v == null || !Number.isFinite(v)) return def;
  return Math.min(Math.max(v, 0), 0.9);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function computeRfpCostModel(input: RfpCostInput): RfpCostModel {
  const effortWeeks = Math.max(0, Number(input.effortWeeks) || 0);
  const weeklyRate = Math.max(0, Number(input.blendedWeeklyRateUsd) || RFP_COST_DEFAULTS.blendedWeeklyRateUsd);
  const marginPct = pct(input.marginPct, RFP_COST_DEFAULTS.marginPct);
  const marketingPct = pct(input.marketingPct, RFP_COST_DEFAULTS.marketingPct);
  const contingencyPct = pct(input.contingencyPct, RFP_COST_DEFAULTS.contingencyPct);

  const buildCostUsd = round2(effortWeeks * weeklyRate);
  const agenticCostUsd = round2(Math.max(0, Number(input.agenticCostUsd) || 0));
  const marketingCostUsd = round2((buildCostUsd + agenticCostUsd) * marketingPct);
  const preContingency = buildCostUsd + agenticCostUsd + marketingCostUsd;
  const contingencyUsd = round2(preContingency * contingencyPct);
  const subtotalCostUsd = round2(preContingency + contingencyUsd);

  // Margin as a share of quoted revenue: quoted = cost / (1 - marginPct).
  const quotedPriceUsd = round2(marginPct >= 1 ? subtotalCostUsd : subtotalCostUsd / (1 - marginPct));
  const marginUsd = round2(quotedPriceUsd - subtotalCostUsd);

  const lineItems: RfpCostLineItem[] = [
    { label: `Build-out (${effortWeeks.toFixed(1)} wk × $${weeklyRate.toLocaleString()})`, category: 'build', amountUsd: buildCostUsd },
    { label: 'Agentic / AI costs', category: 'agentic', amountUsd: agenticCostUsd },
    { label: `Marketing (${Math.round(marketingPct * 100)}%)`, category: 'marketing', amountUsd: marketingCostUsd },
    { label: `Contingency (${Math.round(contingencyPct * 100)}%)`, category: 'contingency', amountUsd: contingencyUsd },
    { label: `Profit margin (${Math.round(marginPct * 100)}%)`, category: 'margin', amountUsd: marginUsd },
  ];

  return {
    buildCostUsd,
    agenticCostUsd,
    marketingCostUsd,
    contingencyUsd,
    subtotalCostUsd,
    marginPct,
    marginUsd,
    quotedPriceUsd,
    effortWeeks,
    lineItems,
  };
}

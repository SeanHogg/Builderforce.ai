/**
 * Token/cost consumption off the usage ledger — per model and per funding credential — for the
 * AI Impact lens. Deliberately independent of the scored outcome runs, so BYO / web / VSIX / on-prem
 * usage is visible. Split out of `aiImpactInsights.ts`.
 */

import { MILLICENTS_PER_USD } from '../../domain/shared/money';
import { normalizeByoProvider } from '../llm/usageLedger';
import { vendorForModel } from '../llm/vendors/registry';

/** A usage row, pre-projected to just what the rollup needs. */
export interface UsageRow {
  model: string;
  totalTokens: number;
  costUsdMillicents: number;
  userId: string | null;
  createdAt: Date;
  /** True when the tenant's OWN connected credential served the call. */
  byo: boolean;
  /** Connected-integration id for BYO rows. Null on rows written before 0340 (or
   *  by a path that didn't stamp it) — {@link providerForUsageRow} backfills those
   *  from the model's vendor so historical BYO spend still attributes. */
  byoProvider: string | null;
}

/** Stable id for platform-funded spend — Builderforce's own metered keys, i.e.
 *  everything that is NOT a tenant's connected integration. */
export const PLATFORM_PROVIDER_ID = 'builderforce';

/** Token/cost consumption for one model, rolled up from `llm_usage_log` — so it
 *  covers EVERY surface (web, VSIX, on-prem, cloud, SDK, Rovr), not just the scored
 *  cloud runs that {@link ComparisonRow} is limited to. */
export interface ModelConsumption {
  model: string;
  requests: number;
  tokens: number;
  /** Platform cost. 0 for models served exclusively by a tenant credential. */
  costUsd: number;
  /** True when EVERY row for this model was BYO-funded. */
  byo: boolean;
  /** Credential ids that served this model (usually one). */
  providers: string[];
}

/** Consumption grouped by the credential that FUNDED it — the tenant's connected
 *  BYO integration, or {@link PLATFORM_PROVIDER_ID} for Builderforce's own keys.
 *  This is the "consumption per integration / API key" view: BYO spend is real
 *  spend on the tenant's account even though it costs the platform nothing, so it
 *  must never be inferred from `costUsd` (which is 0 by design for BYO). */
export interface ProviderConsumption {
  provider: string;
  byo: boolean;
  requests: number;
  tokens: number;
  costUsd: number;
  /** Models served through this credential, ranked by tokens (most first). */
  models: string[];
}

/**
 * Pure: which credential funded a usage row.
 *
 * BYO rows carry their connected-integration id in `byoProvider`; rows written
 * before that column existed (0340) fall back to the model's own vendor, mapped
 * through the same alias table the integrations UI uses so the id matches what
 * the tenant sees on their provider-keys page. Platform-funded rows all collapse
 * to {@link PLATFORM_PROVIDER_ID} — the platform key is one credential.
 */
export function providerForUsageRow(row: UsageRow): string {
  if (!row.byo) return PLATFORM_PROVIDER_ID;
  return normalizeByoProvider(row.byoProvider ?? vendorForModel(row.model));
}

/**
 * Pure: token/cost consumption per model over the usage ledger, ranked by tokens.
 *
 * This is the answer to "which models are we actually using" — it counts every
 * logged row, so a tenant whose whole workload runs on their own key still sees
 * their models. Never filter this by cost: BYO rows are recorded with cost 0.
 */
export function summarizeModelConsumption(usage: UsageRow[]): ModelConsumption[] {
  const groups = new Map<string, { requests: number; tokens: number; millicents: number; byoRows: number; providers: Set<string> }>();
  for (const r of usage) {
    const g = groups.get(r.model) ?? { requests: 0, tokens: 0, millicents: 0, byoRows: 0, providers: new Set<string>() };
    g.requests += 1;
    g.tokens += r.totalTokens;
    g.millicents += r.costUsdMillicents;
    if (r.byo) g.byoRows += 1;
    g.providers.add(providerForUsageRow(r));
    groups.set(r.model, g);
  }
  return [...groups.entries()]
    .map(([model, g]) => ({
      model,
      requests: g.requests,
      tokens: g.tokens,
      costUsd: g.millicents / MILLICENTS_PER_USD,
      byo: g.byoRows === g.requests,
      providers: [...g.providers].sort(),
    }))
    .sort((a, b) => b.tokens - a.tokens);
}

/**
 * Pure: consumption per funding credential (connected integration or the platform
 * key), ranked by tokens — the per-integration/API-key breakdown.
 */
export function summarizeProviderConsumption(usage: UsageRow[]): ProviderConsumption[] {
  const groups = new Map<string, { byo: boolean; requests: number; tokens: number; millicents: number; models: Map<string, number> }>();
  for (const r of usage) {
    const provider = providerForUsageRow(r);
    const g = groups.get(provider) ?? { byo: r.byo, requests: 0, tokens: 0, millicents: 0, models: new Map<string, number>() };
    g.requests += 1;
    g.tokens += r.totalTokens;
    g.millicents += r.costUsdMillicents;
    g.models.set(r.model, (g.models.get(r.model) ?? 0) + r.totalTokens);
    groups.set(provider, g);
  }
  return [...groups.entries()]
    .map(([provider, g]) => ({
      provider,
      byo: g.byo,
      requests: g.requests,
      tokens: g.tokens,
      costUsd: g.millicents / MILLICENTS_PER_USD,
      models: [...g.models.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m),
    }))
    .sort((a, b) => b.tokens - a.tokens);
}

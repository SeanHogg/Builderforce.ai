/**
 * Canonical writer for `llm_usage_log` — the single insert site shared by every
 * usage-producing surface (the gateway chat/image routes via `logUsage`, and the
 * cloud-agent execution loop via `recordCloudUsage`).
 *
 * Before this existed, the gateway route logged usage one way and cloud runs
 * recorded only to `usage_snapshots`, so the billing ledger and the agent-usage
 * ledger were disjoint and could not be reconciled or split by cloud-vs-on-prem.
 * Centralizing the insert + the attribution dimensions (agent_host_id /
 * cloud_agent_ref / execution_id, added in migration 0096) fixes that: every row
 * now carries who produced it, so a single query can break tokens (and derived
 * cost) down by ON-PREM vs CLOUD vs WEB.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { llmUsageLog } from '../../infrastructure/database/schema';
import type { LlmUsage } from './LlmProxyService';
import { getCatalogCached } from './modelCatalog';

/** Cache-tier multipliers relative to the base input (prompt) price. cache_read
 *  is billed ~0.1x input, cache_creation ~1.25x — both are subsets of
 *  promptTokens (see schema). Mirrors the discount the usage columns record. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_CREATION_MULTIPLIER = 1.25;

/** Authoritative per-call cost in millicents (1/100000 USD), priced from the
 *  resolved model's catalog price incl. the cache-read/creation discount split.
 *  Returns 0 when the model isn't in the catalog (e.g. a BYO-key passthrough). */
export function computeCostMillicents(
  pricing: { prompt: number; completion: number } | undefined,
  usage: LlmUsage,
): number {
  if (!pricing) return 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheCreation = usage.cacheCreationTokens ?? 0;
  const fullPrompt = Math.max(0, usage.promptTokens - cacheRead - cacheCreation);
  const usd =
    fullPrompt * pricing.prompt +
    cacheRead * pricing.prompt * CACHE_READ_MULTIPLIER +
    cacheCreation * pricing.prompt * CACHE_CREATION_MULTIPLIER +
    usage.completionTokens * pricing.completion;
  return Math.round(usd * 100_000);
}

/**
 * Who produced a usage row. Exactly one of the agent dimensions is set in
 * practice:
 *   • agentHostId      → a self-hosted (on-prem) agent host's gateway call.
 *   • cloudAgentRef    → a cloud agent run (ide_agents.id, or null for the
 *                        gateway-default bucket) — paired with executionId.
 *   • (all null)       → a web/SDK/browser call, i.e. not agent-attributed.
 */
export interface UsageAttribution {
  agentHostId?: number | null;
  cloudAgentRef?: string | null;
  executionId?: number | null;
}

export interface RecordUsageRow {
  tenantId: number;
  userId: string | null;
  llmProduct: string;
  model: string;
  retries?: number;
  streamed?: boolean;
  usage: LlmUsage;
  metadata?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  useCase?: string | null;
  tenantApiKeyId?: string | null;
  attribution?: UsageAttribution | null;
}

/** Minimal shape of a ProxyResult this helper needs — avoids importing the full type. */
interface ProxyUsageResult {
  usage?: LlmUsage;
  resolvedModel?: string;
}

/**
 * Record usage for an internal `ideProxy(...).complete()` caller (brain, QA gen,
 * repo analysis, security review, IDE chat, …) that would otherwise bypass the
 * ledger entirely. No-ops when the call produced no usage (error / stream).
 * These are system/tenant calls, not agent-host or cloud-agent runs, so they
 * carry no agent attribution unless the caller passes one. Best-effort.
 */
export async function recordProxyUsage(
  db: Db,
  env: Env,
  opts: {
    tenantId: number;
    userId?: string | null;
    useCase: string;
    result: ProxyUsageResult;
    llmProduct?: string;
    attribution?: UsageAttribution | null;
  },
): Promise<void> {
  if (!opts.result.usage) return;
  await recordUsageRow(db, env, {
    tenantId:   opts.tenantId,
    userId:     opts.userId ?? null,
    llmProduct: opts.llmProduct ?? 'builderforceLLM',
    model:      opts.result.resolvedModel ?? 'unknown',
    usage:      opts.result.usage,
    useCase:    opts.useCase,
    attribution: opts.attribution ?? null,
  });
}

/** Insert one usage row, stamping an authoritative cost priced from the catalog.
 *  Best-effort — never throws (logging must not fail a run). */
export async function recordUsageRow(db: Db, env: Env, row: RecordUsageRow): Promise<void> {
  try {
    // Price the call at write time so the dashboard/billing sums a recorded
    // column instead of re-pricing tokens against a moving catalog. Catalog read
    // is L1+KV cached, so this is a cheap lookup on the hot logging path.
    let costUsdMillicents = 0;
    try {
      const catalog = await getCatalogCached(env);
      const pricing = catalog.find((m) => m.id === row.model)?.pricing;
      costUsdMillicents = computeCostMillicents(pricing, row.usage);
    } catch { /* pricing unavailable — record tokens with cost 0 */ }

    await db.insert(llmUsageLog).values({
      tenantId:            row.tenantId,
      userId:              row.userId,
      llmProduct:          row.llmProduct,
      model:               row.model,
      promptTokens:        row.usage.promptTokens,
      completionTokens:    row.usage.completionTokens,
      totalTokens:         row.usage.totalTokens,
      cacheReadTokens:     row.usage.cacheReadTokens     ?? 0,
      cacheCreationTokens: row.usage.cacheCreationTokens ?? 0,
      retries:             row.retries ?? 0,
      streamed:            row.streamed ?? false,
      metadata:            row.metadata ? JSON.stringify(row.metadata) : null,
      idempotencyKey:      row.idempotencyKey ?? null,
      useCase:             row.useCase ?? null,
      tenantApiKeyId:      row.tenantApiKeyId ?? null,
      agentHostId:         row.attribution?.agentHostId ?? null,
      cloudAgentRef:       row.attribution?.cloudAgentRef ?? null,
      executionId:         row.attribution?.executionId ?? null,
      costUsdMillicents,
    });
  } catch { /* never let usage logging fail the request */ }
}

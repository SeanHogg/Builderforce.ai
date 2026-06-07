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
import { llmUsageLog } from '../../infrastructure/database/schema';
import type { LlmUsage } from './LlmProxyService';

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

/** Insert one usage row. Best-effort — never throws (logging must not fail a run). */
export async function recordUsageRow(db: Db, row: RecordUsageRow): Promise<void> {
  try {
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
    });
  } catch { /* never let usage logging fail the request */ }
}

/**
 * LENS #6 — Compliance evidence over `tool_audit_events` (gate insights.compliance / CISO).
 *
 * The immutable per-tool agent action trail is the rawest, most defensible
 * audit log in the market — but no compliance artifact came out of it. This adds
 * (1) a summary (volume, tool/agent breakdown, sensitive-action surfacing) and
 * (2) an evidence-pack export (bounded rows) for SOC2/ISO audit requests.
 *
 * {@link classifyToolRisk}/{@link summarizeAudit} are pure for unit testing.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { toolAuditEvents } from '../../infrastructure/database/schema';

const HOUR_MS = 3_600_000;
const EVIDENCE_PACK_LIMIT = 5_000;

export type ToolRisk = 'sensitive' | 'normal';

/** Heuristic risk classification of a tool name. "Sensitive" = state-changing or
 *  credential/secret-touching tools an auditor wants foregrounded. Pure + cheap. */
export function classifyToolRisk(toolName: string): ToolRisk {
  return /(delete|destroy|remove|\brm\b|exec|shell|bash|spawn|deploy|publish|push|force|secret|credential|password|token|api[_-]?key|write[_-]?file|env)/i.test(
    toolName,
  )
    ? 'sensitive'
    : 'normal';
}

export interface AuditRow {
  toolName: string;
  category: string | null;
  agentHostId: number | null;
  cloudAgentRef: string | null;
  executionId: number | null;
}

export interface ComplianceSummary {
  windowDays: number;
  totalEvents: number;
  sensitiveEvents: number;
  distinctExecutions: number;
  distinctAgents: number;
  byTool: Array<{ toolName: string; risk: ToolRisk; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  byAgent: Array<{ agent: string; kind: 'host' | 'cloud'; count: number }>;
}

/** Pure: turn audit rows into the compliance summary (sorted, capped lists). */
export function summarizeAudit(rows: AuditRow[], windowDays: number): ComplianceSummary {
  const byTool = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const byAgent = new Map<string, { kind: 'host' | 'cloud'; count: number }>();
  const executions = new Set<number>();
  const agents = new Set<string>();
  let sensitiveEvents = 0;

  for (const r of rows) {
    byTool.set(r.toolName, (byTool.get(r.toolName) ?? 0) + 1);
    if (classifyToolRisk(r.toolName) === 'sensitive') sensitiveEvents += 1;
    if (r.category) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
    if (r.executionId != null) executions.add(r.executionId);
    const agentKey = r.agentHostId != null ? `host:${r.agentHostId}` : r.cloudAgentRef ? `cloud:${r.cloudAgentRef}` : null;
    if (agentKey) {
      agents.add(agentKey);
      const kind: 'host' | 'cloud' = r.agentHostId != null ? 'host' : 'cloud';
      const cur = byAgent.get(agentKey) ?? { kind, count: 0 };
      cur.count += 1;
      byAgent.set(agentKey, cur);
    }
  }

  const topN = <T>(arr: T[]) => arr.slice(0, 25);
  return {
    windowDays,
    totalEvents: rows.length,
    sensitiveEvents,
    distinctExecutions: executions.size,
    distinctAgents: agents.size,
    byTool: topN(
      [...byTool.entries()]
        .map(([toolName, count]) => ({ toolName, risk: classifyToolRisk(toolName), count }))
        .sort((a, b) => b.count - a.count),
    ),
    byCategory: topN([...byCategory.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count)),
    byAgent: topN(
      [...byAgent.entries()].map(([agent, v]) => ({ agent, kind: v.kind, count: v.count })).sort((a, b) => b.count - a.count),
    ),
  };
}

export async function computeComplianceSummary(db: Db, tenantId: number, days: number): Promise<ComplianceSummary> {
  const since = new Date(Date.now() - days * 24 * HOUR_MS);
  const rows = (await db
    .select({
      toolName: toolAuditEvents.toolName,
      category: toolAuditEvents.category,
      agentHostId: toolAuditEvents.agentHostId,
      cloudAgentRef: toolAuditEvents.cloudAgentRef,
      executionId: toolAuditEvents.executionId,
    })
    .from(toolAuditEvents)
    .where(and(eq(toolAuditEvents.tenantId, tenantId), gte(toolAuditEvents.ts, since)))) as AuditRow[];
  return summarizeAudit(rows, days);
}

export interface EvidenceRow {
  ts: string;
  toolName: string;
  risk: ToolRisk;
  category: string | null;
  agent: string | null;
  executionId: number | null;
  durationMs: number | null;
}

/** Bounded evidence-pack rows for an audit export (newest first, capped). */
export async function buildEvidencePack(db: Db, tenantId: number, days: number): Promise<EvidenceRow[]> {
  const since = new Date(Date.now() - days * 24 * HOUR_MS);
  const rows = await db
    .select({
      ts: toolAuditEvents.ts,
      toolName: toolAuditEvents.toolName,
      category: toolAuditEvents.category,
      agentHostId: toolAuditEvents.agentHostId,
      cloudAgentRef: toolAuditEvents.cloudAgentRef,
      executionId: toolAuditEvents.executionId,
      durationMs: toolAuditEvents.durationMs,
    })
    .from(toolAuditEvents)
    .where(and(eq(toolAuditEvents.tenantId, tenantId), gte(toolAuditEvents.ts, since)))
    .orderBy(desc(toolAuditEvents.ts))
    .limit(EVIDENCE_PACK_LIMIT);
  return rows.map((r) => ({
    ts: new Date(r.ts).toISOString(),
    toolName: r.toolName,
    risk: classifyToolRisk(r.toolName),
    category: r.category ?? null,
    agent: r.agentHostId != null ? `host:${r.agentHostId}` : r.cloudAgentRef ? `cloud:${r.cloudAgentRef}` : null,
    executionId: r.executionId ?? null,
    durationMs: r.durationMs ?? null,
  }));
}

/** Serialise an evidence pack to CSV (RFC-4180-ish; values quoted + escaped). */
export function evidencePackToCsv(rows: EvidenceRow[]): string {
  const header = ['ts', 'tool', 'risk', 'category', 'agent', 'execution_id', 'duration_ms'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.ts, r.toolName, r.risk, r.category, r.agent, r.executionId, r.durationMs].map(esc).join(','));
  return [header.join(','), ...lines].join('\n');
}

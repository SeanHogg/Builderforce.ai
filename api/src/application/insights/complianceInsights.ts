/**
 * LENS #6 — Compliance evidence over the agent tool-audit trail (gate
 * insights.compliance / CISO).
 *
 * The immutable per-tool agent action trail is the rawest, most defensible
 * audit log in the market — but no compliance artifact came out of it. This adds
 * (1) a summary (volume, tool/agent breakdown, sensitive-action surfacing) and
 * (2) an evidence-pack export (bounded rows) for SOC2/ISO audit requests.
 *
 * TWO RELATIONS, ONE TRAIL. Recent history is `tool_audit_events`, one row per tool
 * call. Past the rollup boundary the same history is `tool_audit_daily`, one row per
 * (day, tool, category, agent) — see `maintenance/toolAuditRollup.ts` for why. Both
 * reads below span the pair, and every figure this module produces is identical
 * either side of that boundary, because the fold lands on exactly the dimensions
 * these aggregates group by. The one thing the older half cannot do is name an
 * individual call, which the pack states per row rather than leaving to be inferred.
 *
 * {@link classifyToolRisk}/{@link summarizeAudit} are pure for unit testing.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { toolAuditDaily, toolAuditEvents } from '../../infrastructure/database/schema';
import { auditWindowDays, readAuditWindow, type AuditRow } from '../audit/toolAuditTrail';
import { TOOL_AUDIT_ROLLUP_AFTER_DAYS } from '../maintenance/toolAuditRollup';
import { csvMatrix } from '../export/tabularExport';
import { HOUR_MS } from '../../domain/shared/time';

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

/** The summary's input row is the trail's — re-exported so a caller of this module
 *  does not have to know the read lives next door. */
export type { AuditRow };

export interface ComplianceSummary {
  windowDays: number;
  /** Days of the window still held at single-call grain. Anything older is a daily
   *  tally: the totals are unchanged, but an individual call can no longer be cited. */
  rawWithinDays: number;
  totalEvents: number;
  sensitiveEvents: number;
  distinctExecutions: number;
  distinctAgents: number;
  byTool: Array<{ toolName: string; risk: ToolRisk; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  byAgent: Array<{ agent: string; kind: 'host' | 'cloud'; count: number }>;
}

/** Pure: turn audit rows into the compliance summary (sorted, capped lists). */
export function summarizeAudit(
  rows: AuditRow[],
  windowDays: number,
  rawWithinDays: number = TOOL_AUDIT_ROLLUP_AFTER_DAYS,
): ComplianceSummary {
  const byTool = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const byAgent = new Map<string, { kind: 'host' | 'cloud'; count: number }>();
  const executions = new Set<number>();
  const agents = new Set<string>();
  let sensitiveEvents = 0;
  let totalEvents = 0;
  let rolledUpExecutions = 0;

  for (const r of rows) {
    // A raw row weighs 1; a tally weighs the calls it folded. Everything below counts
    // in this unit, so the totals are identical whether or not the fold has run.
    const n = r.events ?? 1;
    totalEvents += n;
    byTool.set(r.toolName, (byTool.get(r.toolName) ?? 0) + n);
    if (classifyToolRisk(r.toolName) === 'sensitive') sensitiveEvents += n;
    if (r.category) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + n);
    if (r.executionId != null) executions.add(r.executionId);
    else rolledUpExecutions += r.distinctExecutions ?? 0;
    const agentKey = r.agentHostId != null ? `host:${r.agentHostId}` : r.cloudAgentRef ? `cloud:${r.cloudAgentRef}` : null;
    if (agentKey) {
      agents.add(agentKey);
      const kind: 'host' | 'cloud' = r.agentHostId != null ? 'host' : 'cloud';
      const cur = byAgent.get(agentKey) ?? { kind, count: 0 };
      cur.count += n;
      byAgent.set(agentKey, cur);
    }
  }

  const topN = <T>(arr: T[]) => arr.slice(0, 25);
  return {
    windowDays,
    rawWithinDays,
    totalEvents,
    sensitiveEvents,
    distinctExecutions: executions.size + rolledUpExecutions,
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
  return summarizeAudit(await readAuditWindow(db, tenantId, days), days);
}

/** Whether a pack line is one call or a folded day — stated on the row and in the
 *  CSV, because an auditor reading "312" in the events column has to be able to tell
 *  it from 312 lines that were dropped. */
export type EvidenceGrain = 'event' | 'day';

export interface EvidenceRow {
  ts: string;
  grain: EvidenceGrain;
  /** Calls this line accounts for: 1 for an event, the day's total for a tally. */
  events: number;
  toolName: string;
  risk: ToolRisk;
  category: string | null;
  agent: string | null;
  executionId: number | null;
  durationMs: number | null;
}

const agentKeyOf = (agentHostId: number | null, cloudAgentRef: string | null): string | null =>
  (agentHostId != null ? `host:${agentHostId}` : cloudAgentRef ? `cloud:${cloudAgentRef}` : null);

/**
 * Bounded evidence-pack rows for an audit export (newest first, capped).
 *
 * Spans both grains for the reason `audit/toolAuditTrail.ts` gives, and the cap is
 * applied to the MERGED list rather than to each relation: a 90-day pack is now
 * mostly tallies, and taking 5,000 of each would have let the older half crowd out
 * the recent calls an auditor opens the file to read.
 */
export async function buildEvidencePack(db: Db, tenantId: number, days: number): Promise<EvidenceRow[]> {
  const { since, sinceDay } = auditWindowDays(days);
  const [raw, tallies] = await Promise.all([
    db.select({
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
      .limit(EVIDENCE_PACK_LIMIT),
    db.select({
      lastTs: toolAuditDaily.lastTs,
      toolName: toolAuditDaily.toolName,
      category: toolAuditDaily.category,
      agentHostId: toolAuditDaily.agentHostId,
      cloudAgentRef: toolAuditDaily.cloudAgentRef,
      events: toolAuditDaily.events,
      durationMsTotal: toolAuditDaily.durationMsTotal,
    })
      .from(toolAuditDaily)
      .where(and(eq(toolAuditDaily.tenantId, tenantId), gte(toolAuditDaily.day, sinceDay)))
      .orderBy(desc(toolAuditDaily.lastTs))
      .limit(EVIDENCE_PACK_LIMIT),
  ]);

  const events: EvidenceRow[] = raw.map((r) => ({
    ts: new Date(r.ts).toISOString(),
    grain: 'event' as const,
    events: 1,
    toolName: r.toolName,
    risk: classifyToolRisk(r.toolName),
    category: r.category ?? null,
    agent: agentKeyOf(r.agentHostId, r.cloudAgentRef),
    executionId: r.executionId ?? null,
    durationMs: r.durationMs ?? null,
  }));
  const days_: EvidenceRow[] = tallies.map((r) => ({
    ts: new Date(r.lastTs).toISOString(),
    grain: 'day' as const,
    events: r.events,
    toolName: r.toolName,
    risk: classifyToolRisk(r.toolName),
    category: r.category ?? null,
    agent: agentKeyOf(r.agentHostId, r.cloudAgentRef),
    // A tally is not one execution, and naming one of the day's would be a fiction.
    executionId: null,
    durationMs: r.durationMsTotal ?? null,
  }));

  return [...events, ...days_]
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, EVIDENCE_PACK_LIMIT);
}

/** Serialise an evidence pack to CSV. The columns are this module's; the escaping
 *  is `csvMatrix`, the api's one CSV writer. */
export function evidencePackToCsv(rows: EvidenceRow[]): string {
  return csvMatrix(
    ['ts', 'grain', 'events', 'tool', 'risk', 'category', 'agent', 'execution_id', 'duration_ms'],
    rows.map((r) => [r.ts, r.grain, r.events, r.toolName, r.risk, r.category, r.agent, r.executionId, r.durationMs]),
  );
}

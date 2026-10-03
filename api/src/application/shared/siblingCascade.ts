import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  agentHosts,
  brainChatTrace,
  executionClaimEvidence,
  executions,
  projectSites,
  runContextState,
  runModelOutcomes,
  toolAuditDaily,
  toolAuditEvents,
  usageSnapshots,
} from '../../infrastructure/database/schema';
import { appsDatabaseOf } from '../ide/appsDatabase';
import { runTelemetryDatabase } from './runTelemetryDatabase';

/**
 * THE CASCADES THE SPLIT-OUT DATABASES CANNOT RECEIVE FROM CORE.
 *
 * On one database, deleting a tenant, project, agent host or segment took its rows in
 * other tables with it through `ON DELETE CASCADE` / `SET NULL`. With the apps runtime
 * and the agent-run telemetry on their own endpoints those keys cannot exist — Postgres
 * does not enforce one across databases — so the delete path performs the step each
 * constraint used to. Everything below these rows that still cascades INSIDE its own
 * database (site collections under `project_sites`, evidence under a claim) is left to
 * that database's keys.
 *
 * Called AFTER the core delete has committed, so a core delete that fails never strands
 * a parent without its children. When a sibling is not split out, the core keys have
 * already cascaded and these statements find nothing.
 *
 * TWO DELIBERATE EXCEPTIONS, both on the telemetry side:
 *   • `execution_claims` / `execution_claim_evidence` are immutable by trigger and are
 *     never deleted here — a claim is history about a run, not data about a tenant.
 *   • a `tool_audit_events` row that a claim cites is kept for the same reason (its key
 *     is ON DELETE RESTRICT). Everything else about the deleted parent goes.
 */

/** Trail rows no claim cites — the only ones the cascade may delete. */
const uncited = notExists(
  sql`(SELECT 1 FROM ${executionClaimEvidence} WHERE ${executionClaimEvidence.toolAuditEventId} = ${toolAuditEvents.id})`,
);

/** Statements are chunked so an id list never builds an unbounded `IN`. */
const CHUNK = 1000;
function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

/** After projects are deleted: their sites go, their run outcomes lose the project
 *  (the old `ON DELETE SET NULL` — the outcome still teaches the tenant's router). */
export async function cascadeProjectDelete(core: Db, projectIds: readonly number[]): Promise<void> {
  if (projectIds.length === 0) return;
  for (const ids of chunks(projectIds)) {
    await appsDatabaseOf(core).delete(projectSites).where(inArray(projectSites.projectId, ids));
    await runTelemetryDatabase(core).update(runModelOutcomes).set({ projectId: null }).where(inArray(runModelOutcomes.projectId, ids));
  }
}

/** After a workspace is deleted: its sites and its run telemetry go; its scored
 *  outcomes are detached from it (`SET NULL`), as they were on core. */
export async function cascadeTenantDelete(core: Db, tenantId: number): Promise<void> {
  await appsDatabaseOf(core).delete(projectSites).where(eq(projectSites.tenantId, tenantId));
  const telemetry = runTelemetryDatabase(core);
  await telemetry.delete(toolAuditEvents).where(and(eq(toolAuditEvents.tenantId, tenantId), uncited));
  await telemetry.delete(toolAuditDaily).where(eq(toolAuditDaily.tenantId, tenantId));
  await telemetry.delete(usageSnapshots).where(eq(usageSnapshots.tenantId, tenantId));
  await telemetry.delete(brainChatTrace).where(eq(brainChatTrace.tenantId, tenantId));
  await telemetry.delete(runContextState).where(eq(runContextState.tenantId, tenantId));
  await telemetry.update(runModelOutcomes).set({ tenantId: null, projectId: null }).where(eq(runModelOutcomes.tenantId, tenantId));
}

/** After an agent host is deleted: the telemetry it posted goes with it. */
export async function cascadeAgentHostDelete(core: Db, tenantId: number, agentHostId: number): Promise<void> {
  const telemetry = runTelemetryDatabase(core);
  await telemetry.delete(toolAuditEvents)
    .where(and(eq(toolAuditEvents.tenantId, tenantId), eq(toolAuditEvents.agentHostId, agentHostId), uncited));
  await telemetry.delete(usageSnapshots)
    .where(and(eq(usageSnapshots.tenantId, tenantId), eq(usageSnapshots.agentHostId, agentHostId)));
}

/** What a segment owns on the telemetry side, captured BEFORE the segment's core rows
 *  are erased — afterwards nothing on core can say which runs and hosts were its. */
export interface SegmentTelemetryKeys {
  tenantId: number;
  segmentId: string;
  executionIds: number[];
  agentHostIds: number[];
}

export async function collectSegmentTelemetryKeys(core: Db, tenantId: number, segmentId: string): Promise<SegmentTelemetryKeys> {
  const [runs, hosts] = await Promise.all([
    core.select({ id: executions.id }).from(executions)
      .where(and(eq(executions.tenantId, tenantId), eq(executions.segmentId, segmentId))),
    core.select({ id: agentHosts.id }).from(agentHosts)
      .where(and(eq(agentHosts.tenantId, tenantId), eq(agentHosts.segmentId, segmentId))),
  ]);
  return { tenantId, segmentId, executionIds: runs.map((r) => r.id), agentHostIds: hosts.map((h) => h.id) };
}

/**
 * After a segment is erased (DSR / right-to-erasure): the telemetry of its runs and
 * hosts goes. Rows copied from core still carry `segment_id`; rows written since the
 * move do not (the operational endpoint has no default-segment trigger), so they are
 * found through the run or host they belong to.
 */
export async function cascadeSegmentDelete(core: Db, keys: SegmentTelemetryKeys): Promise<void> {
  const telemetry = runTelemetryDatabase(core);
  const { tenantId, segmentId } = keys;
  await telemetry.delete(toolAuditEvents)
    .where(and(eq(toolAuditEvents.tenantId, tenantId), eq(toolAuditEvents.segmentId, segmentId), uncited));
  await telemetry.delete(usageSnapshots)
    .where(and(eq(usageSnapshots.tenantId, tenantId), eq(usageSnapshots.segmentId, segmentId)));
  for (const ids of chunks(keys.executionIds)) {
    await telemetry.delete(toolAuditEvents)
      .where(and(eq(toolAuditEvents.tenantId, tenantId), inArray(toolAuditEvents.executionId, ids), uncited));
    await telemetry.delete(usageSnapshots)
      .where(and(eq(usageSnapshots.tenantId, tenantId), inArray(usageSnapshots.executionId, ids)));
  }
  for (const ids of chunks(keys.agentHostIds)) {
    await telemetry.delete(toolAuditEvents)
      .where(and(eq(toolAuditEvents.tenantId, tenantId), inArray(toolAuditEvents.agentHostId, ids), uncited));
    await telemetry.delete(usageSnapshots)
      .where(and(eq(usageSnapshots.tenantId, tenantId), inArray(usageSnapshots.agentHostId, ids)));
  }
}

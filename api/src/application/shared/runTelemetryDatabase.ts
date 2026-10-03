/**
 * THE DATABASE THAT OWNS AGENT-RUN TELEMETRY.
 *
 * `tool_audit_events` (+ its `tool_audit_daily` fold and the `execution_claims` /
 * `execution_claim_evidence` that cite it), `usage_snapshots`, `brain_chat_trace`,
 * `run_context_state` and `run_model_outcomes` live on the operational endpoint beside
 * the usage ledger, not on core.
 *
 * WHY THERE. Neon bills each project's compute by its own awake time, so tables are
 * grouped by WHEN they are written, not by subject. These are written at the same
 * moments as `llm_usage_log` — while an agent runs — and the operational endpoint is
 * already awake then. Left on core, every run woke core too and the same minutes were
 * paid twice; the tool trail alone was ~77k writes between two of core's sleeps.
 *
 * Cross-database references are plain ids (tenant, project, task, agent host, chat):
 * Postgres cannot enforce a key across endpoints. The delete cascades those keys used
 * to perform are done by `infrastructure/database/siblingCascade.ts`, and a query that
 * used to JOIN one of these tables to a core table now reads each side from its own
 * handle and joins in memory.
 *
 * Resolved from the core handle the caller already holds; when the operational
 * endpoint is not split out (local, tests) this is the core handle itself, where the
 * tables also exist.
 */
import { getTableName } from 'drizzle-orm';
import { siblingDatabaseOf, type Db } from '../../infrastructure/database/connection';
import {
  brainChatTrace,
  executionClaimEvidence,
  executionClaims,
  runContextState,
  runModelOutcomes,
  toolAuditDaily,
  toolAuditEvents,
  usageSnapshots,
} from '../../infrastructure/database/schema';

/**
 * The relations this database owns — `transactional-migrations/0013` creates exactly
 * these. Derived from the Drizzle tables so a rename cannot drop one back onto core.
 * Read by code that is generic over tables and knows a relation only by name.
 */
export const RUN_TELEMETRY_TABLES: ReadonlySet<string> = new Set(
  [toolAuditEvents, toolAuditDaily, executionClaims, executionClaimEvidence, usageSnapshots, brainChatTrace, runContextState, runModelOutcomes]
    .map((table) => getTableName(table)),
);

export function runTelemetryDatabase(core: Db): Db {
  return siblingDatabaseOf(core, 'operational');
}

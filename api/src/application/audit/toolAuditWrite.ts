/**
 * toolAuditWrite — THE writer of `tool_audit_events`.
 *
 * Every row's `args` (JSON text) and `result` (text) can carry a secret (an `env` dump, a bearer
 * header, a failing command line). Redaction happens HERE, structurally, immediately before the
 * insert, so no inserter can forget it. `check:tool-audit-writes` fails on any other
 * `insert(toolAuditEvents)`.
 *
 * Returns the Drizzle insert builder, so a caller keeps `.returning()` / `.onConflictDoNothing()` /
 * `.catch()`.
 */
import type { Db } from '../../infrastructure/database/connection';
import { toolAuditEvents } from '../../infrastructure/database/schema';
import { redactAuditRow } from '../../infrastructure/security/redactSecrets';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';

export type ToolAuditRow = typeof toolAuditEvents.$inferInsert;

/** Redact, then insert one row (a single object) or many (one statement). */
export function insertToolAudit(db: Db, rows: ToolAuditRow | ToolAuditRow[]) {
  const insert = runTelemetryDatabase(db).insert(toolAuditEvents);
  return Array.isArray(rows)
    ? insert.values(rows.map((row) => redactAuditRow(row)))
    : insert.values(redactAuditRow(rows));
}

/**
 * Roll the decisive call a proof's own console recorded back onto its
 * realization row.
 *
 * ── THE ASYMMETRY THIS RELIES ON ─────────────────────────────────────────────
 * A generated console (the demand console, the POC harness) posts its verdict
 * through `/__api/collections/<name>` — the SAME public, same-origin,
 * unauthenticated write endpoint its own signup/request form already uses.
 * That write is not trusted on its own; `application/ide/siteData.ts` says so
 * plainly ("writes are public, reads are not"). This module is the one place
 * a console's write becomes part of the tenant's TRUSTED record: it reads the
 * collection back server-side, scoped by both tenant and the realization's own
 * project id, so nothing a console posts can name another tenant's or another
 * realization's row.
 *
 * ── WHY THIS IS NOT A HANDLER STEP ───────────────────────────────────────────
 * `application/backend/handlerSpec.ts` deliberately keeps the declarative
 * handler vocabulary narrow — llm, connector, set, data — because a handler
 * runs sandboxed, on shared infrastructure, against a spec any project
 * collaborator can edit. Writing to `realizations`, a core platform table, is
 * not a capability that vocabulary should ever gain. So the rollup happens
 * here, in the trusted application layer, triggered when the realization is
 * actually read — not inside the generated project's own backend.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { siteCollections, siteRecords } from '../../infrastructure/database/schema';
import { setRealizationVerdict, isRealizationVerdict, type RealizationVerdict, type Row } from './realizationStore';
import { VERDICT_COLLECTION } from './targets/shared';

interface DecidedRecord {
  verdict: RealizationVerdict;
  metric: Record<string, unknown>;
  decidedAt: Date;
}

/** The most recent decisive call posted to this project's verdict collection,
 *  or null when there isn't one (no collection yet, no submission yet, or a
 *  submission that did not carry a verdict this platform recognises). */
async function latestVerdictRecord(db: Db, tenantId: number, projectId: number): Promise<DecidedRecord | null> {
  const [collection] = await db
    .select({ id: siteCollections.id })
    .from(siteCollections)
    .where(and(
      eq(siteCollections.tenantId, tenantId),
      eq(siteCollections.projectId, projectId),
      eq(siteCollections.name, VERDICT_COLLECTION),
    ))
    .limit(1);
  if (!collection) return null;

  const [record] = await db
    .select({ payload: siteRecords.payload, createdAt: siteRecords.createdAt })
    .from(siteRecords)
    .where(and(eq(siteRecords.collectionId, collection.id), eq(siteRecords.tenantId, tenantId)))
    .orderBy(desc(siteRecords.id))
    .limit(1);
  if (!record) return null;

  const payload = (record.payload ?? {}) as Record<string, unknown>;
  if (!isRealizationVerdict(payload.verdict)) return null;
  return { verdict: payload.verdict, metric: payload, decidedAt: new Date(record.createdAt) };
}

/**
 * Sync one realization's verdict from its console, if there is a newer one.
 *
 * Idempotent and a no-op on every call after the first: once `decidedAt`
 * matches the console's own record, nothing is written. Safe to call on every
 * read of a single realization — which is exactly how it is wired, from
 * `GET /api/realizations/:id` — because a person opening a built proof to
 * check on it is precisely the moment "what did this tell us?" should already
 * be answered rather than requiring a separate sync step.
 */
export async function syncRealizationVerdict(db: Db, tenantId: number, row: Row): Promise<Row> {
  if (row.projectId == null) return row;
  // A person's own call always stands — a console recomputing after an idea
  // was parked must not silently resurrect it.
  if (row.verdict === 'abandoned') return row;

  const found = await latestVerdictRecord(db, tenantId, row.projectId);
  if (!found) return row;
  const rowDecidedAt = row.decidedAt ? new Date(row.decidedAt) : null;
  if (row.verdict === found.verdict && rowDecidedAt && rowDecidedAt.getTime() === found.decidedAt.getTime()) {
    return row;
  }

  const updated = await setRealizationVerdict(db, tenantId, row.id, {
    verdict: found.verdict,
    verdictMetric: found.metric,
    decidedAt: found.decidedAt,
  });
  return updated ?? row;
}

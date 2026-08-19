/**
 * The ONE write path into the outcome ledger.
 *
 * Before this, the only writer was an inline `db.insert(...)` in the creation
 * session route — which meant the proof lifecycle (read the idea, choose a
 * proof, build it, grade its kill condition) had nowhere to record itself
 * except by copying that insert into another layer, with its own idea of how
 * long a metadata blob may be and its own spelling of the phase vocabulary.
 *
 * So the insert lives here, in the application layer, and every producer calls
 * it: the session route for canvas actions, `realization/proofOutcomes.ts` for
 * the loop. The normalisation rules — the action charset, the metadata ceiling,
 * the clamping of durations and costs — are part of the contract rather than
 * part of whichever caller happened to be written first.
 *
 * ── IDEMPOTENCE ─────────────────────────────────────────────────────────────
 * `(session, correlation, action, phase)` is unique, so a retried request, a
 * replayed queue message or a double-clicked button converges instead of
 * inflating a denominator. The insert reports whether the row was new so a
 * caller can tell a duplicate from a write.
 *
 * ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
 * It does not authorise. Tenant and actor identity are DERIVED by the caller
 * from the request — never read off the body — and the session-role check that
 * decides who may record what stays in the route that already proved the role.
 * A port that accepted a tenant id from its caller's caller would be a hole in
 * every metric this ledger feeds.
 */

import { and, eq, ne } from 'drizzle-orm';
import { creationOutcomeEvents, creationSessionMembers, creationSessions } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { OUTCOME_PHASES, type OutcomePhase } from './outcomeMetricContract';

/** Metadata larger than this is dropped rather than stored: the ledger is a
 *  measurement record, not a place to park a payload. */
const MAX_METADATA_CHARS = 4_000;

export interface OutcomeEventInput {
  /** Ties `started` to its terminal. Stable across retries of the same action. */
  correlationId: string;
  sessionId: string;
  /** Server-derived. Never accepted from a request body. */
  tenantId: number;
  /** Accepted only when the caller has confirmed the project is linked. */
  projectId?: number | null;
  actorType?: 'user' | 'agent' | 'brain' | 'system';
  actorRef?: string | null;
  action: string;
  phase: OutcomePhase;
  metricKey?: string | null;
  metricValue?: number | null;
  unit?: string | null;
  artifactId?: string | null;
  durationMs?: number | null;
  costUsdMillicents?: number | null;
  metadata?: unknown;
}

export function isOutcomePhase(value: unknown): value is OutcomePhase {
  return typeof value === 'string' && (OUTCOME_PHASES as readonly string[]).includes(value);
}

/** Actions are a vocabulary, not free text: `Artifact Deliver` and
 *  `artifact.deliver` must not become two metrics. */
export function normalizeOutcomeAction(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 64)
    : '';
}

function boundedMetadata(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try {
    return JSON.stringify(value).length > MAX_METADATA_CHARS ? { truncated: true } : value;
  } catch {
    return {};
  }
}

const finite = (value: unknown): number | null => (Number.isFinite(value) ? Number(value) : null);

/**
 * Record one outcome event. Returns `false` when an identical
 * `(session, correlation, action, phase)` row already existed.
 */
export async function recordOutcomeEvent(db: Db, input: OutcomeEventInput): Promise<boolean> {
  const action = normalizeOutcomeAction(input.action);
  if (!input.correlationId || !action || !isOutcomePhase(input.phase)) return false;
  const actorType = input.actorType ?? 'user';
  const duration = finite(input.durationMs);
  const cost = finite(input.costUsdMillicents);
  const [row] = await db
    .insert(creationOutcomeEvents)
    .values({
      correlationId: input.correlationId.slice(0, 128),
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      projectId: input.projectId ?? null,
      actorType,
      actorRef: input.actorRef ? input.actorRef.slice(0, 128) : actorType,
      action,
      phase: input.phase,
      metricKey: input.metricKey ? input.metricKey.slice(0, 80) : null,
      metricValue: finite(input.metricValue),
      unit: input.unit ? input.unit.slice(0, 24) : null,
      artifactId: input.artifactId ? input.artifactId.slice(0, 128) : null,
      durationMs: duration == null ? null : Math.max(0, Math.round(duration)),
      costUsdMillicents: cost == null ? null : Math.max(0, Math.round(cost)),
      metadata: boundedMetadata(input.metadata),
    })
    .onConflictDoNothing()
    .returning({ id: creationOutcomeEvents.id });
  return !!row;
}

/**
 * Resolve a session a producer OUTSIDE the canvas may attribute outcomes to.
 *
 * A proof, a workflow or an integration can all legitimately say "this happened
 * for that board", and every one of them would otherwise re-invent the same
 * check — which is how a metric ends up counting a session in another tenant.
 * A session qualifies only when it is live, in the caller's own tenant, and the
 * caller is a member of it. Anything else resolves to `null`, and the producer
 * records nothing rather than recording it somewhere wrong.
 */
export async function resolveOutcomeSession(
  db: Db,
  args: { tenantId: number; userId: string | null; sessionId: unknown },
): Promise<string | null> {
  if (typeof args.sessionId !== 'string' || !args.sessionId.trim() || !args.userId) return null;
  const sessionId = args.sessionId.trim();
  const [row] = await db
    .select({ id: creationSessions.id })
    .from(creationSessions)
    .where(and(
      eq(creationSessions.id, sessionId),
      eq(creationSessions.tenantId, args.tenantId),
      ne(creationSessions.status, 'deleted'),
    ))
    .limit(1);
  if (!row) return null;
  const [member] = await db
    .select({ userId: creationSessionMembers.userId })
    .from(creationSessionMembers)
    .where(and(eq(creationSessionMembers.sessionId, sessionId), eq(creationSessionMembers.userId, args.userId)))
    .limit(1);
  return member ? sessionId : null;
}

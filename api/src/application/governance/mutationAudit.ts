/**
 * mutationAudit — the ONE audit envelope for governance mutations (PRD 08 §5 / §10).
 *
 * "SecurityAuditLog on every write" used to mean each governance writer decided for itself whether
 * and how to record the write; the generic tracker CRUD, the SOC 2 control patch, evidence attach
 * and the scan / finding / incident writes recorded nothing in a common shape. This module is the
 * single shape and the single writer:
 *
 *   { actor, tenantId, segmentId, entity, entityId, action, before (digest), after (digest), at }
 *
 * It lands in `activity_log` through `recordActivity` — THE audit store (see activityLog.ts) — as
 * verb `governance.<entity>.<action>` with the envelope in `metadata.envelope`. No new table.
 *
 * DIGESTS, NOT BODIES. `before` / `after` are SHA-256 digests of the canonical (key-sorted) JSON of
 * the row, so the log proves WHAT changed (digest differs) and lets an auditor re-derive it from the
 * row, without copying personal data (a DSR's subject email, a suppression value) into a second store.
 *
 * Best-effort like every `recordActivity`: an audit write never fails the mutation it describes.
 */
import { sha256Hex } from '../../domain/shared/hash';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export type MutationAction = 'create' | 'update' | 'delete' | 'execute' | 'run' | 'evidence' | 'open' | 'deliver' | 'accept_risk';

export interface MutationAuditInput {
  actor: ActorIdentity;
  tenantId: number;
  segmentId: string | null;
  /** The thing mutated: a tracker path segment or table-ish name, e.g. 'vuln-scans', 'soc2-control'. */
  entity: string;
  entityId: string | number | null;
  action: MutationAction;
  /** The row before the write (null on create). */
  before?: unknown;
  /** The row after the write (null on delete). */
  after?: unknown;
  at?: Date;
  /** Free-form, non-sensitive context (e.g. a PR url, a scan id). Never row bodies. */
  note?: Record<string, unknown>;
}

export interface MutationAuditEnvelope {
  actor: { type: string; ref: string | null; name: string };
  tenantId: number;
  segmentId: string | null;
  entity: string;
  entityId: string | null;
  action: MutationAction;
  before: string | null;
  after: string | null;
  at: string;
}

/** Canonical JSON: object keys sorted at every depth, so equal rows digest equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v instanceof Date) return v.toISOString();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

/** SHA-256 hex digest of a row's canonical JSON; null for an absent row. */
export async function rowDigest(row: unknown): Promise<string | null> {
  if (row === null || row === undefined) return null;
  return sha256Hex(canonicalJson(row));
}

/** Build the envelope — PURE apart from the digest. The shape every governance mutation shares. */
export async function buildMutationAuditEnvelope(input: MutationAuditInput): Promise<MutationAuditEnvelope> {
  return {
    actor: { type: input.actor.type, ref: input.actor.ref, name: input.actor.name },
    tenantId: input.tenantId,
    segmentId: input.segmentId,
    entity: input.entity,
    entityId: input.entityId === null || input.entityId === undefined ? null : String(input.entityId),
    action: input.action,
    before: await rowDigest(input.before),
    after: await rowDigest(input.after),
    at: (input.at ?? new Date()).toISOString(),
  };
}

/** The verb an envelope is stored under (`activity_log.verb`, 64 chars). */
export const mutationVerb = (entity: string, action: MutationAction): string =>
  `governance.${entity}.${action}`.slice(0, 64);

/** Record one governance mutation. Never throws. */
export async function recordGovernanceMutation(env: Env | undefined, db: Db, input: MutationAuditInput): Promise<void> {
  try {
    const envelope = await buildMutationAuditEnvelope(input);
    await recordActivity(env, db, {
      tenantId: input.tenantId,
      segmentId: input.segmentId,
      actor: input.actor,
      verb: mutationVerb(input.entity, input.action),
      targetType: input.entity.slice(0, 32),
      targetId: envelope.entityId,
      summary: `${input.action} ${input.entity}`,
      metadata: { envelope, ...(input.note ? { note: input.note } : {}) },
      occurredAt: input.at,
    });
  } catch (error) {
    // recordActivity is itself best-effort; a digest failure must not fail the mutation either.
    reportCaughtError(error, { source: 'application/governance/mutationAudit.ts', operation: 'recordGovernanceMutation' });
  }
}

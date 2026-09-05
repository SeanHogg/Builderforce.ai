/**
 * THE LRS STATEMENT STORE — xAPI statements, in `activity_log`.
 *
 * ── WHY THERE IS NO `xapi_statements` TABLE ──────────────────────────────────
 * An xAPI statement is `actor · verb · object` with a result and a time. That is
 * `activity_log`'s shape, column for column, and the coverage map sends both of
 * the source product's statement tables (`xapi_statements`, `lrs_statements`) to
 * the `event_log` primitive. Two tables of events beside the platform's one event
 * store is the shape repetition PRD 20 exists to end.
 *
 * ── THE CONFORMANCE WIN IS AN INDEX THAT ALREADY EXISTED ─────────────────────
 * xAPI requires a statement id to be immutable and a repeated PUT of the same id
 * to be idempotent rather than a duplicate. `idx_activity_log_event_key` is
 * already UNIQUE, and `event_key` is documented as the "stable producer key for
 * retried projections" — so storing the statement id there makes the DATABASE
 * enforce the standard's rule. The alternative is read-then-write, which two
 * concurrent PUTs of the same statement both win.
 *
 * ── THE COLUMN MAPPING ───────────────────────────────────────────────────────
 *   event_key    'xapi:' + statement id     UNIQUE — immutability, for free
 *   actor_type   'learner'                  a new member of the actor union
 *   actor_ref    sha256(actorKey)           64 hex, exactly the column's width
 *   actor_name   the agent's `name`
 *   verb         'xapi.' + the verb's last segment
 *   target_type  'xapi_activity'
 *   target_id    sha256(activity IRI)       an IRI is far wider than 64 chars
 *   target_label the IRI itself             300 chars, which covers real ones
 *   object_id    the course/lesson object    when the IRI resolves to one here
 *   metadata     { statement, verbId, activityId, registration, result }
 *
 * The two hashed columns are there because both an actor identifier and an
 * activity IRI are unbounded strings and both need an INDEXED equality lookup —
 * which is what `idx_activity_log_actor` and `idx_activity_log_target` give,
 * once the value is a fixed width. The originals are never lost: they are in
 * `metadata`, and `metadata.statement` is the exact document that arrived, which
 * is what lets a GET return what was PUT.
 */

import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { activityLog, courses } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { sha256Hex } from '../../infrastructure/crypto/digest';
import { activityDatabase, activityLogVersionKey, toActivityRow, type ActivityInput } from '../activity/activityLog';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { actorKey, type XapiStatement } from '../../domain/learning/xapiStatement';

/** The actor union member for somebody an LRS is recording. Distinct from
 *  'human': a learner is identified by an xAPI inverse-functional identifier,
 *  which is usually an email the platform has no user row for. */
export const LEARNER_ACTOR_TYPE = 'learner';
export const XAPI_VERB_PREFIX = 'xapi.';
export const XAPI_TARGET_TYPE = 'xapi_activity';
/** `event_key` namespace. Prefixed so a statement id can never collide with an
 *  execution outbox key in the same unique index. */
export const XAPI_EVENT_PREFIX = 'xapi:';

/** Statements returned by one GET. The standard lets a client ask for more and
 *  lets an LRS cap it; an uncapped query over an event store is an incident. */
export const DEFAULT_STATEMENT_LIMIT = 50;
export const MAX_STATEMENT_LIMIT = 500;

export interface StoredStatement {
  id: string;
  /** The exact document, as returned to a GET. */
  statement: Record<string, unknown>;
  storedAt: string;
}

export interface StatementQuery {
  statementId?: string;
  /** A canonical actor key, from `actorKey()` — not a raw email. */
  agent?: string;
  verbId?: string;
  activityId?: string;
  registration?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  ascending?: boolean;
}

/**
 * Store a batch of statements.
 *
 * NOT through `recordActivity`, deliberately. That writer is best-effort and
 * swallows failures, which is right for an audit line beside a mutation and wrong
 * here: an LRS that answers 200 to a POST it did not store has failed the one
 * promise the standard makes. So this owns its own insert — and shares the row
 * projection, so the two can only ever disagree about error handling.
 *
 * Conflicts are IGNORED rather than updated: a statement is immutable, so the
 * second arrival of an id is a retry, and an upsert would let a client rewrite
 * history through a channel that must not be able to. The ids returned are the
 * ids ACCEPTED, which for a retry is the same answer as the first time.
 */
export async function storeStatements(
  db: Db, env: Env, tenantId: number, statements: XapiStatement[],
): Promise<{ stored: string[] }> {
  if (statements.length === 0) return { stored: [] };

  // ONE lookup for the whole batch. Resolving each statement's activity as it is
  // mapped would be an N+1 against the busiest write path this surface has.
  const objectIds = await resolveActivityObjects(db, tenantId, statements.map((s) => s.objectId));
  const inputs = await Promise.all(statements.map((s) => toActivityInput(tenantId, s, objectIds.get(s.objectId))));

  // Own insert (strict errors, see above) but NOT its own endpoint: `activity_log` lives
  // on the transactional database, and inserting into the caller's `db` put accepted
  // statements on primary where no reader looks.
  await activityDatabase(env, db).insert(activityLog).values(inputs.map(toActivityRow)).onConflictDoNothing({
    target: activityLog.eventKey,
  });
  await bumpCacheVersion(env, activityLogVersionKey(tenantId));
  return { stored: statements.map((s) => s.id) };
}

/**
 * The activity IRI this LRS issues for one of its own courses.
 *
 * Stated once, and used in both directions: an authoring tool that launches a
 * course is handed this, and a statement that comes back carrying it is matched
 * to the course row. A tenant's own content is therefore reportable, while a
 * third party's IRI is stored verbatim and simply has no local object.
 */
export const COURSE_ACTIVITY_BASE = 'https://builderforce.ai/xapi/activities/course/';

export function courseActivityIri(courseId: number): string {
  return `${COURSE_ACTIVITY_BASE}${courseId}`;
}

/** Which of these activity IRIs are courses in this workspace, as IRI → object
 *  id. What makes an LRS statement show up on the course's own timeline
 *  (`/api/objects/:id/activity`) instead of only in the LRS. */
async function resolveActivityObjects(
  db: Db, tenantId: number, iris: string[],
): Promise<Map<string, string>> {
  const wanted = new Map<number, string>();
  for (const iri of iris) {
    if (!iri.startsWith(COURSE_ACTIVITY_BASE)) continue;
    const id = Number(iri.slice(COURSE_ACTIVITY_BASE.length));
    if (Number.isInteger(id) && id > 0) wanted.set(id, iri);
  }
  if (wanted.size === 0) return new Map();

  const rows = await db.select({ id: courses.id, objectId: courses.objectId })
    .from(courses)
    .where(scopedToTenant(courses, tenantId, inArray(courses.id, [...wanted.keys()]))!);

  return new Map(rows
    .filter((r): r is typeof r & { objectId: string } => r.objectId !== null)
    .map((r) => [wanted.get(r.id)!, r.objectId]));
}

/** One statement's activity row. Exported for the test — the mapping is the part
 *  worth asserting, and it is pure apart from the two digests. */
export async function toActivityInput(
  tenantId: number, statement: XapiStatement, objectId?: string | null,
): Promise<ActivityInput> {
  const [actorRef, targetId] = await Promise.all([
    sha256Hex(actorKey(statement.actor)),
    sha256Hex(statement.objectId),
  ]);

  return {
    tenantId,
    eventKey: `${XAPI_EVENT_PREFIX}${statement.id}`,
    actor: {
      type: LEARNER_ACTOR_TYPE,
      ref: actorRef,
      name: statement.actor.name ?? 'Learner',
    },
    verb: verbFor(statement.verbId),
    targetType: XAPI_TARGET_TYPE,
    targetId,
    targetLabel: statement.objectId,
    objectId: objectId ?? null,
    summary: statement.objectName,
    metadata: {
      statementId: statement.id,
      verbId: statement.verbId,
      verbDisplay: statement.verbDisplay,
      activityId: statement.objectId,
      agent: actorKey(statement.actor),
      registration: statement.registration,
      result: statement.result,
      statement: statement.raw,
    },
    occurredAt: statement.timestamp,
  };
}

/**
 * A verb IRI, shortened to fit `activity_log.verb` (varchar 64).
 *
 * The last path segment is what an IRI's meaning lives in
 * (`…/expapi/verbs/completed`), and the FULL iri is kept in `metadata.verbId`,
 * which is what the query filter matches on. This column is for a human reading
 * the audit timeline and for the coarse grouping the progress rollup does.
 */
export function verbFor(verbId: string): string {
  const tail = verbId.split(/[/#]/).filter(Boolean).pop() ?? 'experienced';
  return `${XAPI_VERB_PREFIX}${tail}`.slice(0, 64);
}

/**
 * Query statements, xAPI-style.
 *
 * `verb`, `activity`, `agent` and `registration` are matched against `metadata`
 * rather than the shortened columns, because those are the values a caller sends
 * and a truncated verb would match two different IRIs. The predicate that leads
 * is always `(tenant_id, actor_type, occurred_at)` — the partial index migration
 * 1112 adds — so a metadata comparison never drives the scan.
 */
export async function queryStatements(
  db: Db, tenantId: number, query: StatementQuery,
): Promise<{ statements: StoredStatement[]; more: boolean }> {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_STATEMENT_LIMIT, 1), MAX_STATEMENT_LIMIT);
  const conds = [eq(activityLog.actorType, LEARNER_ACTOR_TYPE)];

  if (query.statementId) conds.push(eq(activityLog.eventKey, `${XAPI_EVENT_PREFIX}${query.statementId}`));
  if (query.agent) conds.push(sql`${activityLog.metadata}->>'agent' = ${query.agent}`);
  if (query.verbId) conds.push(sql`${activityLog.metadata}->>'verbId' = ${query.verbId}`);
  if (query.activityId) conds.push(sql`${activityLog.metadata}->>'activityId' = ${query.activityId}`);
  if (query.registration) conds.push(sql`${activityLog.metadata}->>'registration' = ${query.registration}`);
  if (query.since) conds.push(gt(activityLog.occurredAt, query.since));
  if (query.until) conds.push(lt(activityLog.occurredAt, query.until));

  const rows = await db.select({
    metadata: activityLog.metadata,
    createdAt: activityLog.createdAt,
  })
    .from(activityLog)
    .where(scopedToTenant(activityLog, tenantId, and(...conds))!)
    .orderBy(query.ascending ? asc(activityLog.occurredAt) : desc(activityLog.occurredAt))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  return {
    more: rows.length > limit,
    statements: page.map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const statement = (meta.statement ?? {}) as Record<string, unknown>;
      return {
        id: String(meta.statementId ?? ''),
        // `stored` is the LRS's own timestamp and the standard says the LRS sets
        // it — so it is added on the way OUT, from the row's `created_at`, rather
        // than stored inside the document where a client could have supplied it.
        statement: { ...statement, stored: row.createdAt.toISOString() },
        storedAt: row.createdAt.toISOString(),
      };
    }),
  };
}

/** One statement by id, or null. The `event_key` unique index answers it. */
export async function getStatement(db: Db, tenantId: number, statementId: string): Promise<StoredStatement | null> {
  const { statements } = await queryStatements(db, tenantId, { statementId, limit: 1 });
  return statements[0] ?? null;
}

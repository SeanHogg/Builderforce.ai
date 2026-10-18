/**
 * Column- and surplus-level retention on DOMAIN tables the SWEPT_TABLES registry may not
 * own.
 *
 * WHY NOT REGISTRY ENTRIES. Membership in `sweptTables.ts` grants a row-age DELETE and a
 * weekly `VACUUM FULL`. `brain_chat_messages`, `creation_session_events` and
 * `creation_session_snapshots` are user-visible conversation / canvas history: no row may
 * be aged out wholesale and none may be exclusively locked for a rewrite. What is safe is
 * shedding the FAT, unreachable part of a row (or rows the UI can no longer list), which
 * is what each entry below does — same idea as `tool_audit_events`' payload `redact`.
 *
 * Every entry is idempotent (its predicate stops matching once applied, so a re-run is a
 * no-op rather than a rewrite of every old page) and BOUNDED to {@link PURGE_BATCH_ROWS}
 * rows per run; a backlog drains over successive nightly ticks.
 *
 * Measured 2026-10-17 on core (504/512 MB): step payloads 75 MB, canvas command bodies
 * 46 MB, surplus snapshot graphs a share of 38 MB.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { PURGE_BATCH_ROWS } from './boundedPurge';

export interface ColumnRetention {
  name: string;
  /** Days before the fat part is shed. */
  afterDays: number;
  rationale: string;
  /** The statement for rows older than `cutoff`, UNEXECUTED so a test can read its SQL. */
  statement: (cutoff: Date) => SQL;
}

/** `timestamp` (no zone) columns hold UTC; compare against an explicit UTC literal. */
const asTimestamp = (cutoff: Date) => sql`${cutoff.toISOString()}::timestamp`;

/**
 * `role:'tool'` step rows: drop `args` and `result` from the metadata JSON (kept: kind,
 * category, label, status, timing, ids — every reader treats both as optional, see
 * brain-embedded `parseStepMessage`). `metadata` is TEXT, so it round-trips through jsonb.
 *
 * The CASE guard is the safety property: Postgres does not order AND terms, and one
 * non-object or `\u0000`-bearing value would make the jsonb cast abort the whole batch
 * every night. Such rows are simply never selected.
 */
export const brainStepPayloadStatement = (cutoff: Date): SQL => sql`
  UPDATE brain_chat_messages
  SET metadata = ((metadata::jsonb) - 'args' - 'result')::text
  WHERE ctid = ANY(ARRAY(
    SELECT ctid FROM brain_chat_messages
    WHERE role = 'tool'
      AND created_at < ${asTimestamp(cutoff)}
      AND CASE
        WHEN left(ltrim(metadata), 1) = '{' AND strpos(metadata, chr(92) || 'u0000') = 0
          THEN (metadata::jsonb) ?| ARRAY['args', 'result']
        ELSE false
      END
    LIMIT ${PURGE_BATCH_ROWS}
  ))`;

/**
 * `canvas.commands_applied` events: replace `payload.commands` (an array — one row held
 * 8.9 MB) with `{count, types}`. The snapshot written in the same transaction holds the
 * resulting state, and the activity feed reads only the event type and revision.
 * Idempotent: once replaced, `commands` is an object, not an array.
 */
export const canvasCommandsStatement = (cutoff: Date): SQL => sql`
  UPDATE creation_session_events
  SET payload = jsonb_set(payload, '{commands}', jsonb_build_object(
    'count', jsonb_array_length(payload->'commands'),
    'types', (SELECT coalesce(jsonb_agg(DISTINCT c->>'type'), '[]'::jsonb) FROM jsonb_array_elements(payload->'commands') AS c)
  ))
  WHERE ctid = ANY(ARRAY(
    SELECT ctid FROM creation_session_events
    WHERE event_type = 'canvas.commands_applied'
      AND created_at < ${asTimestamp(cutoff)}
      AND jsonb_typeof(payload->'commands') = 'array'
    LIMIT ${PURGE_BATCH_ROWS}
  ))`;

/** Snapshots the canvas history panel lists per session (`creationSessionRoutes` GET snapshots). */
export const SNAPSHOT_LIST_LIMIT = 100;

/**
 * Unlabeled snapshots beyond the newest {@link SNAPSHOT_LIST_LIMIT} per session. The UI
 * lists the newest 100 by revision, so these are unreachable. Labeled (named) snapshots
 * are user-authored and always kept, and the newest 100 includes the latest by definition.
 * `cutoff` is unused: the policy is a per-session count, not an age.
 */
export const surplusSnapshotsStatement = (_cutoff: Date): SQL => sql`
  DELETE FROM creation_session_snapshots
  WHERE ctid = ANY(ARRAY(
    SELECT ranked.ctid FROM (
      SELECT ctid, label, row_number() OVER (PARTITION BY session_id ORDER BY revision DESC) AS rn
      FROM creation_session_snapshots
    ) AS ranked
    WHERE ranked.rn > ${SNAPSHOT_LIST_LIMIT} AND ranked.label IS NULL
    LIMIT ${PURGE_BATCH_ROWS}
  ))`;

export const COLUMN_RETENTION: readonly ColumnRetention[] = [
  {
    name: 'brain_chat_messages.step_payloads',
    afterDays: 14,
    rationale: 'Step rows kept 75 MB of args/result (capped 4 KB each) growing ~100 MB/month; nobody reopens a tool payload past two weeks, and the step row itself stays renderable.',
    statement: brainStepPayloadStatement,
  },
  {
    name: 'creation_session_events.commands',
    afterDays: 14,
    rationale: 'Command bodies were 46 MB; the same transaction wrote a snapshot of the resulting graph, so the count and command types are all an activity reader needs.',
    statement: canvasCommandsStatement,
  },
  {
    name: 'creation_session_snapshots.surplus',
    afterDays: 0,
    rationale: 'Graph JSON of unlabeled snapshots past the 100 the UI lists (38 MB table); labeled snapshots are never touched.',
    statement: surplusSnapshotsStatement,
  },
];

export const runColumnRetention = (db: Db, entry: ColumnRetention, cutoff: Date) => db.execute(entry.statement(cutoff));

/**
 * Column-level retention on DOMAIN tables the SWEPT_TABLES registry may not
 * own.
 *
 * WHY NOT REGISTRY ENTRIES. Membership in `sweptTables.ts` grants a row-age DELETE and a
 * weekly `VACUUM FULL`. `brain_chat_messages` and `creation_session_events` are user-visible conversation / canvas history: no row may
 * be aged out wholesale and none may be exclusively locked for a rewrite. What is safe is
 * shedding the FAT, unreachable part of a row, which
 * is what each entry below does — same idea as `tool_audit_events`' payload `redact`.
 *
 * Every entry is idempotent (its predicate stops matching once applied, so a re-run is a
 * no-op rather than a rewrite of every old page) and BOUNDED to {@link REDACT_BATCH_ROWS}
 * rows per run; a backlog drains over successive nightly ticks.
 *
 * Measured 2026-10-17 on core (504/512 MB): step payloads 75 MB, canvas command bodies
 * 46 MB. (Surplus snapshots are NOT capped here: the per-plan maxCreationSessionHistory cap is enforced by pruneHistory in creationSessionRoutes.)
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { REDACT_BATCH_ROWS } from './boundedPurge';

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
 * `role:'tool'` step rows: drop `result` from (`args` is kept so priorResearch can still tell what was run) the metadata JSON (kept: kind,
 * category, label, status, timing, ids — every reader treats both as optional, see
 * brain-embedded `parseStepMessage`). `metadata` is TEXT, so it round-trips through jsonb.
 *
 * The CASE guard is the safety property: Postgres does not order AND terms, and one
 * non-object or `\u0000`-bearing value would make the jsonb cast abort the whole batch
 * every night. Such rows are simply never selected.
 */
export const brainStepPayloadStatement = (cutoff: Date): SQL => sql`
  UPDATE brain_chat_messages
  SET metadata = ((metadata::jsonb) - 'result')::text
  WHERE ctid = ANY(ARRAY(
    SELECT ctid FROM brain_chat_messages
    WHERE role = 'tool'
      AND created_at < ${asTimestamp(cutoff)}
      AND CASE
        WHEN left(ltrim(metadata), 1) = '{' AND strpos(metadata, chr(92) || 'u0000') = 0
          THEN (metadata::jsonb) ? 'result'
        ELSE false
      END
    LIMIT ${REDACT_BATCH_ROWS}
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
    LIMIT ${REDACT_BATCH_ROWS}
  ))`;

export const COLUMN_RETENTION: readonly ColumnRetention[] = [
  {
    name: 'brain_chat_messages.step_payloads',
    afterDays: 14,
    rationale: 'Step rows kept 75 MB of args/result (capped 4 KB each); results are shed, args kept growing ~100 MB/month; nobody reopens a tool payload past two weeks, and the step row itself stays renderable.',
    statement: brainStepPayloadStatement,
  },
  {
    name: 'creation_session_events.commands',
    afterDays: 14,
    rationale: 'Command bodies were 46 MB; the same transaction wrote a snapshot of the resulting graph, so the count and command types are all an activity reader needs.',
    statement: canvasCommandsStatement,
  },
];

export const runColumnRetention = (db: Db, entry: ColumnRetention, cutoff: Date) => db.execute(entry.statement(cutoff));

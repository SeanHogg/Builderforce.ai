/**
 * The SQL form of agent-loop's open/closed ticket rule (`taskClosedState.ts`), built from
 * the SAME list so SQL and TS can never disagree. The ONE place a query spells "this
 * task row is closed": the task list's scope filter (`TaskRepository`) and every done
 * rollup (`SQL_COUNT_DONE`) read it.
 */
import { eq, or, sql, type SQL } from 'drizzle-orm';
import { TASK_CLOSED_STATUSES } from '@builderforce/agent-loop';
import { tasks } from './schema';

/** Leading/trailing whitespace, as JS `String.prototype.trim` strips it (btrim strips spaces only). */
export const EDGE_WHITESPACE = '^[[:space:]]+|[[:space:]]+$';

/** `lower(trim(status)) IN (TASK_CLOSED_STATUSES)` — agent-loop `isClosedTaskStatus` (`status.trim().toLowerCase()`). */
export const closedTaskStatusSql = (): SQL =>
  sql`lower(regexp_replace(${tasks.status}, ${EDGE_WHITESPACE}, '', 'g')) in (${sql.join(TASK_CLOSED_STATUSES.map((s) => sql`${s}`), sql`, `)})`;

/** Archived OR a closed lane — agent-loop `isClosedTask` (an archived ticket reads `archived`, a closed status). */
export const closedTaskSql = (): SQL => or(eq(tasks.archived, true), closedTaskStatusSql()) as SQL;

/**
 * taskScope — shared predicates for scoping the `tasks` population.
 *
 * SYSTEM tasks are operational cards the platform mints for its OWN coordination
 * (currently: the AI Manager's "Backlog management pass" run tasks, `tasks.source =
 * 'manager'`). They are surfaced for visibility (the Manager page + the board) and
 * carry a real lifecycle, but they are NOT delivery work: they must never count toward
 * delivery metrics (throughput, cycle time, completed counts, CAPEX/OPEX allocation),
 * be groomed/ranked/audited by the manager, or be dispatched to a coding agent.
 *
 * `notSystemTask` is the ONE canonical filter for all of that — add it to a metric's
 * task-population WHERE clause so every current AND future delivery read stays clean
 * instead of re-deriving the exclusion (DRY). `is distinct from` deliberately keeps
 * the normal NULL-source tickets in the set (NULL is distinct from 'manager' → true).
 */
import { sql } from 'drizzle-orm';
import { tasks } from '../../infrastructure/database/schema';

/** `tasks.source` values the platform sets on its own coordination cards. */
export const SYSTEM_TASK_SOURCE_MANAGER = 'manager';

/** True for every task EXCEPT platform system/coordination cards. Reusable across
 *  `and(...)` clauses (an immutable SQL fragment). */
export const notSystemTask = sql`${tasks.source} is distinct from ${SYSTEM_TASK_SOURCE_MANAGER}`;

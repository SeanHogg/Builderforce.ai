/**
 * The ONE definition of "an execution that counts".
 *
 * A rehearsal drives the real loop and therefore needs a real `executions` row (audit,
 * steering, cancellation and telemetry all key off `execution_id`). That row must never
 * be mistaken for delivery: it opened no PR, moved no ticket and shipped no code. So
 * every aggregate, funnel, autonomy metric and run list filters `mode = 'live'`, and
 * the predicate lives here rather than as a literal sprinkled across 18 files — the
 * exact failure the gap register logs for tenant isolation (1,127 hand-written
 * predicates, one omission = a bug you cannot see).
 *
 * A cloud SUB-AGENT (1209, `parent_execution_id` set) is excluded for the same reason:
 * it is a slice of its parent's run, not a run of its own. Counting it would make one
 * delegated fan-out read as five runs on the ticket, five in-flight items, five
 * strikes toward the autonomy cap.
 *
 * Single-row reads BY ID deliberately do NOT filter: an operator opening a rehearsal's
 * execution should see it. It is the LIST and AGGREGATE reads that must exclude it.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { executions } from '../../infrastructure/database/schema';

export const EXECUTION_MODES = ['live', 'rehearsal'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/**
 * The predicate for "real work only". Compose it into any list/aggregate over
 * `executions`:
 *
 *   .where(and(eq(executions.tenantId, tenantId), liveExecution()))
 */
export function liveExecution() {
  return and(eq(executions.mode, 'live'), isNull(executions.parentExecutionId))!;
}

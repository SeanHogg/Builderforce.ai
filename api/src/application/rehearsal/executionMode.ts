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
 * Single-row reads BY ID deliberately do NOT filter: an operator opening a rehearsal's
 * execution should see it. It is the LIST and AGGREGATE reads that must exclude it.
 */

import { eq } from 'drizzle-orm';
import { executions } from '../../infrastructure/database/schema';

export const EXECUTION_MODES = ['live', 'rehearsal'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export function isExecutionMode(v: unknown): v is ExecutionMode {
  return typeof v === 'string' && (EXECUTION_MODES as readonly string[]).includes(v);
}

/**
 * The predicate for "real work only". Compose it into any list/aggregate over
 * `executions`:
 *
 *   .where(and(eq(executions.tenantId, tenantId), liveExecution()))
 */
export function liveExecution() {
  return eq(executions.mode, 'live');
}

/** Its complement — the rehearsal-only reads (the Rehearsal tab). */
export function rehearsalExecution() {
  return eq(executions.mode, 'rehearsal');
}

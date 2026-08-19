/**
 * A REQUEST-SCOPED memo of `RuntimeService.listByTask`, and nothing more.
 *
 * ── WHAT IT IS FOR (DISP-R1) ────────────────────────────────────────────────
 * The re-dispatch breaker lives at the ONE dispatch choke point — every
 * autonomous dispatcher goes through `dispatchCloudRunForTask`, which derives
 * `assessRerunBackoff` from the ticket's execution list itself. That is the
 * property that made a whole class of bug impossible: no dispatch path can opt
 * out of the breaker, because opting out would mean bypassing the dispatcher.
 *
 * The lane trigger pays for it twice. `evaluateTaskAutoRun` loads the same list a
 * moment earlier (it needs it for the live-run check and to REPORT the breaker
 * state in triage), so a lane-trigger dispatch queries executions once to decide
 * and once to enforce.
 *
 * ── WHY A MEMO OF ROWS, NOT A PASSED-IN VERDICT ─────────────────────────────
 * The obvious fix — let the caller hand `dispatchCloudRunForTask` the backoff
 * verdict it already computed — reintroduces exactly the defect the choke point
 * removed: a dispatch path could then supply a verdict of "not blocked" and the
 * breaker would believe it. Measured cost of that class of bug on task 467: 134
 * runs, all dying on the same cloud-run-cap message, on a five-minute cadence,
 * with a three-strike breaker sitting right there unable to see them.
 *
 * So what is shared is the ROWS. The dispatcher still calls `assessRerunBackoff`
 * on them itself, every time, and reaches the same conclusion it would have from
 * its own query. A caller can save the dispatcher a round trip; it cannot change
 * the dispatcher's mind.
 *
 * ── WHY THIS IS NOT A CACHE ─────────────────────────────────────────────────
 * Live execution status is precisely what the breaker is reading, so a cached
 * answer is a wrong answer. This object has no TTL, no store and no key beyond a
 * task id, and it is created and discarded inside ONE dispatch attempt — the rows
 * it serves were read microseconds earlier in the same call stack. Nothing keeps
 * it alive across requests, and there is deliberately no way to make one that
 * outlives its request: {@link createExecutionReadMemo} allocates a new Map every
 * call and never registers it anywhere.
 */

import type { RuntimeService } from './RuntimeService';

/** The plain execution shape both the evaluator and the breaker read. */
export type PlainExecution = ReturnType<Awaited<ReturnType<RuntimeService['listByTask']>>[number]['toPlain']>;

export interface ExecutionReadMemo {
  /**
   * The task's executions, newest-first — loaded once per task per memo.
   *
   * Concurrent callers for the same task share the in-flight promise rather than
   * racing to issue two queries, which is the single-flight property that makes
   * this worth having on a sweep that fans out.
   */
  listByTask(taskId: number): Promise<PlainExecution[]>;
}

export function createExecutionReadMemo(runtimeService: RuntimeService): ExecutionReadMemo {
  const inFlight = new Map<number, Promise<PlainExecution[]>>();
  return {
    listByTask(taskId: number): Promise<PlainExecution[]> {
      const existing = inFlight.get(taskId);
      if (existing) return existing;
      const p = runtimeService.listByTask(taskId)
        .then((rows) => rows.map((e) => e.toPlain()) as PlainExecution[])
        // A failed read must not poison the memo: the next caller re-queries
        // rather than inheriting a rejected promise for the rest of the request.
        .catch((err) => { inFlight.delete(taskId); throw err; });
      inFlight.set(taskId, p);
      return p;
    },
  };
}

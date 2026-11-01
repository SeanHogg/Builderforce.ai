/**
 * turnTail - what the last request's volatile tail cost, so a model hand-off can charge it.
 *
 * The tail (the context pack, the memory brief and the surface's own sections, `withVolatileTail`) rides LAST on every request and
 * is never part of the transcript, so the compaction policy does not see it. The kernel measures it as it builds a request and the
 * hand-off reads the figure when the serving model changes: the next request carries a tail about as large as the last one did.
 * Keyed by the run's state, so nothing is persisted and nothing in the run's shape changes.
 */

import { defaultEstimateTokens, isVolatileTail, messageTokens } from "./policy/compaction/pack.js";
import type { RunMessage } from "./contract.js";

const measured = new WeakMap<object, number>();

/** Record the volatile tail of a request just built (none ⇒ 0), and hand the request back. */
export function measureTurnTail(state: object, request: RunMessage[]): RunMessage[] {
  const last = request.at(-1);
  measured.set(state, last !== undefined && isVolatileTail(last) ? messageTokens(last, defaultEstimateTokens) : 0);
  return request;
}

/** The tokens the volatile tail of the run's latest request cost (0 before the first request). */
export function turnTailTokens(state: object): number {
  return measured.get(state) ?? 0;
}

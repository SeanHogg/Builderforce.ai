/**
 * THE Insights AI budget (PRD 33 §8 S4c; reused by S4e prescriptions and S4f page
 * review): a per-tenant daily ceiling on model calls, counted in KV with the same
 * shape as `VisitorEventService.withinIpBudget` / `withinReplayIpBudget`.
 *
 * A call is counted only when it is about to reach the model — a cached answer is
 * free. Over the limit the route answers 429 `{ error: 'limit' }`
 * (`ReplayAiLimitErrorDto`). KV trouble fails OPEN, like the other budgets: a
 * counter outage must not take summaries away from a paying workspace.
 */

import type { Env } from '../../env';
import { DomainError } from '../../domain/shared/errors';
import { replayAiBudgetKey } from './replayCacheKeys';

/** Summaries (visit + segment) one workspace may generate per UTC day. */
export const REPLAY_SUMMARY_DAILY_LIMIT = 200;

/** Thrown when the day's budget is spent; routes map it to 429 `{ error: 'limit' }`. */
export class ReplayAiLimitError extends DomainError {
  /** Read by `statusOf`, so even an uncaught one answers 429 rather than 500. */
  readonly status = 429;
  constructor() {
    super('The daily Insights AI limit is reached');
    this.name = 'ReplayAiLimitError';
  }
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10).replace(/-/g, '');

/** Take one unit of the tenant's daily budget; false when it is spent. */
export async function withinReplayAiBudget(
  env: Env | undefined,
  tenantId: number,
  opts: { limit?: number; now?: Date } = {},
): Promise<boolean> {
  const kv = env?.AUTH_CACHE_KV;
  if (!kv) return true;
  const key = replayAiBudgetKey(tenantId, utcDay(opts.now ?? new Date()));
  try {
    const current = Number((await kv.get(key)) ?? '0');
    if (current >= (opts.limit ?? REPLAY_SUMMARY_DAILY_LIMIT)) return false;
    await kv.put(key, String(current + 1), { expirationTtl: 86_400 });
  } catch {
    return true;
  }
  return true;
}

/** {@link withinReplayAiBudget}, throwing {@link ReplayAiLimitError} when spent. */
export async function takeReplayAiBudget(env: Env | undefined, tenantId: number, opts: { limit?: number; now?: Date } = {}): Promise<void> {
  if (!(await withinReplayAiBudget(env, tenantId, opts))) throw new ReplayAiLimitError();
}

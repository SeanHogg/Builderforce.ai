/**
 * A KV marker that keeps the batch tick off the operational database when there is no
 * deferred work — the same autosuspend argument as `cronWorkSignal.ts`, one level down:
 * the frequent tick may be open for other sweeps, and an idle queue must not wake the
 * endpoint the queue lives on.
 *
 * Every enqueue refreshes the marker; it expires {@link MARKER_TTL_SECONDS} after the
 * last one — past the 24h SLA plus slack, so the last job is always settled or run
 * synchronously before the tick stops looking. Never deleted early: a delete racing an
 * enqueue could strand a job. Fails OPEN (unbound KV or a read error ⇒ run the tick).
 */
import type { Env } from '../../../env';
import { reportCaughtError } from '../../observability/caughtErrorReporter';

const MARKER_KEY = 'llm-batch:open';
/** 26h: the 24h SLA, plus two hours for the tick that runs the last overdue job. */
export const MARKER_TTL_SECONDS = 26 * 60 * 60;

export async function markBatchWork(env: Env): Promise<void> {
  const kv = env.AUTH_CACHE_KV;
  if (!kv) return;
  try {
    await kv.put(MARKER_KEY, String(Date.now()), { expirationTtl: MARKER_TTL_SECONDS });
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/batch/batchWorkMarker.ts', operation: 'markBatchWork', level: 'warning' });
  }
}

export async function hasBatchWork(env: Env): Promise<boolean> {
  const kv = env.AUTH_CACHE_KV;
  if (!kv) return true;
  try {
    return (await kv.get(MARKER_KEY)) !== null;
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/batch/batchWorkMarker.ts', operation: 'hasBatchWork', level: 'warning' });
    return true;
  }
}

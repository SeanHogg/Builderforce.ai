/**
 * AVOIDED calls — a model call memory stood in for, recorded on the usage ledger.
 *
 * There is no savings table and no savings endpoint. A saving is written by the ONE
 * usage writer ({@link recordUsageRow}), on a request that is already happening:
 *
 *   • per-call figures (compaction trimmed N prompt tokens, recall added M) ride the
 *     `metadata.memory` the run loop already sends with each model call, and the writer
 *     stamps them on that call's own row;
 *   • an AVOIDED call is recorded HERE, by the request that served the answer instead —
 *     `GET /api/projects/:id/answer` for a memory / Evermind answer, and the tenant
 *     completion seam for a gateway replay. The row has `calls = 0` and zero tokens and
 *     cost, so no spend total or request count moves; only the `saved_*` columns do.
 *
 * Measured vs estimated is recorded, never guessed at read time: a replay of an answer
 * whose production cost was stored with it, or of a gateway response that still carries
 * its upstream usage, is MEASURED; an Evermind answer (no paid model produced it) and
 * an answer cached before costs were recorded are ESTIMATED from characters.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { isUsageSurface, recordUsageRow, type UsageSavings, type UsageSurface } from './usageLedger';

/** What can stand in for a model call. */
/** local_model is a REAL call on the person's machine (PRD 36), never an avoided one. */
export type AvoidedCallSource = Exclude<NonNullable<UsageSavings['source']>, 'local_model'>;

/**
 * A caller-supplied surface, or `web` — the same default the usage ledger records.
 * Trusting the hint is safe here, unlike the gateway's BYO exemption: an avoided-call
 * row carries no spend, so a claimed surface cannot dodge a cap.
 */
export function normalizeUsageSurface(raw: unknown): UsageSurface {
  return isUsageSurface(raw) ? raw : 'web';
}

export interface AvoidedCall {
  tenantId: number;
  userId?: string | null;
  projectId?: number | null;
  chatId?: number | null;
  surface?: UsageSurface | null;
  source: AvoidedCallSource;
  /** The model the avoided call would have run on — what its saving is priced at.
   *  Unknown ⇒ the saved tokens are recorded and valued at nothing. */
  model?: string | null;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
}

/**
 * Sources whose `calls = 0` row means a request was ANSWERED WITHOUT A MODEL — the
 * exact / semantic response cache and single-flight followers (`response_cache`), a
 * memory or Evermind answer replay, and the deterministic step (D7). THE list the cost
 * metrics' `servedWithoutModel` counts, so a new stand-in is added in one place.
 */
export const SERVED_WITHOUT_MODEL_SOURCES: readonly AvoidedCallSource[] = ['response_cache', 'memory_answer', 'evermind_answer', 'deterministic'];

/**
 * Count a request that was answered without a model but has no measurable saving to
 * record (a deterministic answer; a cache hit whose original usage was not stored) — a
 * `calls = 0` row with zero tokens, zero cost and zero saved tokens, so no spend, request
 * count or savings total moves. Best-effort, like every usage write.
 */
export function recordServedWithoutModel(
  db: Db,
  env: Env,
  served: { tenantId: number; userId?: string | null; projectId?: number | null; source: AvoidedCallSource; model?: string | null },
): Promise<void> {
  return recordUsageRow(db, env, {
    tenantId: served.tenantId,
    userId: served.userId ?? null,
    llmProduct: 'memory',
    model: served.model?.trim() || 'unknown',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    useCase: served.source,
    attribution: { projectId: served.projectId ?? null },
    surface: 'web',
    calls: 0,
    savings: { source: served.source, savedPromptTokens: 0, savedCompletionTokens: 0, estimated: true },
  });
}

/** Record one avoided call. Best-effort, like every usage write. */
export function recordAvoidedCall(db: Db, env: Env, call: AvoidedCall): Promise<void> {
  if (call.promptTokens + call.completionTokens <= 0) return Promise.resolve();
  return recordUsageRow(db, env, {
    tenantId: call.tenantId,
    userId: call.userId ?? null,
    llmProduct: 'memory',
    model: call.model?.trim() || 'unknown',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    useCase: call.source,
    // `chatId` rides metadata exactly as a real call's does, so the one chat-attribution
    // rule promotes it to the column.
    metadata: call.chatId != null ? { chatId: call.chatId } : null,
    attribution: { projectId: call.projectId ?? null },
    surface: call.surface ?? 'web',
    calls: 0,
    savings: {
      source: call.source,
      savedPromptTokens: call.promptTokens,
      savedCompletionTokens: call.completionTokens,
      estimated: call.estimated,
    },
  });
}

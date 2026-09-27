/**
 * evermindDeltaLearn — the gateway's HTTP answers for the pre-diffed weight-delta door
 * (`POST /api/{projects,agent/projects}/:id/evermind/learn`).
 *
 * The wire contract itself (payload shape, size cap, per-delta structural check) is
 * the engine's (`parseDeltaLearnPayload`, `deltaUnusableReason` in
 * `@seanhogg/builderforce-memory-engine`), shared with the on-prem producer. What stays
 * here is what only this gateway decides: which HTTP status each refusal gets, and the
 * admission rule against the project's CURRENT head.
 */
import type { DeltaParseResult } from '@seanhogg/builderforce-memory-engine';

/** The HTTP status for a refused delta body. */
export function deltaParseStatus(reason: Extract<DeltaParseResult, { ok: false }>['reason']): 400 | 413 {
  return reason === 'too-large' ? 413 : 400;
}

/** Why a delta was not admitted, as the HTTP answer the producer branches on. */
export interface DeltaRefusal {
  status: 409 | 423;
  body: Record<string, unknown>;
}

/**
 * Admit a parsed delta against the CURRENT head, or say why not. Pure.
 *
 * Order matters: an unseeded project has no base to be stale against, and a frozen
 * one rejects every write whatever its base — neither is fixed by rebasing, so both
 * are answered before the stale check. The stale refusal names `headVersion` because
 * a producer cannot rebase without being told what to rebase ONTO.
 */
export function admitDeltaAgainstHead(
  payload: { baseVersion: number },
  head: { version: number; mode: string },
): DeltaRefusal | null {
  if (head.version === 0) {
    return { status: 409, body: { ok: false, error: 'project Evermind not seeded — no base model to learn against' } };
  }
  if (head.mode === 'offline-frozen') {
    return { status: 423, body: { ok: false, error: 'project Evermind is offline-frozen (read-only); learning disabled', mode: head.mode } };
  }
  if (payload.baseVersion !== head.version) {
    return { status: 409, body: { ok: false, error: 'stale base — rebase against current head', headVersion: head.version } };
  }
  return null;
}

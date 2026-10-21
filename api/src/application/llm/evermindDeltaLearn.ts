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
  status: 400 | 409 | 413 | 423;
  body: Record<string, unknown>;
}

/**
 * The answer to a body `parseDeltaLearnPayload` refused — the SAME `{ ok: false, error }`
 * shape every other delta-door refusal has, from the gateway route and from the
 * coordinator alike. That includes a delta aimed at an ML head (`target: 'ml:<task>'`):
 * the engine's parse (≥ 2026.10.2) refuses any target at this door, which merges into
 * the model checkpoint only, so it never reaches the LM merge.
 */
export function deltaParseRefusal(refused: Extract<DeltaParseResult, { ok: false }>): DeltaRefusal {
  return { status: deltaParseStatus(refused.reason), body: { ok: false, error: refused.error } };
}

/**
 * The answer to a merge the held-out gate refused (`gateEvermindMerge`: the merged
 * model's mean eval loss rose above the base's) — the SAME `{ ok: false, error }` shape
 * as every other refusal here, carrying both losses so the console can say by how much.
 * 409: the batch conflicts with what the head already knows; nothing was published.
 */
export function mergeRegressionRefusal(losses: { baseLoss: number | null; newLoss: number | null }): DeltaRefusal {
  const fmt = (l: number | null): string => (l == null ? 'unknown' : l.toFixed(4));
  return {
    status: 409,
    body: {
      ok: false,
      error: `merge refused — held-out eval loss rose from ${fmt(losses.baseLoss)} to ${fmt(losses.newLoss)}`,
      baseLoss: losses.baseLoss,
      newLoss: losses.newLoss,
    },
  };
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

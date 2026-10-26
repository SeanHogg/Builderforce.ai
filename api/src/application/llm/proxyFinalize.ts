/**
 * `finalize` — the single seam every result leaves `complete()` through. Split out
 * of `LlmProxyService.ts`.
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';
import { instrumentStream } from './streamDiagnostics';
import { recordFailures } from '../../infrastructure/auth/cooldownStore';
import { classificationFromFailovers } from './proxyFailover';
import type { ProxyResult } from './proxyTypes';
import type { ProxyConfig } from './proxyConfig';
import type { ProxyFunding } from './proxyFunding';

/** Candidates the stream's terminal frame names — the head of the chain is what routing
 *  decided; the tail is the plan pool every request ends in. */
const MAX_REPORTED_CANDIDATES = 8;

/** Stamp request-level diagnostics onto a ProxyResult before it leaves
 *  complete(). Single place that owns the trace id, total duration, candidate
 *  chain, final status, rolled-up classification, and outcome — so every
 *  return path (strict / cooldown / dispatched) is uniform. */
export function finalizeProxyResult(
  cfg: ProxyConfig,
  funding: ProxyFunding,
  result: ProxyResult,
  traceId: string,
  startedAt: number,
  candidateChain: readonly string[],
  outcomeOverride?: string,
): ProxyResult {
  result.traceId = traceId;
  result.durationMs = Date.now() - startedAt;
  result.status = result.response.status;
  if (!result.candidateChain) result.candidateChain = [...candidateChain];
  if (!result.classification) result.classification = classificationFromFailovers(result.failovers);
  if (outcomeOverride) result.outcome = outcomeOverride;
  else if (!result.outcome) result.outcome = result.response.status < 400 ? 'success' : 'cascade_exhausted';
  // Stamp the tenant-funding signal once, on the single path every result
  // leaves complete() through, so the route can mark the usage row `byo`.
  if (result.byoFunded === undefined) result.byoFunded = funding.isTenantFunded(result);
  if (result.platformSurcharge === undefined) {
    result.platformSurcharge = cfg.openRouterConnectionModels.has(result.resolvedModel);
  }
  return instrumentStreamingResult(cfg, funding, result, traceId);
}

/**
 * Attach the two things a STREAM could not previously report.
 *
 * Done HERE rather than in `dispatchStream` because `finalize` is the single seam
 * every result leaves `complete()` through — and it is the first point at which the
 * trace id exists, which is the id a caller quotes back. A non-streaming result and
 * an error envelope both pass through untouched.
 *
 *   • `failovers[]` — a JSON completion carries them in its envelope; a stream had
 *     nowhere to put them, so a run that burned four models before succeeding looked
 *     identical to one that answered first try. Now a terminal SSE frame carries them.
 *   • EMPTY-BUT-200 — `dispatchVendor`'s `validate` hook catches this on the JSON
 *     path, but it cannot on a stream: it runs before any bytes exist, and the
 *     headers are already sent. The model was therefore never cooled and the next
 *     request picked it straight back up. The emptiness is now observed when the
 *     stream ENDS, and cooled then.
 */
function instrumentStreamingResult(
  cfg: ProxyConfig,
  funding: ProxyFunding,
  result: ProxyResult,
  traceId: string,
): ProxyResult {
  const body = result.response.body;
  const isSse = (result.response.headers.get('content-type') ?? '').includes('text/event-stream');
  if (!body || !isSse || result.response.status >= 400) return result;

  const instrumented = instrumentStream(body, {
    payload: {
      failovers: result.failovers.map((f) => ({
        model: f.model, vendor: f.vendor, code: f.code, ...(f.kind ? { kind: f.kind } : {}),
      })),
      resolvedModel: result.resolvedModel,
      resolvedVendor: result.resolvedVendor,
      // The order this request walked, so a run can tell a coder that was never seeded
      // (or seeded behind another) from one that was tried and refused (`failovers`).
      ...(result.candidateChain?.length ? { candidates: result.candidateChain.slice(0, MAX_REPORTED_CANDIDATES) } : {}),
      traceId,
    },
    onEmptyStream: () => {
      // Same `embedded:` hint the JSON path uses, so this lands in the 5-minute
      // `embedded` cooldown class rather than the 30-minute auth one — the model
      // answered, it just answered with nothing. Fire-and-forget by necessity: the
      // response was returned long ago and this is the last moment the fact exists.
      // An owner-served model is exempt for the usual reason (the keyspace is global
      // and cannot speak for one tenant's own credential).
      if (funding.isOwnerServedModel(result.resolvedModel)) return;
      void recordFailures(cfg.env, [{
        vendor: result.resolvedVendor,
        model: result.resolvedModel,
        status: 502,
        hint: `embedded:empty: stream closed with no content for ${result.resolvedVendor}/${result.resolvedModel}`,
      }]).catch((error) => {
        reportCaughtError(error, { source: 'application/llm/LlmProxyService.ts', operation: 'onEmptyStream' });
      });
    },
  });
  result.response = new Response(instrumented, {
    status: result.response.status,
    headers: result.response.headers,
  });
  return result;
}

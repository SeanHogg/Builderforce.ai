/**
 * Provider-webhook ingest — verify, de-replay, translate, then hand off to the
 * ONE feedback write path.
 *
 * This module exists so the webhook route stays a thin shell and, more
 * importantly, so a provider import cannot become a SECOND ingest path. Everything
 * that makes a feedback submission what it is — the collector's rolling-24h abuse
 * ceiling, the tenant's monthly plan quota, duplicate collapse, and the human
 * approval gate that keeps an external request off an agent until someone accepts
 * it — lives in `submitFeedback`. An importer that inserted rows itself would be a
 * parallel set of rules to keep in step, and the first thing to fall out of step
 * would be the gate.
 *
 * ── THE TWO THINGS THIS PATH ADDS ───────────────────────────────────────────
 * 1. AUTHENTICATION. A webhook URL is guessable in a way an ingest key is not, and
 *    it opens tickets. Every delivery must carry a valid signature over the RAW
 *    body, computed with the tenant's stored secret. An integration with no secret
 *    configured accepts NOTHING (`not_configured`) — deliberately unlike the error
 *    -ingest webhook, which tolerates unsigned providers. Feedback writes to a
 *    human's board; there is no payload here worth accepting unauthenticated.
 * 2. REPLAY SAFETY. Senders retry. Dedupe is keyed on the PROVIDER's event id and
 *    enforced by a unique index rather than a lookup, so two concurrent retries
 *    cannot both pass a read-then-write check.
 *
 * Outcomes are semantic, not HTTP: the route owns the status-code mapping, because
 * "which number means unknown provider" is a presentation decision and this layer
 * must stay callable from a test with no `Response` in sight.
 */

import { and, eq } from 'drizzle-orm';
import {
  feedbackCollectorIntegrations, feedbackCollectors, feedbackWebhookDeliveries,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { isUniqueViolation } from '../../infrastructure/database/uniqueViolation';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { sha256Hex } from '../../domain/shared/hash';
import { credentialSecret, decryptCredentials } from '../integrations/credentialCrypto';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getFeedbackProvider, type HeaderGetter } from './feedbackProviders';
import { submitFeedback, type SubmitQuotaExceeded } from './feedbackEngine';

/**
 * Why a delivery did not become a submission, or that it did.
 *
 * Every refusal is named rather than collapsed into a boolean, because the four
 * refusals want four different reactions from the SENDER: a bad provider id is a
 * permanent misconfiguration, a bad signature is a permanent auth failure, a
 * duplicate is a success the sender should stop retrying, and a quota refusal is
 * the one case where retrying later is exactly right.
 */
export type FeedbackWebhookOutcome =
  | { kind: 'unknown_provider' }
  | { kind: 'unknown_collector' }
  /** No integration row, or it is paused. */
  | { kind: 'not_connected' }
  /** Connected, but no secret has been set — nothing can be authenticated yet. */
  | { kind: 'not_configured' }
  | { kind: 'invalid_signature' }
  | { kind: 'invalid_body' }
  /** Already handled; the sender is retrying a delivery we accepted before. */
  | { kind: 'duplicate'; eventId: string }
  /** Authentic and new, but the adapter does not import this kind of event. */
  | { kind: 'ignored'; eventId: string }
  /** One of the two ingest ceilings refused it — retrying later can succeed. */
  | { kind: 'rate_limited' }
  | ({ kind: 'quota_exceeded' } & Omit<SubmitQuotaExceeded, 'quotaExceeded'>)
  | { kind: 'accepted'; eventId: string; submissionIds: string[]; taskIds: Array<number | null>; deduped: number };

export interface FeedbackWebhookRequest {
  collectorId: string;
  provider: string;
  /** The EXACT bytes the signature covers. Never a re-serialised object. */
  rawBody: string;
  getHeader: HeaderGetter;
}

/**
 * Handle one inbound provider delivery end to end.
 *
 * Ordering is deliberate: the signature is checked BEFORE the body is parsed and
 * before any row is written, so an unauthenticated caller cannot make us do work
 * (or grow a dedupe table) by posting garbage at a guessed URL.
 */
export async function ingestFeedbackWebhook(
  db: Db,
  env: Env,
  req: FeedbackWebhookRequest,
): Promise<FeedbackWebhookOutcome> {
  const adapter = getFeedbackProvider(req.provider);
  if (!adapter) return { kind: 'unknown_provider' };

  const [collector] = await db
    .select({
      id: feedbackCollectors.id,
      tenantId: feedbackCollectors.tenantId,
      projectId: feedbackCollectors.projectId,
      enabled: feedbackCollectors.enabled,
      autoCreateTask: feedbackCollectors.autoCreateTask,
      dailyLimit: feedbackCollectors.dailyLimit,
    })
    .from(feedbackCollectors)
    .where(eq(feedbackCollectors.id, req.collectorId))
    .limit(1);
  if (!collector || !collector.enabled) return { kind: 'unknown_collector' };

  const [integration] = await db
    .select({
      id: feedbackCollectorIntegrations.id,
      enabled: feedbackCollectorIntegrations.enabled,
      secretEnc: feedbackCollectorIntegrations.secretEnc,
      secretIv: feedbackCollectorIntegrations.secretIv,
    })
    .from(feedbackCollectorIntegrations)
    .where(and(
      eq(feedbackCollectorIntegrations.collectorId, req.collectorId),
      eq(feedbackCollectorIntegrations.provider, adapter.id),
      eq(feedbackCollectorIntegrations.tenantId, collector.tenantId),
    ))
    .limit(1);
  if (!integration || !integration.enabled) return { kind: 'not_connected' };
  if (!integration.secretEnc || !integration.secretIv) return { kind: 'not_configured' };

  const blob = await decryptCredentials(
    integration.secretEnc,
    integration.secretIv,
    // The canonical base-secret resolution, not a local copy — the write side
    // (feedbackRoutes) seals with the same function, and a second reading of
    // "which env var seals credentials" makes stored secrets undecryptable.
    credentialSecret(env),
    collector.tenantId,
  );
  const secret = typeof blob?.secret === 'string' ? blob.secret : '';
  // A secret we cannot decrypt is treated as a failed signature, not as an open
  // door: the alternative — falling through to "no secret, accept it" — is how an
  // encryption-key rotation would silently turn a guarded endpoint public.
  if (!secret || !(await adapter.verify(req.rawBody, req.getHeader, secret))) {
    return { kind: 'invalid_signature' };
  }

  let payload: unknown;
  try { payload = JSON.parse(req.rawBody); } catch { return { kind: 'invalid_body' }; }

  // The provider's own delivery id when it sends one; otherwise the body's digest,
  // which is the best available stand-in — a byte-identical retry still collapses.
  const eventId = (adapter.eventId(payload, req.getHeader) ?? await sha256Hex(req.rawBody)).slice(0, 200);

  // Claim the delivery BEFORE doing the work. Insert-first is what makes this safe
  // under concurrency: a read-then-write check loses the race where two retries
  // both read "not seen" and both open a ticket.
  let deliveryId: string;
  try {
    const [row] = await db
      .insert(feedbackWebhookDeliveries)
      .values({
        tenantId: collector.tenantId,
        collectorId: collector.id,
        provider: adapter.id,
        eventId,
      })
      .returning({ id: feedbackWebhookDeliveries.id });
    if (!row) return { kind: 'duplicate', eventId };
    deliveryId = row.id;
  } catch (error) {
    if (isUniqueViolation(error, 'uq_feedback_webhook_delivery')) return { kind: 'duplicate', eventId };
    throw error;
  }

  const submissions = adapter.normalize(payload);
  // An event we do not import still keeps its delivery row, so the sender's
  // retries of it cost one index hit instead of re-running the adapter each time.
  if (submissions.length === 0) return { kind: 'ignored', eventId };

  const submissionIds: string[] = [];
  const taskIds: Array<number | null> = [];
  let deduped = 0;
  for (const feedback of submissions) {
    const result = await submitFeedback(db, env, {
      collectorId: collector.id,
      tenantId: collector.tenantId,
      projectId: collector.projectId,
      autoCreateTask: collector.autoCreateTask,
      // The webhook is a PUBLIC door on the same collector, so it answers to the
      // same rolling-24h abuse ceiling as the snippet. A provider that starts
      // firing in a loop is exactly the burst that ceiling is for.
      dailyLimit: collector.dailyLimit,
    }, feedback);

    // A refusal must NOT leave the delivery claimed: the sender's retry is how the
    // request gets in once the ceiling clears, and a claimed row would turn every
    // one of those retries into a silent "duplicate" that drops the request.
    if ('quotaExceeded' in result) {
      await releaseDelivery(db, collector.tenantId, deliveryId);
      return { kind: 'quota_exceeded', effectivePlan: result.effectivePlan, used: result.used, limit: result.limit };
    }
    if ('rateLimited' in result && result.rateLimited && !('submissionId' in result)) {
      await releaseDelivery(db, collector.tenantId, deliveryId);
      return { kind: 'rate_limited' };
    }
    if ('submissionId' in result) {
      submissionIds.push(result.submissionId);
      taskIds.push(result.taskId);
      if (result.deduped) deduped++;
    }
  }

  // Both writes carry the tenant predicate even though the primary key already
  // pins the row. The id came from a PUBLIC request path, and a scope that is only
  // implied is a scope that stops holding the moment someone reuses this code with
  // an id they did not derive themselves.
  await db
    .update(feedbackWebhookDeliveries)
    .set({ submissionId: submissionIds[0] ?? null })
    .where(scopedToTenant(feedbackWebhookDeliveries, collector.tenantId, eq(feedbackWebhookDeliveries.id, deliveryId)))
    .catch((error) => {
      reportCaughtError(error, { source: 'application/feedback/feedbackWebhookIngest.ts', operation: 'linkDelivery' });
    });
  await db
    .update(feedbackCollectorIntegrations)
    .set({ lastEventAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(feedbackCollectorIntegrations, collector.tenantId, eq(feedbackCollectorIntegrations.id, integration.id)))
    .catch((error) => {
      reportCaughtError(error, { source: 'application/feedback/feedbackWebhookIngest.ts', operation: 'touchIntegration' });
    });

  return { kind: 'accepted', eventId, submissionIds, taskIds, deduped };
}

/**
 * Un-claim a delivery a ceiling refused, so the sender's retry is treated as new
 * work rather than as an already-handled duplicate. Best-effort: failing to release
 * costs one dropped retry, whereas throwing here would turn a soft refusal into a
 * 500 the provider backs off from far harder.
 */
async function releaseDelivery(db: Db, tenantId: number, deliveryId: string): Promise<void> {
  await db
    .delete(feedbackWebhookDeliveries)
    .where(scopedToTenant(feedbackWebhookDeliveries, tenantId, eq(feedbackWebhookDeliveries.id, deliveryId)))
    .catch((error) => {
      reportCaughtError(error, { source: 'application/feedback/feedbackWebhookIngest.ts', operation: 'releaseDelivery' });
    });
}

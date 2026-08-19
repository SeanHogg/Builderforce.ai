/**
 * What a BUYER can actually do with what they were sent.
 *
 * ── WHY ACCEPTANCE LIVES ON THE SERVER AND NOT IN THE CANVAS ────────────────────
 * A quote's `acceptedAt`/`acceptedBy` are declared `derived` in the sell-motion
 * vocabulary, which means no model and no seller may write them. That declaration is only
 * as good as the fact that there is exactly ONE path that can: this module. An `accept`
 * action on the seller's card would have made the flag decorative — the whole guarantee is
 * that the only writer is a route reached by somebody holding the buyer's token.
 *
 * ── WHY THE PRICE IS RECOMPUTED HERE ────────────────────────────────────────────
 * The buyer's page displays a total. This route does not trust it: it re-reads the stored
 * lines and recomputes with the SAME contract function the page used
 * (`quoteCheckoutIntent`), so a tampered request body cannot buy a $50k platform for $1.
 * That is not a hypothetical — it is the default failure of every accept-a-price endpoint
 * that takes an amount as input.
 *
 * ── WHY THE ACCEPTANCE IS WRITTEN ONTO THE CARD ─────────────────────────────────
 * The alternative was a `quote_acceptances` table. The card IS the quote — its lines, its
 * term, its expiry all live in `creation_session_objects.content` — so an acceptance in a
 * second store would be a row that has to be joined back to the object it is about, and
 * the two would drift the first time a quote was duplicated. One fact in one place: the
 * acceptance is stamped on the object, and the durable AUDIT of it is the `activity_log`
 * row written beside it, which is what an audit store is for.
 */

import { and, eq, sql } from 'drizzle-orm';
import {
  quoteAcceptability, quoteCheckoutIntent, readQuoteLines,
  type QuoteCheckoutIntent,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  creationSessionEvents, creationSessionObjects, creationSessions, objects,
} from '../../infrastructure/database/schema';
import { resolveShareToken } from '../kernel/ObjectRegistry';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity } from '../activity/activityLog';
import { recordProspectEvent } from './prospectShare';

/** The prospect actor, restated for this module's own writes. Same value as
 *  `prospectShare`'s — one `actor_type` string, two call sites, and the reason it is
 *  written out rather than exported from there is that exporting a bare object literal
 *  invites a caller to mutate the shared instance. */
const PROSPECT_ACTOR = { type: 'prospect' as never, ref: null, name: 'Prospect' };

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Resolve a token to the canvas object it grants, plus the session it belongs to. Every
 *  buyer action needs exactly this triple, so it is resolved once here rather than three
 *  times with three slightly different tenant checks. */
async function resolveTarget(db: Db, token: string, canvasObjectId: string) {
  const grant = await resolveShareToken(db, token);
  if (!grant) return null;
  const [row] = await db.select({
    id: creationSessionObjects.id,
    kind: creationSessionObjects.kind,
    content: creationSessionObjects.content,
    sessionId: creationSessionObjects.sessionId,
    tenantId: creationSessions.tenantId,
    revision: creationSessions.canvasRevision,
    sessionTitle: creationSessions.title,
  }).from(creationSessionObjects)
    .innerJoin(creationSessions, eq(creationSessions.id, creationSessionObjects.sessionId))
    .where(eq(creationSessionObjects.id, canvasObjectId))
    .limit(1);
  // The token's tenant must be the object's tenant. A token is a grant into ONE workspace;
  // pairing it with an object id from another is the only way this route could be walked
  // across the tenant boundary, and it is refused here rather than trusted upstream.
  if (!row || row.tenantId !== grant.tenantId) return null;
  return { grant, row };
}

/**
 * Merge a patch into a card's authored content and bump the board.
 *
 * The revision bump is what makes a watching seller's canvas redraw: `canvas_revision` is
 * the value every client polls and the `/:id/ws` fan-out carries. Writing the content
 * without bumping it would leave an accepted quote invisible on the seller's screen until
 * they reloaded — which, for the one event this whole vocabulary exists to produce, is
 * indistinguishable from it not working.
 */
async function patchCard(
  db: Db,
  target: { tenantId: number; sessionId: string; id: string; content: unknown },
  patch: Record<string, unknown>,
  event: { type: string; payload: Record<string, unknown> },
): Promise<void> {
  const content = target.content && typeof target.content === 'object' && !Array.isArray(target.content)
    ? target.content as Record<string, unknown>
    : {};
  const nextRevision = sql`${creationSessions.canvasRevision} + 1`;
  await db.update(creationSessionObjects)
    .set({ content: { ...content, ...patch }, updatedAt: new Date() })
    .where(eq(creationSessionObjects.id, target.id));
  await db.update(creationSessions)
    .set({ canvasRevision: nextRevision, lastActivityAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(creationSessions, target.tenantId, eq(creationSessions.id, target.sessionId)));
  const [session] = await db.select({ revision: creationSessions.canvasRevision })
    .from(creationSessions)
    .where(scopedToTenant(creationSessions, target.tenantId, eq(creationSessions.id, target.sessionId)))
    .limit(1);
  await db.insert(creationSessionEvents).values({
    sessionId: target.sessionId,
    revision: session?.revision ?? 0,
    // Not 'user'. The actor is somebody with no account, and recording them as a user
    // would put an anonymous stranger into the session's collaborator history.
    actorType: 'prospect',
    actorRef: null,
    eventType: event.type,
    objectId: target.id,
    payload: event.payload,
  });
}

// ---------------------------------------------------------------------------
// Accept a quote
// ---------------------------------------------------------------------------

export interface AcceptQuoteInput {
  token: string;
  quoteObjectId: string;
  /** Who is accepting, as they typed it. Recorded verbatim — this is the buyer's own
   *  attestation and paraphrasing it would weaken the only record of who agreed. */
  acceptedByName: string;
  acceptedByEmail: string;
}

export type AcceptQuoteResult =
  | { ok: true; intent: QuoteCheckoutIntent | null; currency: string; totalCents: number }
  | { ok: false; error: string; code: 'notFound' | 'expired' | 'notSent' | 'settled' | 'unpriced' };

/**
 * The buyer accepts.
 *
 * The negotiated price survives this call as a `QuoteCheckoutIntent` — the plan, the
 * cycle, the seats and what they actually agreed to pay — which is the whole point of the
 * object. Today every discount dies here, because the buyer is sent to `/pricing` to
 * re-pick a plan at list price.
 */
export async function acceptQuote(
  db: Db,
  env: Env,
  input: AcceptQuoteInput,
): Promise<AcceptQuoteResult> {
  const target = await resolveTarget(db, input.token, input.quoteObjectId);
  if (!target || target.row.kind !== 'quote') {
    return { ok: false, error: 'This quote is no longer available.', code: 'notFound' };
  }
  const content = target.row.content && typeof target.row.content === 'object' && !Array.isArray(target.row.content)
    ? target.row.content as Record<string, unknown>
    : {};

  const verdict = quoteAcceptability({ state: content.quoteState, expiresAt: content.expiresAt }, new Date());
  if (!verdict.acceptable) {
    const message = verdict.reason === 'expired'
      ? 'This quote has expired. Ask for a fresh one.'
      : verdict.reason === 'settled'
        ? 'This quote has already been settled.'
        : 'This quote has not been issued yet.';
    return { ok: false, error: message, code: verdict.reason === 'ok' ? 'notFound' : verdict.reason };
  }

  // Recomputed from the STORED lines, never from anything the request carried.
  const lines = readQuoteLines(content.lines);
  const intent = quoteCheckoutIntent(lines, Number(content.termMonths ?? 12));
  if (lines.length === 0) {
    return { ok: false, error: 'This quote has no priced lines.', code: 'unpriced' };
  }
  const currencyRaw = text(content.currency, 8).toUpperCase();
  const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : 'USD';
  const totalCents = intent?.totalCents
    ?? readQuoteLines(content.lines).reduce((sum, line) => sum + line.unitPriceCents, 0);

  const acceptedAt = new Date();
  const acceptedBy = [text(input.acceptedByName, 160), text(input.acceptedByEmail, 320)]
    .filter(Boolean).join(' · ');

  await patchCard(db, { tenantId: target.grant.tenantId, sessionId: target.row.sessionId, id: target.row.id, content: target.row.content }, {
    quoteState: 'accepted',
    acceptedAt: acceptedAt.toISOString(),
    acceptedBy,
    // The card's common subtitle, kept in step with the derived state — the same rule
    // `legalDocument.documentStatus` follows for its own two-field split.
    status: 'Accepted',
  }, {
    type: 'quote.accepted',
    payload: { acceptedBy, totalCents, currency },
  });

  await recordActivity(env, db, {
    tenantId: target.grant.tenantId,
    actor: PROSPECT_ACTOR,
    verb: 'prospect.accepted',
    targetType: 'canvas_object',
    targetId: target.row.id,
    targetLabel: text(content.title, 300) || 'Quote',
    summary: `${acceptedBy || 'A buyer'} accepted a quote worth ${totalCents} ${currency} cents per period.`,
    metadata: { shareObjectId: target.grant.objectId, totalCents, currency, intent },
  });

  return { ok: true, intent, currency, totalCents };
}

/** The buyer declines. Recorded for the same reason the acceptance is: a quote that went
 *  quiet and a quote that was actively refused are different facts, and only one of them
 *  is worth chasing. */
export async function declineQuote(
  db: Db,
  env: Env,
  input: { token: string; quoteObjectId: string; reason: string },
): Promise<boolean> {
  const target = await resolveTarget(db, input.token, input.quoteObjectId);
  if (!target || target.row.kind !== 'quote') return false;
  const reason = text(input.reason, 600);
  await patchCard(db, { tenantId: target.grant.tenantId, sessionId: target.row.sessionId, id: target.row.id, content: target.row.content }, {
    quoteState: 'declined',
    status: 'Declined',
  }, { type: 'quote.declined', payload: { reason } });
  await recordActivity(env, db, {
    tenantId: target.grant.tenantId,
    actor: PROSPECT_ACTOR,
    verb: 'prospect.declined',
    targetType: 'canvas_object',
    targetId: target.row.id,
    summary: reason || null,
    metadata: { shareObjectId: target.grant.objectId },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Ask to drive
// ---------------------------------------------------------------------------

/**
 * "Can I try it?" — the escalation from watch-only.
 *
 * It does NOT grant anything. It raises a signal on the seller's live board (a session
 * event, which is what the canvas already streams) and records the strongest buying signal
 * this whole system can capture. The grant itself is the seller pressing a button while
 * they are watching, which is the only design under which a demo cannot be hijacked: a
 * token that could escalate its own scope is a token that escalates its own scope after
 * the meeting ends.
 */
export async function requestControl(
  db: Db,
  env: Env,
  input: { token: string; requestedByName: string; note: string },
): Promise<boolean> {
  const grant = await resolveShareToken(db, input.token);
  if (!grant) return false;

  // The share may point at the session itself or at one card on it; both resolve to a
  // session, because that is where a live control request has to appear. Two plain reads
  // rather than one clever UNION: the registry row says which of the two shapes this is,
  // so the second read is only issued for the card case and neither query needs raw SQL.
  const [registered] = await db.select({ kind: objects.kind, refId: objects.refId })
    .from(objects)
    .where(scopedToTenant(objects, grant.tenantId, eq(objects.id, grant.objectId)))
    .limit(1);
  if (!registered) return false;

  let sessionId = registered.refId;
  if (registered.kind === 'canvas_object') {
    const [card] = await db.select({ sessionId: creationSessionObjects.sessionId })
      .from(creationSessionObjects)
      .where(eq(creationSessionObjects.id, registered.refId))
      .limit(1);
    if (!card) return false;
    sessionId = card.sessionId;
  } else if (registered.kind !== 'creation_session') {
    return false;
  }

  const [session] = await db.select({
    id: creationSessions.id, revision: creationSessions.canvasRevision,
  }).from(creationSessions)
    .where(scopedToTenant(creationSessions, grant.tenantId, eq(creationSessions.id, sessionId)))
    .limit(1);
  if (!session) return false;

  const requestedBy = text(input.requestedByName, 160);
  await db.insert(creationSessionEvents).values({
    sessionId: session.id,
    revision: session.revision,
    actorType: 'prospect',
    actorRef: null,
    eventType: 'prospect.control-requested',
    payload: { requestedBy, note: text(input.note, 400) },
  });
  await recordProspectEvent(db, env, { token: input.token, event: 'requestedControl' });
  return true;
}

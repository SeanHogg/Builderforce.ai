/**
 * The seller's half of the sell motion — the four acts that need real workspace data.
 *
 * ── WHY A SEPARATE ROUTER AND NOT MORE OF `creationSessionRouteService` ─────────
 * That module is already the largest presentation surface in the repo and it is the
 * BOARD's router: create, graph, commands, members, invitations, history. These four are a
 * DOMAIN's use cases that happen to be addressed by a board id, in the same way
 * `legalDocumentRoutes` is a legal router rather than four more canvas endpoints. The
 * prospect SHARES stayed on the session router (they are session access control, which is
 * that module's job); these did not.
 *
 * ── WHY THERE IS NO QUERY IN THIS FILE ──────────────────────────────────────────
 * Presentation → application → infrastructure. Each handler resolves its card through
 * `resolveSellMotionCard` and writes through `applySellMotionResult`, both application
 * ports. That is the N-layer rule the build guard enforces, and the reason it does: an
 * authorization check written inline in a handler is one that gets copied into the next
 * handler with a different minimum role, and nothing notices.
 */

import { Hono, type Context } from 'hono';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import {
  applySellMotionResult, assembleTrustPacket, handoffSession, provisionTrial, readCall,
  resolveSellMotionCard, type CardResolution,
} from '../../application/sales/sellMotionService';
import { recordActivity, resolveActorFromContext } from '../../application/activity/activityLog';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export function createSellMotionRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  r.use('*', webAuthMiddleware);

  /** The one resolution every handler needs, read off the request. */
  const resolve = (c: Context<HonoEnv>, expectedKind: string): Promise<CardResolution> =>
    resolveSellMotionCard(db, {
      sessionId: c.req.param('id') ?? '',
      objectId: c.req.param('objectId') ?? '',
      tenantId: c.get('tenantId') as number,
      userId: c.get('userId') as string,
      expectedKind,
    });

  /** Persist the patch, bump the board, and record the act in the audit store. The
   *  activity write is here rather than in the port because the ACTOR is a property of the
   *  request, and resolving it inside the port would mean passing the whole context down. */
  async function commit(
    c: Context<HonoEnv>,
    resolved: Extract<CardResolution, { ok: true }>,
    patch: Record<string, unknown>,
    event: { type: string; payload: Record<string, unknown>; summary: string },
  ): Promise<void> {
    await applySellMotionResult(db, {
      access: resolved.access,
      card: resolved.card,
      userId: c.get('userId') as string,
      patch,
      eventType: event.type,
      payload: event.payload,
    });
    await recordActivity(c.env as Env, db, {
      tenantId: resolved.access.session.tenantId,
      actor: await resolveActorFromContext(c.env as Env, db, c),
      verb: event.type,
      targetType: 'canvas_object',
      targetId: resolved.card.id,
      targetLabel: text(resolved.card.content.title, 300) || resolved.card.kind,
      summary: event.summary,
      metadata: event.payload,
    });
  }

  /**
   * POST /:id/objects/:objectId/read-call — what the buyer actually said.
   *
   * The transcript is `derived` on the card: this route READS it and never writes it, so
   * an LLM cannot end up having authored a quotation attributed to a named person.
   */
  r.post('/:id/objects/:objectId/read-call', async (c) => {
    const resolved = await resolve(c, 'call');
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const { access, card } = resolved;

    const transcript = text(card.content.transcript, 200_000);
    if (!transcript) {
      return c.json({ error: 'This call has no transcript yet. Paste one in, or attach the dialer recording, before summarizing.' }, 409);
    }

    const reading = await readCall(c.env as Env, access.session.tenantId, {
      title: text(card.content.title, 200),
      counterparty: text(card.content.counterparty, 300),
      transcript,
    });
    if ('error' in reading) return c.json({ error: reading.error }, 502);

    const patch: Record<string, unknown> = {
      objections: reading.objections,
      commitment: reading.commitment,
      nextStep: reading.nextStep,
      sentiment: reading.sentiment,
      summary: reading.summary,
      status: reading.commitment ? 'Read' : 'Read — no commitment',
      ...(reading.talkRatioPercent === undefined ? {} : { talkRatioPercent: reading.talkRatioPercent }),
    };
    await commit(c, resolved, patch, {
      type: 'call.read',
      payload: { objections: reading.objections.length, sentiment: reading.sentiment },
      summary: `Read a call transcript: ${reading.objections.length} objection(s), sentiment ${reading.sentiment}.`,
    });
    return c.json({ card: patch });
  });

  /**
   * POST /:id/objects/:objectId/assemble-trust-packet — pull the workspace's real evidence.
   *
   * Answers only the questionnaire rows the evidence can actually answer, and never
   * overwrites a row a person wrote. A packet that filled every row with a plausible
   * sentence would look 100% ready and fail the first review.
   */
  r.post('/:id/objects/:objectId/assemble-trust-packet', async (c) => {
    const resolved = await resolve(c, 'trustPacket');
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const { access, card } = resolved;

    const assembly = await assembleTrustPacket(db, c.env as Env, access.session.tenantId, {
      questionnaire: card.content.questionnaire,
    });

    const patch: Record<string, unknown> = {
      controls: assembly.controls,
      subprocessors: assembly.subprocessors,
      documents: assembly.documents,
      questionnaire: assembly.questionnaire,
      assembledAt: assembly.assembledAt,
      status: 'Assembled',
    };
    await commit(c, resolved, patch, {
      type: 'trustPacket.assembled',
      payload: { controls: assembly.controls.length, subprocessors: assembly.subprocessors.length, answered: assembly.answered },
      summary: `Assembled a trust packet: ${assembly.controls.length} controls, ${assembly.subprocessors.length} subprocessors, ${assembly.answered} question(s) answered from evidence.`,
    });
    return c.json({ card: patch, answered: assembly.answered });
  });

  /**
   * POST /:id/objects/:objectId/provision-trial — the demo board becomes the trial.
   *
   * `sourceSessionId` defaults to THIS board, which is the case that matters: the buyer
   * says "let me try it" about the thing you just built in front of them.
   */
  r.post('/:id/objects/:objectId/provision-trial', async (c) => {
    const resolved = await resolve(c, 'trial');
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const { access, card } = resolved;

    if (text(card.content.workspaceId, 64)) {
      return c.json({ error: 'This trial has already been provisioned. Extend it instead of provisioning a second one.' }, 409);
    }
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const sourceSessionId = text(body.sourceSessionId, 64) || access.session.id;
    if (!UUID_RE.test(sourceSessionId)) return c.json({ error: 'Invalid source board' }, 400);

    const provisioned = await provisionTrial(db, {
      sourceSessionId,
      tenantId: access.session.tenantId,
      prospect: text(card.content.prospect, 160),
      days: Number(body.days ?? 14),
      createdBy: c.get('userId') as string,
    });
    if ('error' in provisioned) return c.json({ error: provisioned.error }, 409);

    const patch: Record<string, unknown> = {
      workspaceId: provisioned.sessionId,
      sourceSessionId,
      startsAt: provisioned.startsAt,
      expiresAt: provisioned.expiresAt,
      status: 'Active',
    };
    await commit(c, resolved, patch, {
      type: 'trial.provisioned',
      payload: { sessionId: provisioned.sessionId, objects: provisioned.objects },
      summary: `Provisioned a trial board with ${provisioned.objects} object(s), expiring ${provisioned.expiresAt}.`,
    });
    // The share is minted separately, by the caller, because the branding and the message
    // on it are the seller's — see `provisionTrial`'s own header.
    return c.json({ card: patch, sessionId: provisioned.sessionId });
  });

  /**
   * POST /:id/objects/:objectId/handoff — on close, the board goes with the customer.
   *
   * The thing built during the sale not being stranded on the seller's canvas is the whole
   * reason `mutualActionPlan.handoffSessionId` exists.
   */
  r.post('/:id/objects/:objectId/handoff', async (c) => {
    const resolved = await resolve(c, 'mutualActionPlan');
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const { access, card } = resolved;

    if (text(card.content.handoffSessionId, 64)) {
      return c.json({ error: 'This plan has already been handed off.' }, 409);
    }
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const sourceSessionId = text(body.sourceSessionId, 64) || access.session.id;
    if (!UUID_RE.test(sourceSessionId)) return c.json({ error: 'Invalid source board' }, 400);

    const copied = await handoffSession(db, {
      sourceSessionId,
      tenantId: access.session.tenantId,
      title: `${text(card.content.buyer, 120) || 'Customer'} — go live`,
      createdBy: c.get('userId') as string,
    });
    if ('error' in copied) return c.json({ error: copied.error }, 409);

    const patch: Record<string, unknown> = { handoffSessionId: copied.sessionId, status: 'Handed off' };
    await commit(c, resolved, patch, {
      type: 'mutualActionPlan.handoff',
      payload: { sessionId: copied.sessionId, objects: copied.objects, connections: copied.connections },
      summary: `Handed off ${copied.objects} object(s) and ${copied.connections} connection(s) into a new board.`,
    });
    return c.json({ card: patch, sessionId: copied.sessionId });
  });

  return r;
}

/**
 * Polls — the facilitator's half, and the PARTICIPANT's.
 *
 * Two routers from one module for the same reason `formRoutes` splits: they are two
 * halves of one contract, and splitting them across files is how the projection sent to
 * a phone drifts from the one the facilitator published. They are MOUNTED separately,
 * and that is the part that matters — the public one carries no auth middleware and
 * must be registered before the catch-all domain router.
 *
 * Nothing here reaches the database. Every rule that protects a participant — a closed
 * poll takes nothing, a hidden tally is not sent to a phone, a quiz answer is not
 * revealed early, an anonymous vote records nobody — lives in `pollFacilitation.ts`, so
 * a second caller cannot reach the store through a path that forgot one. This layer
 * translates errors into status codes and nothing else.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { FormError } from '../../application/collection/formPublishing';
import {
  castPollVote,
  emptyPollTally,
  pollResponseCount,
  publishPoll,
  readPoll,
  resolvePublicPoll,
  setPollState,
  tallyPoll,
} from '../../application/collection/pollFacilitation';

/** One translation of a refusal into a status, shared by every handler — so a new
 *  endpoint cannot invent a different code for the same rejection. */
const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FormError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
};

export function createPollRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const tenant = (c: Context<HonoEnv>) => c.get('tenantId') as number;

  /** Publish a poll and OPEN it — one press, because the next thing that happens is a
   *  room being asked to answer. */
  router.post('/publish', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const result = await publishPoll(db, tenant(c), {
      ...(typeof body.questionSetId === 'string' ? { questionSetId: body.questionSetId } : {}),
      title: String(body.title ?? ''),
      prompt: typeof body.prompt === 'string' ? body.prompt : null,
      ...(typeof body.format === 'string' ? { format: body.format } : {}),
      options: body.options,
      scaleMax: Number.isFinite(body.scaleMax) ? Number(body.scaleMax) : null,
      gridXLabel: typeof body.gridXLabel === 'string' ? body.gridXLabel : null,
      gridYLabel: typeof body.gridYLabel === 'string' ? body.gridYLabel : null,
      ...(typeof body.anonymous === 'boolean' ? { anonymous: body.anonymous } : {}),
      ...(typeof body.showResultsLive === 'boolean' ? { showResultsLive: body.showResultsLive } : {}),
      closesAt: typeof body.closesAt === 'string' ? body.closesAt : null,
      objectId: typeof body.objectId === 'string' ? body.objectId : null,
      createdBy: (c.get('userId') as string | undefined) ?? null,
    });
    return Response.json(result);
  }));

  /**
   * Steer a live poll: open or close voting, show or hide the count.
   *
   * ONE endpoint for both because they are one write to one row. They stay separate
   * BUTTONS — hiding the count while voting continues is the move that makes an
   * instrument honest, and a control that could only do both at once would not allow it.
   */
  router.post('/:id/state', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const state = await setPollState(db, tenant(c), c.req.param('id'), {
      ...(body.status === 'open' || body.status === 'closed' ? { status: body.status } : {}),
      ...(typeof body.showResultsLive === 'boolean' ? { showResultsLive: body.showResultsLive } : {}),
    });
    return Response.json(state);
  }));

  /** What the facilitator's board draws: the poll, the count, and the shape. The quiz
   *  answers are visible here — the person running the room is the one who wrote them. */
  router.get('/:id', (c) => handle(async () => {
    const resolved = await readPoll(db, tenant(c), c.req.param('id'));
    if (!resolved) return Response.json({ error: 'No such poll.' }, { status: 404 });
    const [tally, responseCount] = await Promise.all([
      tallyPoll(db, resolved, { revealCorrect: true }),
      pollResponseCount(db, tenant(c), resolved.questionSetId),
    ]);
    return Response.json({ poll: resolved.poll, questionSetId: resolved.questionSetId, tally, responseCount });
  }));

  return router;
}

/**
 * The participant's surface. Unauthenticated by construction.
 *
 * A poll is answered by whoever is in the room, from a phone, with no account — that is
 * the entire point of the primitive — so the slug is the credential and the row reports
 * which tenant it belongs to. Registering this under the authenticated tree would make
 * the feature impossible, not merely awkward.
 */
export function createPublicPollRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * The poll, and the tally IF the facilitator has revealed it.
   *
   * The gate is here rather than in the phone's rendering: a payload that carries the
   * count while the facilitator is hiding it is a hidden count in name only, and the
   * whole reason to hide it is that seeing three answers changes the fourth.
   */
  router.get('/:slug', (c) => handle(async () => {
    const resolved = await resolvePublicPoll(db, c.req.param('slug'));
    if (!resolved) return Response.json({ error: 'No poll at that address.' }, { status: 404 });
    const reveal = resolved.poll.showResultsLive || resolved.poll.status === 'closed';
    const tally = reveal
      ? await tallyPoll(db, resolved, { ...(resolved.poll.status === 'closed' ? { revealCorrect: true } : {}) })
      : emptyPollTally(resolved.poll.format);
    // Deliberately only the CONTRACT's projection plus the tally — `resolved` carries
    // the tenant id and the unstripped quiz answers, and returning it wholesale would
    // hand both to every visitor.
    return Response.json({ poll: resolved.poll, tally, resultsVisible: reveal });
  }));

  router.post('/:slug/vote', (c) => handle(async () => {
    const resolved = await resolvePublicPoll(db, c.req.param('slug'));
    if (!resolved) return Response.json({ error: 'No poll at that address.' }, { status: 404 });
    const body = await c.req.json<{ submissionId?: unknown; answer?: unknown }>();
    await castPollVote(db, resolved, {
      submissionId: String(body.submissionId ?? ''),
      answer: body.answer,
      // The signed-in participant, when there is one. An anonymous poll DISCARDS it
      // inside the service, because the caller does not get to decide that — the poll
      // does.
      respondentRef: (c.get('userId') as string | undefined) ?? null,
    });
    const reveal = resolved.poll.showResultsLive;
    const tally = reveal ? await tallyPoll(db, resolved) : emptyPollTally(resolved.poll.format);
    return Response.json({ ok: true, tally, resultsVisible: reveal });
  }));

  return router;
}

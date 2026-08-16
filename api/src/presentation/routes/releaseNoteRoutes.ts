/**
 * Platform release notes — /api/release-notes/*
 *
 *   GET  /             — PUBLIC: the published changelog, newest first. This is
 *                        what the footer "What's new" panel renders, so it needs
 *                        no session (the changelog is marketing, not tenant
 *                        data). Served through the read-through cache.
 *   GET  /betas        — signed-in: the betas this user may join, each with where
 *                        THEY stand, plus the one worth banner-interrupting them
 *                        about, plus how many published notes they have not seen.
 *                        The banner choice is made HERE, once, so the banner and
 *                        the panel cannot disagree about it. The unread count
 *                        rides this read rather than adding a second signed-in
 *                        request for one integer.
 *   POST /seen         — signed-in: mark the changelog read (the panel opened).
 *   POST /:id/beta     — signed-in: join / leave / dismiss. Joining requires an
 *                        explicit `agreed: true` and records the consent.
 *   GET  /admin        — superadmin: everything, drafts + sent-state + how many
 *                        people are actually in each beta.
 *   POST /             — superadmin: create (draft or published).
 *   PUT  /:id          — superadmin: edit / publish / unpublish.
 *   DELETE /:id        — superadmin: remove.
 *   POST /send-digest  — superadmin: email ALL published, not-yet-sent notes NOW
 *                        (same code path as the Friday cron) — off-cycle bulk send.
 *   POST /:id/send     — superadmin: email ONE published note NOW (manual trigger).
 *                        Marks it emailed, so it drops out of the weekly digest.
 *
 * Authoring is superadmin-only because these are Builderforce's own platform
 * announcements, not tenant content — see application/product/releaseNotes.ts.
 */

import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv, Env } from '../../env';
import { superAdminMiddleware } from '../middleware/superAdminMiddleware';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import type { UserId } from '../../domain/shared/types';
import {
  RELEASE_NOTE_CATEGORIES,
  RELEASE_NOTE_STAGES,
  isReleaseNoteCategory,
  isReleaseNoteStage,
  listPublishedReleaseNotes,
  listAllReleaseNotes,
  createReleaseNote,
  updateReleaseNote,
  deleteReleaseNote,
  type ReleaseNoteStage,
} from '../../application/product/releaseNotes';
import {
  countUnreadReleaseNotes,
  markReleaseNotesSeen,
} from '../../application/product/releaseNoteSeen';
import {
  bannerBeta,
  countBetaParticipants,
  listBetaProgramsForUser,
  setBetaEnrollment,
} from '../../application/product/releaseNoteBetas';
import { runReleaseDigest } from '../../application/email/releaseDigest';

/** What a join/leave/dismiss request may ask for, and the enrolment status each
 *  one lands on. Declaring it as data keeps the route free of a three-branch
 *  translation nobody would remember to extend. */
const ACTION_STATUS = { join: 'joined', leave: 'left', dismiss: 'dismissed' } as const;
type BetaAction = keyof typeof ACTION_STATUS;

const isBetaAction = (value: unknown): value is BetaAction =>
  typeof value === 'string' && value in ACTION_STATUS;

/** The beta authoring fields, parsed once — create and update take the same set,
 *  so they validate it the same way. Returns an error string or the patch. */
function parseBetaFields(body: {
  stage?: unknown; betaOptIn?: unknown; betaTerms?: unknown; stageEndsAt?: unknown;
}): { error: string } | {
  stage?: ReleaseNoteStage; betaOptIn?: boolean; betaTerms?: string | null; stageEndsAt?: string | null;
} {
  if (body.stage !== undefined && !isReleaseNoteStage(body.stage)) {
    return { error: `stage must be one of: ${RELEASE_NOTE_STAGES.join(', ')}` };
  }
  return {
    ...(body.stage !== undefined ? { stage: body.stage as ReleaseNoteStage } : {}),
    ...(body.betaOptIn !== undefined ? { betaOptIn: body.betaOptIn === true } : {}),
    ...(body.betaTerms !== undefined
      ? { betaTerms: typeof body.betaTerms === 'string' && body.betaTerms.trim() ? body.betaTerms : null }
      : {}),
    ...(body.stageEndsAt !== undefined
      ? { stageEndsAt: typeof body.stageEndsAt === 'string' && body.stageEndsAt.trim() ? body.stageEndsAt : null }
      : {}),
  };
}

export function createReleaseNoteRoutes(db: Db) {
  const router = new Hono<HonoEnv>();

  // -------------------------------------------------------------------------
  // GET / — PUBLIC published changelog (cached).
  // -------------------------------------------------------------------------
  router.get('/', async (c) => {
    const limitRaw = Number(c.req.query('limit') ?? '50');
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const releaseNotes = await listPublishedReleaseNotes(c.env as Env, db, limit);
    // Sent-state is an internal marketing flag — not part of the public shape.
    return c.json({
      releaseNotes: releaseNotes.map(({ emailedAt: _emailedAt, ...note }) => note),
    });
  });

  // -------------------------------------------------------------------------
  // GET /betas — the betas open to this user + where they stand with each.
  // -------------------------------------------------------------------------
  router.get('/betas', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as UserId;
    // Both halves of "what does this person need told about product updates?",
    // in one round trip and one pair of reads.
    const [betas, unreadCount] = await Promise.all([
      listBetaProgramsForUser(c.env as Env, db, userId),
      countUnreadReleaseNotes(c.env as Env, db, userId),
    ]);
    // The banner candidate is decided here rather than in the client, so every
    // surface that asks "should we interrupt them?" gets the same answer.
    return c.json({ betas, bannerBetaId: bannerBeta(betas)?.id ?? null, unreadCount });
  });

  // -------------------------------------------------------------------------
  // POST /seen — the changelog was opened, so it has been read. No body: the
  // clock is "now" and the user is the session, and accepting a client-supplied
  // timestamp would let a caller silently un-read or over-read their own badge.
  // -------------------------------------------------------------------------
  router.post('/seen', webAuthMiddleware, async (c) => {
    await markReleaseNotesSeen(db, c.get('userId') as UserId);
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // POST /:id/beta — join / leave / dismiss. Joining is consent, so it requires
  // an explicit `agreed: true`; the server records what they agreed to.
  // -------------------------------------------------------------------------
  router.post('/:id/beta', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as UserId;
    const body = await c.req.json<{ action?: string; agreed?: boolean }>().catch(() => ({}) as Record<string, never>);
    if (!isBetaAction(body.action)) {
      return c.json({ error: `action must be one of: ${Object.keys(ACTION_STATUS).join(', ')}` }, 400);
    }
    if (body.action === 'join' && body.agreed !== true) {
      return c.json({ error: 'You must accept the beta terms before joining' }, 400);
    }

    // Resolve the note from the SAME list the user was offered: an id that is not
    // a joinable beta (draft, live, or invitation-only) can never be enrolled in,
    // no matter what the client posts.
    const betas = await listBetaProgramsForUser(c.env as Env, db, userId);
    const note = betas.find((b) => b.id === c.req.param('id'));
    if (!note) return c.json({ error: 'Beta not found or not open for enrollment' }, 404);

    const enrollment = await setBetaEnrollment(db, {
      note,
      userId,
      status: ACTION_STATUS[body.action],
    });
    return c.json({ enrollment: { releaseNoteId: note.id, ...enrollment } });
  });

  // -------------------------------------------------------------------------
  // Superadmin authoring surface.
  // -------------------------------------------------------------------------
  router.get('/admin', superAdminMiddleware, async (c) => {
    const notes = await listAllReleaseNotes(db);
    // "Is anyone actually in this beta?" — the question an operator asks straight
    // after opening one. Counted only for the notes that can have participants.
    const participants = await countBetaParticipants(db, notes.filter((n) => n.betaOptIn).map((n) => n.id));
    return c.json({
      releaseNotes: notes.map((note) => ({ ...note, participants: participants[note.id] ?? 0 })),
    });
  });

  router.post('/', superAdminMiddleware, async (c) => {
    const body = await c.req.json<{
      version?: string; title?: string; body?: string | null;
      category?: string; publish?: boolean;
      stage?: unknown; betaOptIn?: unknown; betaTerms?: unknown; stageEndsAt?: unknown;
    }>().catch(() => ({}) as Record<string, never>);

    const version = typeof body.version === 'string' ? body.version.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!version || !title) return c.json({ error: 'version and title are required' }, 400);
    if (body.category !== undefined && !isReleaseNoteCategory(body.category)) {
      return c.json({ error: `category must be one of: ${RELEASE_NOTE_CATEGORIES.join(', ')}` }, 400);
    }
    const beta = parseBetaFields(body);
    if ('error' in beta) return c.json({ error: beta.error }, 400);

    const note = await createReleaseNote(c.env as Env, db, {
      version,
      title,
      body: typeof body.body === 'string' ? body.body : null,
      category: body.category,
      ...beta,
      publish: body.publish === true,
    });
    return c.json({ releaseNote: note }, 201);
  });

  router.put('/:id', superAdminMiddleware, async (c) => {
    const body = await c.req.json<{
      version?: string; title?: string; body?: string | null;
      category?: string; publish?: boolean;
      stage?: unknown; betaOptIn?: unknown; betaTerms?: unknown; stageEndsAt?: unknown;
    }>().catch(() => ({}) as Record<string, never>);

    if (body.category !== undefined && !isReleaseNoteCategory(body.category)) {
      return c.json({ error: `category must be one of: ${RELEASE_NOTE_CATEGORIES.join(', ')}` }, 400);
    }
    const beta = parseBetaFields(body);
    if ('error' in beta) return c.json({ error: beta.error }, 400);
    if (body.version !== undefined && !String(body.version).trim()) {
      return c.json({ error: 'version cannot be empty' }, 400);
    }
    if (body.title !== undefined && !String(body.title).trim()) {
      return c.json({ error: 'title cannot be empty' }, 400);
    }

    const note = await updateReleaseNote(c.env as Env, db, c.req.param('id'), {
      ...(body.version !== undefined ? { version: String(body.version).trim() } : {}),
      ...(body.title !== undefined ? { title: String(body.title).trim() } : {}),
      ...(body.body !== undefined ? { body: typeof body.body === 'string' ? body.body : null } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...beta,
      ...(body.publish !== undefined ? { publish: body.publish === true } : {}),
    });
    if (!note) return c.json({ error: 'Release note not found' }, 404);
    return c.json({ releaseNote: note });
  });

  router.delete('/:id', superAdminMiddleware, async (c) => {
    const removed = await deleteReleaseNote(c.env as Env, db, c.req.param('id'));
    if (!removed) return c.json({ error: 'Release note not found' }, 404);
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // POST /send-digest — email ALL unsent published notes now (cron code path).
  // -------------------------------------------------------------------------
  router.post('/send-digest', superAdminMiddleware, async (c) => {
    const result = await runReleaseDigest(c.env as Env, db);
    return c.json({ result });
  });

  // -------------------------------------------------------------------------
  // POST /:id/send — email ONE published note now, then flag it emailed so it is
  // excluded from the weekly digest. The manual per-note trigger.
  // -------------------------------------------------------------------------
  router.post('/:id/send', superAdminMiddleware, async (c) => {
    const result = await runReleaseDigest(c.env as Env, db, { noteIds: [c.req.param('id')] });
    // 0 notes → the id was not a published note (draft or missing). Surface it
    // rather than reporting a successful send of nothing.
    if (result.notes === 0) return c.json({ error: 'Release note not found or not published' }, 404);
    return c.json({ result });
  });

  return router;
}

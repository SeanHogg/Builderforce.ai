/**
 * Platform release notes — /api/release-notes/*
 *
 *   GET  /             — PUBLIC: the published changelog, newest first. This is
 *                        what the footer "What's new" panel renders, so it needs
 *                        no session (the changelog is marketing, not tenant
 *                        data). Served through the read-through cache.
 *   GET  /admin        — superadmin: everything, drafts + sent-state included.
 *   POST /             — superadmin: create (draft or published).
 *   PUT  /:id          — superadmin: edit / publish / unpublish.
 *   DELETE /:id        — superadmin: remove.
 *   POST /send-digest  — superadmin: run the weekly digest NOW (same code path
 *                        as the Friday cron) — for testing and off-cycle sends.
 *
 * Authoring is superadmin-only because these are Builderforce's own platform
 * announcements, not tenant content — see application/product/releaseNotes.ts.
 */

import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv, Env } from '../../env';
import { superAdminMiddleware } from '../middleware/superAdminMiddleware';
import {
  RELEASE_NOTE_CATEGORIES,
  isReleaseNoteCategory,
  listPublishedReleaseNotes,
  listAllReleaseNotes,
  createReleaseNote,
  updateReleaseNote,
  deleteReleaseNote,
} from '../../application/product/releaseNotes';
import { runWeeklyReleaseDigest } from '../../application/email/releaseDigest';

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
  // Superadmin authoring surface.
  // -------------------------------------------------------------------------
  router.get('/admin', superAdminMiddleware, async (c) => {
    return c.json({ releaseNotes: await listAllReleaseNotes(db) });
  });

  router.post('/', superAdminMiddleware, async (c) => {
    const body = await c.req.json<{
      version?: string; title?: string; body?: string | null;
      category?: string; publish?: boolean;
    }>().catch(() => ({}) as Record<string, never>);

    const version = typeof body.version === 'string' ? body.version.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!version || !title) return c.json({ error: 'version and title are required' }, 400);
    if (body.category !== undefined && !isReleaseNoteCategory(body.category)) {
      return c.json({ error: `category must be one of: ${RELEASE_NOTE_CATEGORIES.join(', ')}` }, 400);
    }

    const note = await createReleaseNote(c.env as Env, db, {
      version,
      title,
      body: typeof body.body === 'string' ? body.body : null,
      category: body.category,
      publish: body.publish === true,
    });
    return c.json({ releaseNote: note }, 201);
  });

  router.put('/:id', superAdminMiddleware, async (c) => {
    const body = await c.req.json<{
      version?: string; title?: string; body?: string | null;
      category?: string; publish?: boolean;
    }>().catch(() => ({}) as Record<string, never>);

    if (body.category !== undefined && !isReleaseNoteCategory(body.category)) {
      return c.json({ error: `category must be one of: ${RELEASE_NOTE_CATEGORIES.join(', ')}` }, 400);
    }
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
  // POST /send-digest — run the weekly digest immediately (cron code path).
  // -------------------------------------------------------------------------
  router.post('/send-digest', superAdminMiddleware, async (c) => {
    const result = await runWeeklyReleaseDigest(c.env as Env, db);
    return c.json({ result });
  });

  return router;
}

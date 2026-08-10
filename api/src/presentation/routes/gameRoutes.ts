/**
 * `/api/projects/:projectId/game` — shipping a canvas-authored game to a device.
 *
 *   GET  /                     the target catalogue + what has been materialised
 *   POST /targets/:target      materialise one target's files into the workspace
 *   POST /publish              publish the game as an installable web app
 *   POST /roblox/publish       push a freshly authored place to a live experience
 *   PUT  /roblox/target        remember the experience to publish to
 *
 * Every route is tenant-scoped through {@link assertProject}, for the same reason
 * the backend routes are: a project id in a path is user input, and these routes
 * write files into a workspace and publish to a public address.
 *
 * The game itself is posted in the body rather than read from the canvas. The
 * canvas holds it as a `data:` URL on the object — it is the author's working
 * copy, and it is what they are looking at when they press the button. Reading a
 * stored copy instead would mean shipping something other than what is on screen.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import type { Env, HonoEnv } from '../../env';
import { findProjectForTenant } from '../../application/backend';
import { listProjectSecrets } from '../../application/secrets/projectSecrets';
import {
  GAME_TARGET_SUMMARIES,
  buildGame,
  listGameTargetStates,
  materializeGameTarget,
  publishGameAsPwa,
  publishGameToRoblox,
  setRobloxPublishTarget,
} from '../../application/game';
import { isGameTarget } from '../../application/game/gameTarget';
import { ROBLOX_SECRETS } from '../../application/game/robloxCloud';
import { IOS_SIGNING_SECRETS } from '../../application/game/adapters/ios';

/** A generated game is a document, not a payload; well above any real one. */
const MAX_GAME_BYTES = 400_000;

const assertProject = (db: Db, tenantId: number, raw: string) =>
  findProjectForTenant(db, tenantId, Number(raw));

interface GameBody {
  title?: unknown;
  brief?: unknown;
  html?: unknown;
  subdomain?: unknown;
  universeId?: unknown;
  placeId?: unknown;
  slug?: unknown;
}

/** A body that failed to parse is an empty one, not a failure — every field is
 *  optional and validated individually, so a shared reader keeps that in one place. */
const readBody = (c: { req: { json: <T>() => Promise<T> } }): Promise<GameBody> =>
  c.req.json<GameBody>().catch(() => ({}) as GameBody);

const optionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Read + validate the posted game, or answer with the reason it is unusable. */
function readGame(body: GameBody) {
  const html = typeof body.html === 'string' ? body.html : '';
  if (!html.trim()) return { ok: false as const, reason: 'No game was supplied. Generate the game first.' };
  if (html.length > MAX_GAME_BYTES) {
    return { ok: false as const, reason: `A game must be under ${MAX_GAME_BYTES / 1000}KB as a single document.` };
  }
  return buildGame({
    title: String(body.title ?? ''),
    brief: String(body.brief ?? ''),
    html,
  });
}

export function createGameRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/:projectId/game', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const env = c.env as Env & { UPLOADS?: R2Bucket };
    const [states, secrets] = await Promise.all([
      listGameTargetStates(env, db, tenantId, project.id),
      listProjectSecrets(db, tenantId, project.id),
    ]);
    const have = new Set(secrets.map((secret) => secret.name));

    return c.json({
      targets: GAME_TARGET_SUMMARIES,
      states,
      // The credentials each optional capability needs, and whether they are
      // present — computed rather than remembered, so removing a secret takes
      // effect immediately.
      credentials: {
        roblox: ROBLOX_SECRETS.map((secret) => ({ ...secret, present: have.has(secret.name) })),
        ios: IOS_SIGNING_SECRETS.map((secret) => ({ ...secret, present: have.has(secret.name) })),
      },
    });
  });

  router.post('/:projectId/game/targets/:target', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const target = c.req.param('target');
    if (!isGameTarget(target)) return c.json({ error: `Unknown game target "${target}"` }, 400);

    const env = c.env as Env & { UPLOADS?: R2Bucket };
    if (!env.UPLOADS) return c.json({ error: 'File storage is unavailable' }, 503);

    const body = await readBody(c);
    const game = readGame(body);
    if (!game.ok) return c.json({ error: game.reason }, 422);

    const result = await materializeGameTarget({
      env,
      db,
      bucket: env.UPLOADS,
      tenantId,
      projectId: project.id,
      target,
      game: game.game,
    });
    if (!result.ok) return c.json({ error: result.reason }, result.status);
    return c.json({ state: result.state, files: result.writtenPaths });
  });

  router.post('/:projectId/game/publish', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const env = c.env as Env & { UPLOADS?: R2Bucket };
    if (!env.UPLOADS) return c.json({ error: 'File storage is unavailable' }, 503);

    const body = await readBody(c);
    const game = readGame(body);
    if (!game.ok) return c.json({ error: game.reason }, 422);

    const published = await publishGameAsPwa({
      env,
      db,
      bucket: env.UPLOADS,
      tenantId,
      projectId: project.id,
      game: game.game,
      subdomain: optionalString(body.subdomain),
    });
    if (!published.ok) return c.json({ error: published.error }, published.status as 400);
    return c.json({ url: published.url, state: published.state });
  });

  router.post('/:projectId/game/roblox/publish', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const env = c.env as Env & { UPLOADS?: R2Bucket };
    if (!env.UPLOADS) return c.json({ error: 'File storage is unavailable' }, 503);

    const body = await readBody(c);
    const game = readGame(body);
    if (!game.ok) return c.json({ error: game.reason }, 422);

    const published = await publishGameToRoblox({
      env,
      db,
      bucket: env.UPLOADS,
      tenantId,
      projectId: project.id,
      game: game.game,
      universeId: String(body.universeId ?? ''),
      placeId: String(body.placeId ?? ''),
    });
    if (!published.ok) return c.json({ error: published.error }, published.status as 400);
    return c.json({ placeUrl: published.placeUrl, versionNumber: published.versionNumber, state: published.state });
  });

  router.put('/:projectId/game/roblox/target', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const body = await readBody(c);
    const slug = optionalString(body.slug);
    if (!slug) return c.json({ error: 'A game slug is required' }, 400);

    const saved = await setRobloxPublishTarget({
      env: c.env as Env,
      db,
      tenantId,
      projectId: project.id,
      slug,
      universeId: String(body.universeId ?? ''),
      placeId: String(body.placeId ?? ''),
    });
    if (!saved.ok) return c.json({ error: saved.error }, 400);
    return c.json({ ok: true });
  });

  return router;
}

/**
 * A project's generated media library — `/api/projects/:projectId/media`.
 *
 *   GET    /media              the project's images and clips, newest first
 *   POST   /media              record one just generated (or a video job just started)
 *   PATCH  /media/:mediaId     a video job finished or failed, or the asset was used
 *   DELETE /media/:mediaId     drop it from the library (the stored bytes stay)
 *
 * Generation itself is NOT here: images and clips are made by the gateway
 * (`/llm/v1/images`, `/llm/v1/videos`), which owns vendors and credits. This is
 * only the record of what was made for this project. See `application/media/projectMedia.ts`.
 */

import { Hono, type Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authMiddleware } from '../middleware/authMiddleware';
import { parseBody, z } from './requestBody';
import {
  PROJECT_MEDIA_KINDS,
  PROJECT_MEDIA_STATUSES,
  listProjectMedia,
  recordProjectMedia,
  removeProjectMedia,
  updateProjectMedia,
} from '../../application/media/projectMedia';

const nullableString = (max: number) => z.string().max(max).nullable().optional();
const nullableNumber = z.number().nonnegative().nullable().optional();

const RecordMediaBody = z.object({
  kind: z.enum(PROJECT_MEDIA_KINDS),
  status: z.enum(PROJECT_MEDIA_STATUSES),
  prompt: z.string().trim().min(1).max(4_000),
  url: nullableString(4_000),
  storageKey: nullableString(1_024),
  mimeType: nullableString(128),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: nullableNumber,
  model: nullableString(200),
  jobId: nullableString(64),
});

const PatchMediaBody = z.object({
  status: z.enum(PROJECT_MEDIA_STATUSES).optional(),
  url: nullableString(4_000),
  storageKey: nullableString(1_024),
  mimeType: nullableString(128),
  durationSeconds: nullableNumber,
  model: nullableString(200),
  jobId: nullableString(64),
  error: nullableString(1_000),
  used: z.boolean().optional(),
});

const NOT_FOUND = { error: 'Not found' } as const;
const MEDIA_ID = /^[0-9a-f-]{36}$/i;

const projectIdOf = (c: Context<HonoEnv>): number => Number(c.req.param('projectId'));
const tenantIdOf = (c: Context<HonoEnv>): number => c.get('tenantId') as number;

export function createProjectMediaRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/:projectId/media', async (c) => {
    const media = await listProjectMedia(c.env as Env, db, tenantIdOf(c), projectIdOf(c));
    return media ? c.json({ media }) : c.json(NOT_FOUND, 404);
  });

  router.post('/:projectId/media', async (c) => {
    const body = await parseBody(c, RecordMediaBody);
    const item = await recordProjectMedia(c.env as Env, db, {
      tenantId: tenantIdOf(c),
      projectId: projectIdOf(c),
      userId: (c.get('userId') as string | undefined) ?? null,
      media: body,
    });
    return item ? c.json({ media: item }, 201) : c.json(NOT_FOUND, 404);
  });

  router.patch('/:projectId/media/:mediaId', async (c) => {
    const mediaId = c.req.param('mediaId');
    if (!MEDIA_ID.test(mediaId)) return c.json(NOT_FOUND, 404);
    const patch = await parseBody(c, PatchMediaBody);
    const item = await updateProjectMedia(c.env as Env, db, { tenantId: tenantIdOf(c), projectId: projectIdOf(c), mediaId, patch });
    return item ? c.json({ media: item }) : c.json(NOT_FOUND, 404);
  });

  router.delete('/:projectId/media/:mediaId', async (c) => {
    const mediaId = c.req.param('mediaId');
    if (!MEDIA_ID.test(mediaId)) return c.json(NOT_FOUND, 404);
    const removed = await removeProjectMedia(c.env as Env, db, { tenantId: tenantIdOf(c), projectId: projectIdOf(c), mediaId });
    return removed ? c.json({ ok: true }) : c.json(NOT_FOUND, 404);
  });

  return router;
}

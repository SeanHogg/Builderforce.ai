/**
 * `/api/observability/exporters` — where a workspace sends its agent telemetry.
 *
 * Manager-level throughout, including the read: an exporter row names an external
 * destination for this workspace's run data, so who can see it and who can change
 * it are the same question. The credential is write-only — `hasHeaders` is all a
 * reader ever gets back.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { parseBody } from './requestBody';
import {
  createExporter,
  deleteExporter,
  listExporters,
  updateExporter,
} from '../../application/observability/otelExporter';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';

/** Headers are an object of string values — a vendor token, not arbitrary JSON. */
const headers = z.record(z.string(), z.string().max(2_000));

const createSchema = z.object({
  name: z.string().min(1).max(255),
  endpoint: z.string().min(1),
  headers: headers.optional(),
  serviceName: z.string().max(255).optional(),
  sampleRate: z.number().min(0).max(1).optional(),
  enabled: z.boolean().optional(),
});

/** `headers: null` clears the stored credential; omitting it keeps what is stored. */
const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  endpoint: z.string().min(1).optional(),
  headers: headers.nullable().optional(),
  serviceName: z.string().max(255).nullable().optional(),
  sampleRate: z.number().min(0).max(1).optional(),
  enabled: z.boolean().optional(),
});

export function createObservabilityExportRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  router.get('/', async (c) => c.json({ exporters: await listExporters(db, c.get('tenantId')) }));

  router.post('/', async (c) => {
    const body = await parseBody(c, createSchema);
    const r = await createExporter(c.env as Env, db, c.get('tenantId'), c.get('userId'), body);
    if (!r.ok) return c.json({ error: r.error }, 400);
    return c.json({ exporter: r.exporter }, 201);
  });

  router.patch('/:id', async (c) => {
    const body = await parseBody(c, updateSchema);
    const r = await updateExporter(c.env as Env, db, c.get('tenantId'), c.req.param('id'), body);
    if (!r.ok) return c.json({ error: r.error }, r.error === 'Exporter not found' ? 404 : 400);
    return c.json({ exporter: r.exporter });
  });

  router.delete('/:id', async (c) => {
    const removed = await deleteExporter(c.env as Env, db, c.get('tenantId'), c.req.param('id'));
    if (!removed) return c.json({ error: 'Exporter not found' }, 404);
    return c.json({ ok: true });
  });

  return router;
}

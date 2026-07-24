/**
 * Dataset route — /api/dataset
 *
 * Exports the SFT / DPO fine-tuning datasets distilled from a tenant's own
 * run-outcome telemetry (see application/dataset/trainingDataset.ts). This is the
 * "adapt on your own data" surface the cookbook assumes: point the EvermindLM
 * LoRA/QLoRA trainer (or any pipeline) at these records.
 *
 *   • GET /api/dataset/sft  — positive-outcome {prompt, completion} examples.
 *   • GET /api/dataset/dpo  — same-prompt {chosen, rejected} preference pairs.
 *
 * `?format=jsonl` streams newline-delimited JSON for a training job; default is a
 * JSON envelope with a count. Both are tenant-scoped and cached read-through.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { buildSftDataset, buildDpoDataset, toJsonl } from '../../application/dataset/trainingDataset';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createDatasetRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/sft', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const records = await buildSftDataset(c.env as Env, db, tenantId, {
      actionType: c.req.query('actionType') || undefined,
      minScore: c.req.query('minScore') ? Number(c.req.query('minScore')) : undefined,
      requireMerged: c.req.query('requireMerged') === 'true',
      requireCiGreen: c.req.query('requireCiGreen') === 'true',
      limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
    });
    if (c.req.query('format') === 'jsonl') {
      return new Response(toJsonl(records), { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } });
    }
    return c.json({ kind: 'sft', count: records.length, records });
  });

  router.get('/dpo', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const records = await buildDpoDataset(c.env as Env, db, tenantId, {
      actionType: c.req.query('actionType') || undefined,
      minMargin: c.req.query('minMargin') ? Number(c.req.query('minMargin')) : undefined,
      scanLimit: c.req.query('scanLimit') ? Number(c.req.query('scanLimit')) : undefined,
    });
    if (c.req.query('format') === 'jsonl') {
      return new Response(toJsonl(records), { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } });
    }
    return c.json({ kind: 'dpo', count: records.length, records });
  });

  return router;
}

/**
 * Deck routes — /api/decks
 *
 * One DeckService behind two entry points: the Brain "generate deck" tool
 * (POST /generate → deckId + warnings, no binary) and the PMO download button
 * (GET /download → streamed .pptx). Plus the template library (list / promote
 * upload / delete) and a download-by-id for previously generated decks.
 *
 *   GET    /templates                list built-ins + tenant templates   (any member)
 *   POST   /templates                promote an uploaded .pptx → template (MANAGER)
 *   DELETE /templates/:id            delete a tenant template             (MANAGER)
 *   POST   /generate                 generate (returns deckId+warnings)   (any member)
 *   GET    /download?template=&quarter=  generate & stream the .pptx      (any member)
 *   GET    /:id/download             stream a previously generated deck   (any member)
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { listTemplates, createTemplateFromUpload, deleteTemplate } from '../../application/deck/TemplateLibraryService';
import { generateDeck, loadGeneratedDeck } from '../../application/deck/DeckService';
import type { DeckMode } from '../../application/deck/types';

const PPTX_CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function pptxResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(bytes, {
    headers: {
      'content-type': PPTX_CT,
      'content-disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'cache-control': 'no-store',
    },
  });
}

export function createDeckRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // List templates (built-ins + tenant's own).
  router.get('/templates', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const templates = await listTemplates(db, env, tenantId);
    return c.json({ templates: templates.map((t) => ({ id: t.id, name: t.name, description: t.description, archetype: t.archetype, isBuiltin: t.isBuiltin, fillable: !!t.r2Key })) });
  });

  // Promote an already-uploaded .pptx (brain upload key) into a tenant template.
  router.post('/templates', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = (c.get('userId') as string | undefined) ?? null;
    const body = await c.req.json<{ name?: string; description?: string; sourceKey?: string; archetype?: string }>();
    if (!body.name || !body.sourceKey) return c.json({ error: 'name and sourceKey are required' }, 400);
    if (!body.sourceKey.startsWith(`${tenantId}/`)) return c.json({ error: 'sourceKey not owned by tenant' }, 403);
    try {
      const rec = await createTemplateFromUpload(db, c.env as Env, tenantId, userId, {
        name: body.name,
        description: body.description,
        sourceKey: body.sourceKey,
        archetype: 'custom',
      });
      return c.json({ id: rec.id, name: rec.name, archetype: rec.archetype, tokens: rec.manifest.bindings.map((b) => b.token), fillable: !!rec.r2Key }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'promote failed' }, 400);
    }
  });

  router.delete('/templates/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const ok = await deleteTemplate(db, c.env as Env, tenantId, c.req.param('id'));
    return ok ? c.json({ deleted: c.req.param('id') }) : c.json({ error: 'not found' }, 404);
  });

  // Generate (Brain path) — returns the id + warnings + a download link, not binary.
  router.post('/generate', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = (c.get('userId') as string | undefined) ?? null;
    const body = await c.req.json<{ mode?: string; templateId?: string; quarter?: string; prompt?: string }>();
    const mode: DeckMode = body.mode === 'fill' ? 'fill' : 'generative';
    try {
      const result = await generateDeck(db, c.env as Env, { tenantId, userId, mode, templateId: body.templateId, quarter: body.quarter, prompt: body.prompt });
      return c.json({ deckId: result.deckId, filename: result.filename, warnings: result.warnings, downloadUrl: `/api/decks/${result.deckId}/download` }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'generation failed' }, 400);
    }
  });

  // Generate & stream (PMO button) — synchronous download.
  router.get('/download', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = (c.get('userId') as string | undefined) ?? null;
    const templateId = c.req.query('template') || undefined;
    const quarter = c.req.query('quarter') || undefined;
    const mode: DeckMode = c.req.query('mode') === 'fill' ? 'fill' : 'generative';
    try {
      const result = await generateDeck(db, c.env as Env, { tenantId, userId, mode, templateId, quarter });
      const res = pptxResponse(result.bytes, result.filename);
      if (result.warnings.length) res.headers.set('x-deck-warnings', String(result.warnings.length));
      return res;
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'generation failed' }, 400);
    }
  });

  // Stream a previously generated deck.
  router.get('/:id/download', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const found = await loadGeneratedDeck(db, c.env as Env, tenantId, c.req.param('id'));
    if (!found) return c.json({ error: 'not found' }, 404);
    return pptxResponse(found.bytes, found.filename);
  });

  return router;
}

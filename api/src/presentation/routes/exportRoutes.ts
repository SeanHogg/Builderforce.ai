/**
 * Export routes — /api/exports
 *
 * Turn a Brain capability reply into a real Office file, so a Document or a
 * Slides chat produces something usable outside the chat instead of markdown the
 * user has to reformat by hand.
 *
 *   POST /docx   { markdown, title? }  → .docx  (Document capability)
 *   POST /pptx   { markdown, title? }  → .pptx  (Slides capability)
 *
 * Spreadsheet/CSV is NOT here on purpose: the model already emits a ```csv fence,
 * so the client saves it directly with no round-trip.
 *
 * Stateless — nothing is persisted and nothing is read, so there is no cache or
 * invalidation surface (unlike /api/decks, which stores generated decks in R2).
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { HonoEnv } from '../../env';
import { markdownToDocx } from '../../application/office/docxWriter';
import { markdownToPptx } from '../../application/office/slidesRenderer';
import { slugify } from '../../domain/shared/strings';

const DOCX_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Cap the payload so one chat message can't turn into an unbounded render. */
const MAX_MARKDOWN_CHARS = 200_000;

interface ExportBody { markdown?: string; title?: string }

/** Validate + normalize the shared request body (markdown + a filename-safe title). */
function readBody(body: ExportBody): { error: string } | { markdown: string; title: string; name: string } {
  const markdown = (body.markdown ?? '').trim();
  if (!markdown) return { error: 'markdown is required' };
  if (markdown.length > MAX_MARKDOWN_CHARS) return { error: 'markdown too large' };
  const title = (body.title ?? '').trim().slice(0, 200);
  return { markdown, title, name: slugify(title || 'export', { maxLen: 60, fallback: 'export' }) };
}

function fileResponse(bytes: Uint8Array, filename: string, contentType: string): Response {
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'cache-control': 'no-store',
    },
  });
}

export function createExportRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.post('/docx', async (c) => {
    const parsed = readBody(await c.req.json<ExportBody>());
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    const bytes = markdownToDocx(parsed.markdown, parsed.title || undefined);
    return fileResponse(bytes, `${parsed.name}.docx`, DOCX_CT);
  });

  router.post('/pptx', async (c) => {
    const parsed = readBody(await c.req.json<ExportBody>());
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    try {
      const bytes = await markdownToPptx(parsed.markdown, parsed.title || undefined);
      return fileResponse(bytes, `${parsed.name}.pptx`, PPTX_CT);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'render failed' }, 400);
    }
  });

  return router;
}

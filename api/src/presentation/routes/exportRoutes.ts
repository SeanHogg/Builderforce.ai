/**
 * Export routes — /api/exports
 *
 * Turn a Brain capability reply into a real Office file, so a Document or a
 * Slides chat produces something usable outside the chat instead of markdown the
 * user has to reformat by hand.
 *
 *   POST /docx   { markdown, title? }          → .docx  (Document capability)
 *   POST /pptx   { markdown, title? }          → .pptx  (Slides capability)
 *   POST /xlsx   { columns, rows, title? }     → .xlsx  (Spreadsheet capability)
 *
 * CSV stays a client-side save with no round-trip — the model already emits a
 * ```csv fence and the browser can write those bytes itself. `.xlsx` is here
 * because it is a zip of XML parts, not a line of text: it is Excel's NATIVE
 * container, and CSV loses the header band, the column widths and every cell's
 * type on the way out.
 *
 * Stateless — nothing is persisted and nothing is read, so there is no cache or
 * invalidation surface (unlike /api/decks, which stores generated decks in R2).
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { HonoEnv } from '../../env';
import { markdownToDocx } from '../../application/office/docxWriter';
import { markdownToPptx } from '../../application/office/slidesRenderer';
import { MAX_XLSX_COLUMNS, MAX_XLSX_ROWS, rowsToXlsx, type XlsxCell } from '../../application/office/xlsxWriter';
import { slugify } from '../../domain/shared/strings';

const DOCX_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const XLSX_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Cap the payload so one chat message can't turn into an unbounded render. */
const MAX_MARKDOWN_CHARS = 200_000;

interface ExportBody { markdown?: string; title?: string }
interface SheetBody { columns?: unknown; rows?: unknown; title?: string }

/** Validate + normalize the shared request body (markdown + a filename-safe title). */
function readBody(body: ExportBody): { error: string } | { markdown: string; title: string; name: string } {
  const markdown = (body.markdown ?? '').trim();
  if (!markdown) return { error: 'markdown is required' };
  if (markdown.length > MAX_MARKDOWN_CHARS) return { error: 'markdown too large' };
  const title = (body.title ?? '').trim().slice(0, 200);
  return { markdown, title, name: slugify(title || 'export', { maxLen: 60, fallback: 'export' }) };
}

/** A cell the writer can represent. Anything else — an object, an array left in
 * a dataset row — becomes its JSON text rather than `[object Object]`. */
function readCell(value: unknown): XlsxCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** Validate + normalize a sheet payload into the writer's positional shape. */
function readSheet(body: SheetBody): { error: string } | { columns: string[]; rows: XlsxCell[][]; title: string; name: string } {
  const columns = (Array.isArray(body.columns) ? body.columns : []).map((column) => String(column ?? '')).slice(0, MAX_XLSX_COLUMNS);
  if (!columns.length) return { error: 'columns are required' };
  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  if (rawRows.length > MAX_XLSX_ROWS) return { error: 'too many rows' };
  const rows = rawRows.map((row) => Array.isArray(row) ? row.map(readCell) : columns.map(() => null));
  const title = (body.title ?? '').trim().slice(0, 200);
  return { columns, rows, title, name: slugify(title || 'sheet', { maxLen: 60, fallback: 'sheet' }) };
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

  router.post('/xlsx', async (c) => {
    const parsed = readSheet(await c.req.json<SheetBody>());
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    const bytes = rowsToXlsx({ columns: parsed.columns, rows: parsed.rows, ...(parsed.title ? { title: parsed.title } : {}) });
    return fileResponse(bytes, `${parsed.name}.xlsx`, XLSX_CT);
  });

  return router;
}

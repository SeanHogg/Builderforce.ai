/**
 * Export routes — /api/exports
 *
 * Turn a Brain capability reply into a real Office file, so a Document or a
 * Slides chat produces something usable outside the chat instead of markdown the
 * user has to reformat by hand.
 *
 *   POST /docx   { markdown, title? }          → .docx  (Document capability)
 *   POST /pdf    { markdown, title? }          → .pdf   (any document-shaped kind)
 *   POST /pptx   { markdown, title? }          → .pptx  (Slides capability)
 *   POST /xlsx   { columns, rows, title? }     → .xlsx  (Spreadsheet capability)
 *
 * `.pdf` joined them once there was a writer for it: the board used to answer
 * "Download PDF" by opening the browser's print dialog, which is not a file an
 * agent can attach, store as a run artifact, or reproduce for two people the
 * same way. CSV stays a client-side save with no round-trip — the model already emits a
 * ```csv fence and the browser can write those bytes itself. `.xlsx` is here
 * because it is a zip of XML parts, not a line of text: it is Excel's NATIVE
 * container, and CSV loses the header band, the column widths and every cell's
 * type on the way out.
 *
 * Stateless — nothing is persisted and nothing is read, so there is no cache or
 * invalidation surface (unlike /api/decks, which stores generated decks in R2).
 */

import { Hono, type Context, type Next } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Env, HonoEnv } from '../../env';
import { consumeGuestAllowance } from '../../application/guest/guestDailyCounter';
import { guestIdentityFromRequest } from '../../application/guest/guestToken';
import { GUEST_EXPORT_LIMITS } from '../../domain/tenant/PlanLimits';
import { markdownToDocx, type DocxTheme } from '../../application/office/docxWriter';
import { markdownToPdf, type PdfTheme } from '../../application/office/pdfWriter';
import { markdownToPptx } from '../../application/office/slidesRenderer';
import { MAX_XLSX_COLUMNS, MAX_XLSX_ROWS, rowsToXlsx, type XlsxCell } from '../../application/office/xlsxWriter';
import { slugify } from '../../domain/shared/strings';

const DOCX_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const XLSX_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF_CT = 'application/pdf';

/** Cap the payload so one chat message can't turn into an unbounded render. */
const MAX_MARKDOWN_CHARS = 200_000;

interface ExportBody { markdown?: string; title?: string; theme?: unknown; subtitle?: string; footer?: string }
interface SheetBody { columns?: unknown; rows?: unknown; title?: string }

/** Validate + normalize the shared request body (markdown + a filename-safe title). */
function readBody(body: ExportBody): { error: string } | { markdown: string; title: string; name: string } {
  const markdown = (body.markdown ?? '').trim();
  if (!markdown) return { error: 'markdown is required' };
  if (markdown.length > MAX_MARKDOWN_CHARS) return { error: 'markdown too large' };
  const title = (body.title ?? '').trim().slice(0, 200);
  return { markdown, title, name: slugify(title || 'export', { maxLen: 60, fallback: 'export' }) };
}

const HEX6 = /^#?[0-9a-f]{6}$/i;

function readDocxTheme(value: unknown): DocxTheme {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  return {
    ...(typeof row.accent === 'string' && HEX6.test(row.accent) ? { accent: row.accent } : {}),
    ...(row.font === 'sans' || row.font === 'serif' || row.font === 'mono' ? { font: row.font } : {}),
    ...(row.density === 'compact' || row.density === 'comfortable' || row.density === 'spacious' ? { density: row.density } : {}),
    ...(row.columns === 1 || row.columns === 2 ? { columns: row.columns } : {}),
  };
}

/** The PDF writer takes the same theme vocabulary as the .docx writer plus a
 *  second brand colour, so one `theme` object drives both containers. */
function readPdfTheme(value: unknown): PdfTheme {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  return {
    ...(typeof row.accent === 'string' && HEX6.test(row.accent) ? { accent: row.accent } : {}),
    ...(typeof row.secondary === 'string' && HEX6.test(row.secondary) ? { secondary: row.secondary } : {}),
    ...(row.font === 'sans' || row.font === 'serif' || row.font === 'mono' ? { font: row.font } : {}),
    ...(row.density === 'compact' || row.density === 'comfortable' || row.density === 'spacious' ? { density: row.density } : {}),
  };
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

/**
 * A tenant OR a signed guest — either may render a file here.
 *
 * These renders read nothing and persist nothing: the markdown or the rows come
 * in on the request and the bytes go straight back out. The credential therefore
 * exists to BOUND an open compute endpoint, not to scope data — and the person
 * who most needs the file is the logged-out visitor who just filled a board and
 * has nowhere to put it. Requiring a tenant meant a guest's "Download Word"
 * silently produced markdown instead.
 *
 * A guest is charged against its own UTC-day allowance (visitor + IP), the same
 * mechanic guest research uses. No guest token at all falls through to the
 * tenant check, so an authenticated request is unaffected.
 */
async function exportAccess(c: Context<HonoEnv>, next: Next): Promise<Response | void> {
  const guest = await guestIdentityFromRequest(c.req.raw, c.env.JWT_SECRET);
  if (!guest) return authMiddleware(c, next);
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
  const allowance = await consumeGuestAllowance(c.env as Env, 'guestexport', guest.visitorId, ip, {
    visitorDailyLimit: GUEST_EXPORT_LIMITS.exportsDailyLimit,
    ipDailyLimit: GUEST_EXPORT_LIMITS.ipExportsDailyLimit,
  });
  if (!allowance.allowed) {
    // 429, not 402: a guest has no plan to upgrade, so the next step is signing
    // up. `terminal` so the client falls back to its own format rather than
    // retrying a ceiling that will not move until tomorrow.
    return c.json({
      error: allowance.reason === 'ip'
        ? 'This device has reached its free download limit for today. Sign up free to keep going.'
        : `You've used your ${allowance.limit} free downloads for today. Sign up free to keep going.`,
      code: 'guest_export_limit_reached',
      reason: allowance.reason,
      limit: allowance.limit,
      terminal: true,
    }, 429);
  }
  return next();
}

export function createExportRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', exportAccess);

  router.post('/docx', async (c) => {
    const body = await c.req.json<ExportBody>();
    const parsed = readBody(body);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    const bytes = markdownToDocx(parsed.markdown, parsed.title || undefined, readDocxTheme(body.theme));
    return fileResponse(bytes, `${parsed.name}.docx`, DOCX_CT);
  });

  router.post('/pdf', async (c) => {
    const body = await c.req.json<ExportBody>();
    const parsed = readBody(body);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    const subtitle = (body.subtitle ?? '').trim().slice(0, 200);
    const footer = (body.footer ?? '').trim().slice(0, 200);
    const bytes = markdownToPdf(parsed.markdown, parsed.title || undefined, readPdfTheme(body.theme), {
      ...(subtitle ? { subtitle } : {}),
      ...(footer ? { footer } : {}),
    });
    return fileResponse(bytes, `${parsed.name}.pdf`, PDF_CT);
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

/**
 * Legal documents — the workspace half, and the PUBLIC share link.
 *
 * Same split as forms and signatures, and the same reason: an external
 * counterparty holding a share link has no session, so their read cannot sit
 * under `authMiddleware`. Every rule lives in `legalDocumentStore.ts`; this
 * translates and streams bytes.
 *
 *   POST   /api/legal-documents                    upload (multipart)   MANAGER
 *   GET    /api/legal-documents/:id                 detail, derived status  any member
 *   GET    /api/legal-documents/:id/download        stream the file       any member
 *   POST   /api/legal-documents/:id/share           mint a share link     MANAGER
 *   POST   /api/legal-documents/shares/:shareId/revoke  revoke it         MANAGER
 *   POST   /api/legal-documents/:id/request-signature   send for signature MANAGER
 *
 *   GET    /api/public/legal-documents/:token             metadata, no session
 *   GET    /api/public/legal-documents/:token/download     stream, no session
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import {
  LegalDocumentError,
  downloadLegalDocumentFile,
  getLegalDocumentFile,
  requestLegalDocumentSignature,
  resolveLegalDocumentShare,
  revokeLegalDocumentShare,
  shareLegalDocumentFile,
  uploadLegalDocumentFile,
} from '../../application/legal/legalDocumentStore';
import { SignatureError } from '../../application/signature/signatureEngine';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LegalDocumentError || error instanceof SignatureError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

function fileResponse(bytes: Uint8Array, filename: string, mime: string | null, disposition: 'attachment' | 'inline' = 'attachment'): Response {
  return new Response(bytes, {
    headers: {
      'content-type': mime || 'application/octet-stream',
      'content-disposition': `${disposition}; filename="${filename.replace(/"/g, '')}"`,
      'cache-control': 'no-store',
    },
  });
}

export function createLegalDocumentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.post('/', requireRole(TenantRole.MANAGER), (c) => handle(async () => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const userId = (c.get('userId') as string | undefined) ?? null;
    const actor = await resolveActorFromContext(env, db, c);

    const form = await c.req.formData();
    const file = form.get('file') as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') return Response.json({ error: 'A "file" field is required.' }, { status: 400 });
    const title = String(form.get('title') ?? file.name ?? '').trim();
    const parseId = (v: unknown): number | null => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    };

    const result = await uploadLegalDocumentFile(db, env, tenantId, {
      documentId: typeof form.get('documentId') === 'string' ? (form.get('documentId') as string) : null,
      title,
      category: typeof form.get('category') === 'string' ? (form.get('category') as string) : undefined,
      entityId: parseId(form.get('entityId')),
      matterId: parseId(form.get('matterId')),
      ipId: parseId(form.get('ipId')),
      objectId: typeof form.get('objectId') === 'string' ? (form.get('objectId') as string) : null,
      filename: file.name || 'document',
      mime: file.type || null,
      bytes: new Uint8Array(await file.arrayBuffer()),
      actor,
      createdBy: userId,
    });
    return Response.json(result, { status: 201 });
  }));

  router.get('/:id', (c) => handle(async () => {
    const tenantId = c.get('tenantId') as number;
    const detail = await getLegalDocumentFile(db, tenantId, c.req.param('id'));
    return detail ? Response.json({ document: detail }) : Response.json({ error: 'No such legal document.' }, { status: 404 });
  }));

  router.get('/:id/download', (c) => handle(async () => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const actor = await resolveActorFromContext(env, db, c);
    const file = await downloadLegalDocumentFile(db, env, tenantId, c.req.param('id'), actor);
    return fileResponse(file.bytes, file.filename, file.mime);
  }));

  router.post('/:id/share', requireRole(TenantRole.MANAGER), (c) => handle(async () => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const userId = (c.get('userId') as string | undefined) ?? null;
    const actor = await resolveActorFromContext(env, db, c);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const result = await shareLegalDocumentFile(db, env, tenantId, {
      documentId: c.req.param('id'),
      permission: body.permission === 'download' ? 'download' : 'view',
      recipientEmail: typeof body.recipientEmail === 'string' ? body.recipientEmail : null,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
      actor,
      createdBy: userId,
    });
    return Response.json(result, { status: 201 });
  }));

  router.post('/shares/:shareId/revoke', requireRole(TenantRole.MANAGER), (c) => handle(async () => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const actor = await resolveActorFromContext(env, db, c);
    await revokeLegalDocumentShare(db, env, tenantId, c.req.param('shareId'), actor);
    return Response.json({ ok: true });
  }));

  router.post('/:id/request-signature', requireRole(TenantRole.MANAGER), (c) => handle(async () => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const userId = (c.get('userId') as string | undefined) ?? null;
    const actor = await resolveActorFromContext(env, db, c);
    const body = await c.req.json<Record<string, unknown>>();
    const parties = Array.isArray(body.parties)
      ? body.parties.flatMap((p) => {
          const row = p as { name?: unknown; email?: unknown; partyRef?: unknown };
          return typeof row.name === 'string' && typeof row.email === 'string'
            ? [{ name: row.name, email: row.email, partyRef: typeof row.partyRef === 'string' ? row.partyRef : null }]
            : [];
        })
      : [];
    const result = await requestLegalDocumentSignature(db, env, tenantId, {
      documentId: c.req.param('id'),
      subject: String(body.subject ?? ''),
      intent: typeof body.intent === 'string' ? body.intent : undefined,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
      ...(Number.isFinite(body.remindAfterDays) ? { remindAfterDays: Number(body.remindAfterDays) } : {}),
      parties,
      actor,
      createdBy: userId,
    });
    return Response.json(result);
  }));

  return router;
}

/** The external recipient's read. No session — the token in the path is the
 *  credential, exactly as the signer's and the form respondent's are. */
export function createPublicLegalDocumentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/:token', (c) => handle(async () => {
    const env = c.env as Env;
    const resolved = await resolveLegalDocumentShare(db, env, c.req.param('token'));
    if (!resolved) return Response.json({ error: 'That share link is not valid.' }, { status: 404 });
    return Response.json({
      document: { title: resolved.title, permission: resolved.permission, mime: resolved.mime, filename: resolved.filename },
    });
  }));

  router.get('/:token/download', (c) => handle(async () => {
    const env = c.env as Env;
    const resolved = await resolveLegalDocumentShare(db, env, c.req.param('token'));
    if (!resolved) return Response.json({ error: 'That share link is not valid.' }, { status: 404 });
    // 'view' renders inline (a PDF opens in-tab, no save dialog) and 'download'
    // forces one — both permissions serve the SAME bytes, standard browser
    // Content-Disposition behavior is what actually enforces the distinction a
    // recipient experiences; a 403 for 'view' would make the link do nothing.
    return fileResponse(resolved.bytes, resolved.filename, resolved.mime, resolved.permission === 'download' ? 'attachment' : 'inline');
  }));

  return router;
}

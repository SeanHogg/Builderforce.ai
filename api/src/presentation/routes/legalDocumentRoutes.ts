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
 *   POST   /api/legal-documents/:id/data-room       put it in a room      MANAGER
 *   POST   /api/legal-documents/shares/:shareId/revoke  revoke it         MANAGER
 *   POST   /api/legal-documents/:id/request-signature   send for signature MANAGER
 *
 *   GET    /api/public/legal-documents/:token             metadata, no session
 *   GET    /api/public/legal-documents/:token/download     stream, no session
 */

import { Hono } from 'hono';
import {
  DOCUMENT_KINDS,
  TermsError,
  acceptanceHistory,
  bindOrganisation,
  currentAcceptances,
  isDocumentKind,
  recordAcceptance,
  supersedeEarlierVersions,
  tenantComplianceSummary,
  type DocumentKind,
} from '../../application/legal/termsAcceptance';
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
  setLegalDocumentDataRoom,
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
      dataRoomId: parseId(form.get('dataRoomId')),
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

  /** Put this file in a data room, or take it out (0937). MANAGER, because it
   *  changes what an external firm holding a room link can read. */
  router.post('/:id/data-room', requireRole(TenantRole.MANAGER), (c) => handle(async () => {
    const body = await c.req.json<{ dataRoomId?: unknown }>();
    const raw = Number(body.dataRoomId);
    await setLegalDocumentDataRoom(
      db,
      c.env as Env,
      c.get('tenantId') as number,
      c.req.param('id'),
      Number.isInteger(raw) && raw > 0 ? raw : null,
      await resolveActorFromContext(c.env as Env, db, c),
    );
    return Response.json({ ok: true });
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
/**
 * Consent — the compliance half of the terms feature (PRD 19 §9).
 *
 * The GATE lives in `authMiddleware` and answers one question fast: must this
 * user accept before we serve them. These routes answer the questions an AUDIT
 * asks, which the gate structurally cannot: what was agreed, in what order, from
 * where, and which legal entity is bound.
 *
 *   GET  /api/legal-documents/consent/me            my standing acceptances    member
 *   GET  /api/legal-documents/consent/me/history    the full trail, superseded included
 *   POST /api/legal-documents/consent/accept        accept one document        member
 *   GET  /api/legal-documents/consent/tenant        the workspace's compliance member
 *   POST /api/legal-documents/consent/bind          bind the ORGANISATION      MANAGER
 *   POST /api/legal-documents/consent/supersede     publish a version          MANAGER
 *
 * MANAGER on bind and supersede: binding names a legal entity, and superseding
 * re-gates every user on the platform. Neither is an ordinary member edit.
 */
export function createConsentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const consent = async (run: () => Promise<Response>): Promise<Response> => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof TermsError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  };

  const kindOf = (v: unknown): DocumentKind => {
    if (!isDocumentKind(v)) throw new TermsError('kind must be one of: ' + DOCUMENT_KINDS.join(', '), 400);
    return v;
  };

  router.get('/consent/me', (c) => consent(async () =>
    Response.json({ acceptances: await currentAcceptances(db, String(c.get('userId') ?? '')) })));

  router.get('/consent/me/history', (c) => consent(async () =>
    Response.json({ history: await acceptanceHistory(db, String(c.get('userId') ?? '')) })));

  router.post('/consent/accept', (c) => consent(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    // Evidence is taken from the request, never from the body — an IP a client
    // can set is not evidence.
    const result = await recordAcceptance(
      db,
      c.env as Env,
      String(c.get('userId') ?? ''),
      kindOf(body.kind),
      String(body.version ?? ''),
      {
        tenantId: (c.get('tenantId') as number | undefined) ?? null,
        ipAddress: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
        userAgent: (c.req.header('user-agent') ?? '').slice(0, 500) || null,
        documentHash: typeof body.documentHash === 'string' ? body.documentHash : null,
      },
    );
    return Response.json(result);
  }));

  router.get('/consent/tenant', (c) => consent(async () =>
    Response.json(await tenantComplianceSummary(db, c.get('tenantId') as number))));

  router.post('/consent/bind', requireRole(TenantRole.MANAGER), (c) => consent(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await bindOrganisation(
      db,
      c.env as Env,
      c.get('tenantId') as number,
      await resolveActorFromContext(c.env as Env, db, c),
      {
        kind: kindOf(body.kind),
        version: String(body.version ?? ''),
        signatoryRef: String(body.signatoryRef ?? c.get('userId') ?? ''),
        signatoryTitle: typeof body.signatoryTitle === 'string' ? body.signatoryTitle : null,
        legalEntityName: typeof body.legalEntityName === 'string' ? body.legalEntityName : null,
      },
    ));
  }));

  router.post('/consent/supersede', requireRole(TenantRole.MANAGER), (c) => consent(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await supersedeEarlierVersions(
      db, c.env as Env, kindOf(body.kind), String(body.version ?? ''),
    ));
  }));

  return router;
}

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

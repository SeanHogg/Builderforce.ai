/**
 * The CEO's raise — `/api/investor` (IN-1 · IN-2 · IN-3 · IN-4).
 *
 * The generic entity path already reaches `companies`: it is a registered kind,
 * so `/api/investor/entities/companies` lists and writes rows. This is the other
 * thing, and the ROADMAP names the difference — a table viewer answers "what
 * columns does this row have", and a destination answers "what is the state of my
 * raise". Everything below is a read or a write the entity layer cannot express:
 * a company with its projects, its rooms, its round and its diligence gaps; an
 * investor invited to a COMPANY rather than to a room; and the pack.
 *
 *   GET    /companies                          the list, with counts        viewer
 *   POST   /companies                          create one                   MANAGER
 *   GET    /companies/:id                      projects, rooms, round, gaps viewer
 *   GET    /companies/:id/projects/available    what can still be attached  viewer
 *   POST   /companies/:id/projects              attach a project (IN-1)     MANAGER
 *   DELETE /companies/:id/projects/:projectId   detach one                  MANAGER
 *
 *   GET    /companies/:id/investors             who has access (IN-2)       viewer
 *   POST   /companies/:id/investors             invite one (+ the one NDA)  MANAGER
 *   POST   /companies/:id/investors/:grantId/revoke   one decision          MANAGER
 *   GET    /companies/:id/investors/analytics   rolled up to a PERSON       viewer
 *
 *   GET    /companies/:id/pack                  packs built for this company viewer
 *   POST   /companies/:id/pack                  build one (IN-4)            MANAGER
 *
 * MANAGER on every write that leaves the workspace, the same bar
 * `dataRoomRoutes` sets on `POST /:id/share`: inviting an investor sends an NDA
 * and mints a credential, and building a pack composes a document addressed
 * outward. The reads are viewer, because a founder's own team reading the state
 * of the raise is not an outbound act.
 *
 * The public half is `createPublicInvestorRoutes` at the bottom: the fund holding
 * the grant has no session, so its reads cannot sit under `authMiddleware` — the
 * same split legal documents, forms, signatures and data rooms already draw.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import {
  CompanyError,
  companyDetail,
  companyIdFrom,
  createCompany,
  linkProjectToCompany,
  listCompanies,
  unassignedProjects,
} from '../../application/investor/companyWorkspace';
import {
  InvestorAccessError,
  companyInvestorAnalytics,
  derivedTokenFor,
  inviteInvestorToCompany,
  listCompanyInvestors,
  openCompanyRoom,
  resolveInvestorGrant,
  revokeCompanyInvestor,
} from '../../application/investor/companyInvestorAccess';
import { buildFundraisingPack, listCompanyPacks } from '../../application/investor/fundraisingPack';
import { DataRoomError, readDataRoomDocument } from '../../application/investor/dataRoomSharing';
import type { RfpGenerateDeps } from '../../application/rfp/rfpService';
import type { TaskService } from '../../application/task/TaskService';
import type { ToolService } from '../../application/tools/ToolService';
import type { AuditRunner } from '../../application/tools/AuditRunner';
import { SignatureError } from '../../application/signature/signatureEngine';
import { TemplateError } from '../../application/legal/documentTemplates';
import { WatermarkError } from '../../application/security/documentWatermark';

/** One failure translation for the whole group, so the mapping from a rejected
 *  input to a status code exists once rather than in each handler — and an
 *  unexpected error is never flattened into a 400 that hides it. */
const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof CompanyError
      || error instanceof InvestorAccessError
      || error instanceof DataRoomError
      || error instanceof SignatureError
      || error instanceof TemplateError
      || error instanceof WatermarkError
    ) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

const projectIdFrom = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw new CompanyError('That is not a project id.', 400);
  return Math.floor(id);
};

export function createInvestorRoutes(
  db: Db,
  toolService: ToolService,
  auditRunner: AuditRunner,
  taskService: TaskService,
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** The SAME dependency bundle `rfpRoutes` builds, so the pack and a tender
   *  response cannot end up firing the Architect from one path and not the other. */
  const packDeps = (env: Env): RfpGenerateDeps => ({
    env,
    db,
    toolService,
    auditRunner,
    taskService,
    secret: env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '',
  });

  // ── companies ────────────────────────────────────────────────────────────

  router.get('/companies', (c) => handle(async () =>
    Response.json({ companies: await listCompanies(db, c.get('tenantId') as number) })));

  router.post('/companies', requireRole(TenantRole.MANAGER), (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const company = await createCompany(db, c.env as Env, c.get('tenantId') as number, {
      name: String(body.name ?? ''),
      website: typeof body.website === 'string' ? body.website : null,
      stage: typeof body.stage === 'string' ? body.stage : null,
      sector: typeof body.sector === 'string' ? body.sector : null,
      country: typeof body.country === 'string' ? body.country : null,
      headcount: typeof body.headcount === 'number' ? body.headcount : null,
      arr: typeof body.arr === 'string' ? body.arr : null,
      valuation: typeof body.valuation === 'string' ? body.valuation : null,
      currency: typeof body.currency === 'string' ? body.currency : null,
      isPortfolio: body.isPortfolio === true,
      actor: await resolveActorFromContext(c.env as Env, db, c),
    });
    return Response.json({ company }, { status: 201 });
  }));

  router.get('/companies/:id', (c) => handle(async () =>
    Response.json({ company: await companyDetail(db, c.get('tenantId') as number, companyIdFrom(c.req.param('id'))) })));

  // ── IN-1: a company owns the work being done inside it ────────────────────

  router.get('/companies/:id/projects/available', (c) => handle(async () => {
    // The company id is validated even though the read does not filter on it: a
    // picker opened against a company that is not here must 404 rather than
    // listing this workspace's unassigned projects under somebody else's heading.
    await companyDetail(db, c.get('tenantId') as number, companyIdFrom(c.req.param('id')));
    return Response.json({ projects: await unassignedProjects(db, c.get('tenantId') as number) });
  }));

  router.post('/companies/:id/projects', requireRole(TenantRole.MANAGER), (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const projectId = Number(body.projectId);
    if (!Number.isFinite(projectId) || projectId <= 0) throw new CompanyError('projectId is required.', 400);
    await linkProjectToCompany(db, c.env as Env, c.get('tenantId') as number, {
      projectId: Math.floor(projectId),
      companyId: companyIdFrom(c.req.param('id')),
      actor: await resolveActorFromContext(c.env as Env, db, c),
    });
    return Response.json({ ok: true });
  }));

  router.delete('/companies/:id/projects/:projectId', requireRole(TenantRole.MANAGER), (c) => handle(async () => {
    // The company id is still parsed, so a detach aimed at a company that is not
    // here fails as "not here" rather than silently clearing the column.
    await companyDetail(db, c.get('tenantId') as number, companyIdFrom(c.req.param('id')));
    await linkProjectToCompany(db, c.env as Env, c.get('tenantId') as number, {
      projectId: projectIdFrom(c.req.param('projectId')),
      companyId: null,
      actor: await resolveActorFromContext(c.env as Env, db, c),
    });
    return Response.json({ ok: true });
  }));

  // ── IN-2: an investor is invited to a COMPANY ─────────────────────────────

  router.get('/companies/:id/investors', (c) => handle(async () =>
    Response.json({
      investors: await listCompanyInvestors(db, c.env as Env, c.get('tenantId') as number, companyIdFrom(c.req.param('id'))),
    })));

  /**
   * Invite one investor to the company.
   *
   * MANAGER, like every other outbound act: this sends an NDA and mints a
   * credential that reaches every room this company has and every room it will
   * have — which is a larger authority than sharing one room, not a smaller one.
   */
  router.post('/companies/:id/investors', requireRole(TenantRole.MANAGER), (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const grant = await inviteInvestorToCompany(db, c.env as Env, c.get('tenantId') as number, {
      companyId: companyIdFrom(c.req.param('id')),
      recipientName: String(body.recipientName ?? ''),
      recipientEmail: String(body.recipientEmail ?? ''),
      firmPartyRef: typeof body.firmPartyRef === 'string' ? body.firmPartyRef : null,
      ...(body.permission === 'download' ? { permission: 'download' as const } : {}),
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
      jurisdiction: typeof body.jurisdiction === 'string' ? body.jurisdiction : null,
      purpose: typeof body.purpose === 'string' ? body.purpose : null,
      message: typeof body.message === 'string' ? body.message : null,
      skipNda: body.skipNda === true,
      actor: await resolveActorFromContext(c.env as Env, db, c),
      createdBy: (c.get('userId') as string | undefined) ?? null,
    });
    return Response.json(grant, { status: 201 });
  }));

  router.post('/companies/:id/investors/:grantId/revoke', requireRole(TenantRole.MANAGER), (c) => handle(async () => {
    const result = await revokeCompanyInvestor(
      db,
      c.env as Env,
      c.get('tenantId') as number,
      companyIdFrom(c.req.param('id')),
      c.req.param('grantId'),
      await resolveActorFromContext(c.env as Env, db, c),
    );
    return Response.json({ ok: true, ...result });
  }));

  router.get('/companies/:id/investors/analytics', (c) => handle(async () =>
    Response.json({
      analytics: await companyInvestorAnalytics(db, c.get('tenantId') as number, companyIdFrom(c.req.param('id'))),
    })));

  // ── IN-4: the pack ───────────────────────────────────────────────────────

  router.get('/companies/:id/pack', (c) => handle(async () =>
    Response.json({ packs: await listCompanyPacks(db, c.get('tenantId') as number, companyIdFrom(c.req.param('id'))) })));

  router.post('/companies/:id/pack', requireRole(TenantRole.MANAGER), (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const userId = (c.get('userId') as string | undefined) ?? '';
    const pack = await buildFundraisingPack(packDeps(c.env as Env), c.get('tenantId') as number, userId, {
      companyId: companyIdFrom(c.req.param('id')),
      // `undefined` means "pick the most recent project"; an explicit null is the
      // founder choosing the greenfield path. Those are different answers, so the
      // key is only set when the body actually carried one.
      ...(body.projectId === null
        ? { projectId: null }
        : typeof body.projectId === 'number'
          ? { projectId: body.projectId }
          : {}),
      audience: typeof body.audience === 'string' ? body.audience : null,
      emphasis: typeof body.emphasis === 'string' ? body.emphasis : null,
      actor: await resolveActorFromContext(c.env as Env, db, c),
      createdBy: userId || null,
    });
    // The document itself is `/api/rfp/responses/:id/document` — the ONE renderer,
    // so the pack and a tender response can never quote different numbers.
    return Response.json(pack, { status: 201 });
  }));

  return router;
}

/**
 * The fund's own read — no session, the token is the credential (IN-2).
 *
 *   GET /api/public/investor/:token                     the company + its rooms
 *   GET /api/public/investor/:token/rooms/:roomId       one room, through the grant
 *   GET /api/public/investor/:token/rooms/:roomId/documents/:documentId   the bytes
 *
 * Every rule — the NDA gate, both expiry clocks, the watermark — is enforced in
 * `companyInvestorAccess.ts` and, below it, in the `dataRoomSharing.ts` resolve
 * the derived token flows into. Nothing is re-tested here; this translates and
 * streams bytes, exactly as `createPublicDataRoomRoutes` does.
 */
export function createPublicInvestorRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * `nda-pending` is answered with 200 and an explicit outcome rather than 403,
   * because it is not a refusal: the fund has a valid grant and one thing left to
   * do. Every other failure collapses to 404, so an unauthenticated caller cannot
   * distinguish "never existed" from "revoked".
   */
  router.get('/:token', (c) => handle(async () => {
    const resolution = await resolveInvestorGrant(db, c.env as Env, c.req.param('token'));
    if (resolution.outcome === 'invalid') return Response.json({ error: 'This link is no longer valid.' }, { status: 404 });
    if (resolution.outcome === 'nda-pending') {
      return Response.json({ outcome: 'nda-pending', companyName: resolution.companyName, ndaState: resolution.ndaState });
    }
    const { tenantId: _tenantId, ...grant } = resolution.grant;
    return Response.json({ outcome: 'ok', grant });
  }));

  router.get('/:token/rooms/:roomId', (c) => handle(async () => {
    const roomId = Number(c.req.param('roomId'));
    if (!Number.isFinite(roomId) || roomId <= 0) return Response.json({ error: 'This link is no longer valid.' }, { status: 404 });
    const resolution = await openCompanyRoom(db, c.env as Env, c.req.param('token'), Math.floor(roomId));
    if (resolution.outcome === 'invalid') return Response.json({ error: 'This link is no longer valid.' }, { status: 404 });
    if (resolution.outcome === 'nda-pending') {
      return Response.json({ outcome: 'nda-pending', roomName: resolution.roomName, ndaState: resolution.ndaState });
    }
    const { tenantId: _tenantId, ...share } = resolution.share;
    return Response.json({ outcome: 'ok', share });
  }));

  /**
   * One document's bytes.
   *
   * The DERIVED token is formed here and handed to `readDataRoomDocument` — the
   * same function the room's own public route calls, which re-applies every
   * enforcement including the watermark. Deriving the token rather than adding a
   * second byte path is what keeps "a watermarked room never serves an
   * unstamped copy" a single implementation.
   *
   * `openCompanyRoom` runs FIRST so the derived share exists: a fund that deep-links
   * straight to a document without opening the room must still get the room's own
   * gate, not a 404 that reads like the document was deleted.
   */
  router.get('/:token/rooms/:roomId/documents/:documentId', (c) => handle(async () => {
    const token = c.req.param('token');
    const roomId = Number(c.req.param('roomId'));
    if (!Number.isFinite(roomId) || roomId <= 0) return Response.json({ error: 'This link is no longer valid.' }, { status: 404 });

    const opened = await openCompanyRoom(db, c.env as Env, token, Math.floor(roomId));
    if (opened.outcome === 'invalid') return Response.json({ error: 'This link is no longer valid.' }, { status: 404 });
    if (opened.outcome === 'nda-pending') {
      return Response.json(
        { error: 'This data room requires a signed NDA before its documents open. Sign the request you were sent, then reload.' },
        { status: 403 },
      );
    }

    const file = await readDataRoomDocument(
      db,
      c.env as Env,
      derivedTokenFor(token, Math.floor(roomId)),
      c.req.param('documentId'),
    );
    return new Response(file.bytes, {
      headers: {
        'content-type': file.mime,
        'content-disposition': `${file.disposition}; filename="${file.filename.replace(/"/g, '')}"`,
        // A watermarked room's documents must not sit in a shared cache: the stamp
        // names one recipient, and a cached copy would hand it to the next one.
        'cache-control': 'no-store',
        'x-data-room-watermark': file.stamped ? 'stamped' : 'view-only',
      },
    });
  }));

  return router;
}

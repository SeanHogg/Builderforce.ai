/**
 * The data room's share flow — the workspace half, and the PUBLIC link (FO-E2).
 *
 * Same split as legal documents, forms and signatures, and the same reason: the
 * firm holding the link has no session, so their read cannot sit under
 * `authMiddleware`. Every rule — the NDA gate, both expiry clocks, the watermark
 * — lives in `dataRoomSharing.ts`; this translates and streams bytes.
 *
 *   GET    /api/data-rooms                      the rooms, with readiness  member
 *   POST   /api/data-rooms/:id/share            mint a link (+ NDA)    MANAGER
 *   GET    /api/data-rooms/:id/shares           who has it, and its NDA  member
 *   POST   /api/data-rooms/shares/:shareId/revoke   revoke it          MANAGER
 *   GET    /api/data-rooms/:id/analytics        what they actually read  member
 *
 *   GET    /api/public/data-rooms/:token                    the room, no session
 *   GET    /api/public/data-rooms/:token/documents/:docId   the bytes, no session
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import {
  DataRoomError,
  dataRoomAnalytics,
  listDataRooms,
  listDataRoomShares,
  readDataRoomDocument,
  resolveDataRoomShare,
  revokeDataRoomShare,
  shareDataRoom,
} from '../../application/investor/dataRoomSharing';
import { SignatureError } from '../../application/signature/signatureEngine';
import { TemplateError } from '../../application/legal/documentTemplates';
import { WatermarkError } from '../../application/security/documentWatermark';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DataRoomError || error instanceof SignatureError || error instanceof TemplateError || error instanceof WatermarkError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

const roomId = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw new DataRoomError('That is not a data-room id.', 400);
  return Math.floor(id);
};

export function createDataRoomRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** Every room, with its documents, its live links and how much of it has been
   *  read — one call, because a card needs all of it at once. */
  router.get('/', (c) => handle(async () =>
    Response.json({ rooms: await listDataRooms(db, c.get('tenantId') as number) })));

  /**
   * Share a room with one firm.
   *
   * MANAGER, like every other outbound act: this sends diligence material to a
   * party outside the workspace, which is the same authority bar `dataRoom.share`
   * is gated at on the canvas.
   */
  router.post('/:id/share', requireRole(TenantRole.MANAGER), (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const result = await shareDataRoom(db, c.env as Env, c.get('tenantId') as number, {
      dataRoomId: roomId(c.req.param('id')),
      recipientName: String(body.recipientName ?? ''),
      recipientEmail: String(body.recipientEmail ?? ''),
      firmPartyRef: typeof body.firmPartyRef === 'string' ? body.firmPartyRef : null,
      ...(body.permission === 'download' ? { permission: 'download' as const } : {}),
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
      jurisdiction: typeof body.jurisdiction === 'string' ? body.jurisdiction : null,
      purpose: typeof body.purpose === 'string' ? body.purpose : null,
      actor: await resolveActorFromContext(c.env as Env, db, c),
      createdBy: (c.get('userId') as string | undefined) ?? null,
    });
    return Response.json(result);
  }));

  router.get('/:id/shares', (c) => handle(async () =>
    Response.json({ shares: await listDataRoomShares(db, c.get('tenantId') as number, roomId(c.req.param('id'))) })));

  router.post('/shares/:shareId/revoke', requireRole(TenantRole.MANAGER), (c) => handle(async () => {
    await revokeDataRoomShare(
      db,
      c.env as Env,
      c.get('tenantId') as number,
      c.req.param('shareId'),
      await resolveActorFromContext(c.env as Env, db, c),
    );
    return Response.json({ ok: true });
  }));

  /** What the firm actually read — the half of "sending a data room" that made
   *  the columns worth enforcing in the first place. */
  router.get('/:id/analytics', (c) => handle(async () =>
    Response.json({ analytics: await dataRoomAnalytics(db, c.get('tenantId') as number, roomId(c.req.param('id'))) })));

  return router;
}

export function createPublicDataRoomRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * The recipient's read. No session — the token is the credential.
   *
   * `nda-pending` is answered with 200 and an explicit outcome rather than 403,
   * because it is not a refusal: the recipient has a valid link and one thing left
   * to do, and the page needs to say which. Every other failure collapses to 404,
   * so an unauthenticated caller cannot distinguish "never existed" from "revoked".
   */
  router.get('/:token', (c) => handle(async () => {
    const resolution = await resolveDataRoomShare(db, c.env as Env, c.req.param('token'));
    if (resolution.outcome === 'invalid') return Response.json({ error: 'This link is no longer valid.' }, { status: 404 });
    if (resolution.outcome === 'nda-pending') {
      return Response.json({ outcome: 'nda-pending', roomName: resolution.roomName, ndaState: resolution.ndaState });
    }
    const { tenantId: _tenantId, ...share } = resolution.share;
    return Response.json({ outcome: 'ok', share });
  }));

  router.get('/:token/documents/:documentId', (c) => handle(async () => {
    // The id is PREFIXED (`dd:12` / `legal:<uuid>`) because a room holds two
    // shapes and a recipient does not care which table a document came from.
    const file = await readDataRoomDocument(db, c.env as Env, c.req.param('token'), c.req.param('documentId'));
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

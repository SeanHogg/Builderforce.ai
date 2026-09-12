import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { UserId } from '../../domain/shared/types';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import {
  buildPrivacyExport,
  fileAccountPrivacyRequest,
  filePublicPrivacyRequest,
  isAccountPrivacyRequestType,
  listAccountPrivacyRequests,
  publicPrivacyRequestType,
} from '../../application/legal/privacyRequests';
import { normalizeEmail } from '../../application/shared/dnsVerification';
import { parseBody, parseOptionalBody, z } from './requestBody';

/**
 * The data-subject-request channel (CCPA / GDPR), mounted at `/api/auth` so the
 * legal pages and Settings keep the URLs they already call:
 *
 *   POST /api/auth/privacy-requests       — public, from the legal pages
 *   GET  /api/auth/me/privacy-export      — WebJWT; the access/portability bundle
 *   POST /api/auth/me/privacy-requests    — WebJWT; filed as already verified
 *   GET  /api/auth/me/privacy-requests    — WebJWT; the person's own requests
 *
 * Its own module because privacy is not authentication; the SQL lives in
 * `application/legal/privacyRequests`.
 */
const RequestDetails = {
  details: z.string().optional(),
  jurisdiction: z.string().optional(),
  // Filed only when it is an integer; anything else is ignored rather than refused,
  // which is what the form has always done.
  parentRequestId: z.unknown().optional(),
};

const PublicRequestBody = z.object({ email: z.string().optional(), requestType: z.string().optional(), ...RequestDetails });
const AccountRequestBody = z.object({ requestType: z.string().optional(), ...RequestDetails });

export function createPrivacyRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/privacy-requests', async (c) => {
    const body = await parseBody(c, PublicRequestBody);
    const email = normalizeEmail(body.email ?? '');
    if (!email || !email.includes('@')) {
      return c.json({ error: 'Valid email is required' }, 400);
    }
    const created = await filePublicPrivacyRequest(db, {
      email,
      requestType: publicPrivacyRequestType(body.requestType),
      details: body.details,
      jurisdiction: body.jurisdiction,
      parentRequestId: body.parentRequestId,
    });
    return c.json({ ok: true, id: created.id });
  });

  router.get('/me/privacy-export', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as UserId;
    const bundle = await buildPrivacyExport(db, userId);
    if (!bundle) return c.json({ error: 'User not found' }, 404);
    c.header('Content-Disposition', `attachment; filename="builderforce-privacy-export-${userId}.json"`);
    c.header('Cache-Control', 'private, no-store');
    return c.json(bundle);
  });

  router.post('/me/privacy-requests', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as UserId;
    const body = await parseOptionalBody(c, AccountRequestBody);
    if (!isAccountPrivacyRequestType(body.requestType)) {
      return c.json({ error: 'Unsupported privacy request type' }, 400);
    }
    const request = await fileAccountPrivacyRequest(db, userId, {
      requestType: body.requestType,
      details: body.details,
      jurisdiction: body.jurisdiction,
      parentRequestId: body.parentRequestId,
    });
    if (!request) return c.json({ error: 'User not found' }, 404);
    return c.json({ ok: true, request }, 201);
  });

  router.get('/me/privacy-requests', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as UserId;
    return c.json({ requests: await listAccountPrivacyRequests(db, userId) });
  });

  return router;
}

/**
 * LTI platform registrations — /api/lti-registrations
 *
 * The admin surface the register said did not exist. Mounted on its own path
 * rather than under `/api/lti` because that tree is deliberately unauthenticated
 * (a platform posts a signed launch into it with no session), and hanging an
 * authenticated CRUD off the same mount is one middleware ordering mistake away
 * from either breaking launches or exposing registrations.
 *
 * MANAGER and above. A registration decides which LMS may create boards in this
 * workspace and mint grade-service tokens against it, which is an
 * institutional-trust decision, not a per-developer one.
 *
 * LAYER: parses, authorises, serialises. Every rule — what a valid endpoint URL
 * is, that the tool generates its own key, that a read never returns key
 * material — is in `application/lti/ltiRegistrationAdmin.ts`.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import { resolveApiOrigin } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  LtiAdminError,
  createRegistration,
  disableRegistration,
  enableRegistration,
  listRegistrations,
  rotateRegistrationKey,
  updateRegistration,
  type LtiRegistrationInput,
} from '../../application/lti/ltiRegistrationAdmin';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LtiAdminError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
};

/** Read the six fields an LMS administrator copies out of their tool
 *  configuration screen. Validation lives in the service — this only shapes. */
function readInput(body: Record<string, unknown>): LtiRegistrationInput {
  return {
    label: String(body.label ?? ''),
    issuer: String(body.issuer ?? ''),
    clientId: String(body.clientId ?? ''),
    deploymentIds: Array.isArray(body.deploymentIds)
      ? body.deploymentIds.map((id) => String(id))
      : String(body.deploymentIds ?? '').split(/[\s,]+/).filter(Boolean),
    authLoginUrl: String(body.authLoginUrl ?? ''),
    accessTokenUrl: String(body.accessTokenUrl ?? ''),
    keySetUrl: String(body.keySetUrl ?? ''),
  };
}

export function createLtiRegistrationRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  const tenant = (c: Context<HonoEnv>) => c.get('tenantId') as number;
  const id = (c: Context<HonoEnv>) => Number(c.req.param('id'));

  /**
   * The list, plus the three URLs an administrator has to paste back INTO their
   * LMS.
   *
   * Returned together deliberately: those URLs are the other half of the same
   * task, and the single most common cause of a registration that fails with
   * `invalid_client` and no further detail is one of them typed from memory.
   */
  router.get('/', (c) => handle(async () => {
    const origin = resolveApiOrigin(c.env);
    return Response.json({
      registrations: await listRegistrations(db, tenant(c)),
      tool: {
        oidcInitiationUrl: `${origin}/api/lti/login`,
        targetLinkUri: `${origin}/api/lti/launch`,
        publicJwkUrl: `${origin}/api/lti/jwks`,
        configUrl: `${origin}/api/lti/config`,
      },
    });
  }));

  /** Create — and generate the signing key. The public JWK comes back ONCE for
   *  the administrator to paste if their LMS wants the key inline rather than by
   *  URL; it is also permanently available at `/api/lti/jwks`. */
  router.post('/', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const created = await createRegistration(
      c.env as Env,
      db,
      tenant(c),
      readInput(body),
      (c.get('userId') as string | undefined) ?? null,
    );
    return Response.json(created, { status: 201 });
  }));

  router.put('/:id', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const registration = await updateRegistration(c.env as Env, db, tenant(c), id(c), readInput(body));
    return Response.json({ registration });
  }));

  /** Rotate. The response says the new key id so the screen can tell the admin to
   *  re-fetch the tool JWKS in their LMS — platforms cache it, and a rotation
   *  nobody mentioned surfaces as `invalid_client` a day later. */
  router.post('/:id/rotate-key', (c) => handle(async () => {
    return Response.json(await rotateRegistrationKey(c.env as Env, db, tenant(c), id(c)));
  }));

  router.post('/:id/disable', (c) => handle(async () => {
    return Response.json({ registration: await disableRegistration(c.env as Env, db, tenant(c), id(c)) });
  }));

  router.post('/:id/enable', (c) => handle(async () => {
    return Response.json({ registration: await enableRegistration(c.env as Env, db, tenant(c), id(c)) });
  }));

  return router;
}

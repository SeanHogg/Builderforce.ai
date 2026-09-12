/**
 * Passkey endpoints — enrolment (authenticated) and sign-in (not).
 *
 * Two routers rather than one, because the halves have opposite auth
 * requirements: enrolment is `webAuthMiddleware`-gated, because you add a key to
 * an account you are already signed in to and that is what makes the enrolment
 * trustworthy; sign-in cannot be gated, because signing in is what it does.
 * Mounting them together would mean a per-route exemption inside an otherwise
 * uniformly-gated file.
 *
 * Every decision — what a challenge means, whether an assertion stands up, what
 * the resulting session claims — lives in `application/auth/PasskeyService.ts`.
 * This file translates HTTP to that service and back, and reads no table.
 */

import { Hono, type Context } from 'hono';
import { resolveAppBaseUrl, type HonoEnv } from '../../env';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import {
  PasskeyError,
  beginPasskeyAuthentication,
  beginPasskeyRegistrationForUser,
  deletePasskey,
  finishPasskeyRegistration,
  listPasskeys,
  relyingPartyFor,
  renamePasskey,
  signInWithPasskey,
} from '../../application/auth/PasskeyService';
import type { Db } from '../../infrastructure/database/connection';
import { parseBody, parseOptionalBody, z, zOptionalString } from './requestBody';

/**
 * WebAuthn credential JSON is handed to the verifier whole, so both levels stay
 * loose — `type`, `authenticatorAttachment`, `clientExtensionResults` and whatever a
 * browser adds next pass through. Only the fields the verifier decodes are typed,
 * and they are exactly what every browser's credential serialises.
 */
const RegistrationBody = z.looseObject({
  id: z.string(),
  rawId: z.string(),
  response: z.looseObject({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
    transports: z.array(z.string()).optional(),
  }),
  // The service trims it and falls back to 'Passkey' when blank — the same
  // reading `zOptionalString` gives.
  name: zOptionalString,
});

const AuthenticationBody = z.looseObject({
  id: z.string(),
  rawId: z.string(),
  response: z.looseObject({
    clientDataJSON: z.string(),
    authenticatorData: z.string(),
    signature: z.string(),
    userHandle: z.string().nullish(),
  }),
  sessionName: z.string().nullish(),
});

const RenameBody = z.object({ name: z.string().nullish() });

const LoginOptionsBody = z.object({ email: z.string().nullish() });

function clientIp(c: Context<HonoEnv>): string | null {
  const cf = c.req.header('CF-Connecting-IP');
  if (cf) return cf.trim();
  return c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null;
}

function userAgent(c: Context<HonoEnv>): string | null {
  const ua = c.req.header('User-Agent');
  return ua ? ua.slice(0, 1024) : null;
}

/** The relying party is derived from the app's own base URL, never from the request. */
const relyingParty = (c: Context<HonoEnv>) => relyingPartyFor(resolveAppBaseUrl(c.env));

/** One place the service's typed failures become HTTP. */
async function handle(c: Context<HonoEnv>, run: () => Promise<Record<string, unknown>>): Promise<Response> {
  try {
    return c.json(await run());
  } catch (error) {
    if (error instanceof PasskeyError) return c.json({ error: error.message }, error.status);
    throw error;
  }
}

/** Enrolment and management. Requires an existing session. */
export function createPasskeyRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', webAuthMiddleware);

  // GET /api/auth/passkeys
  router.get('/', (c) => handle(c, async () => ({
    passkeys: await listPasskeys(db, c.get('userId') as string),
  })));

  // POST /api/auth/passkeys/register/options
  router.post('/register/options', (c) => handle(c, async () => ({
    options: await beginPasskeyRegistrationForUser(
      db,
      relyingParty(c),
      c.get('userId') as string,
      { ipAddress: clientIp(c) },
    ),
  })));

  // POST /api/auth/passkeys/register
  router.post('/register', (c) => handle(c, async () => ({
    passkey: await finishPasskeyRegistration(
      db,
      relyingParty(c),
      c.get('userId') as string,
      await parseBody(c, RegistrationBody),
    ),
  })));

  // PATCH /api/auth/passkeys/:id
  router.patch('/:id', (c) => handle(c, async () => {
    const body = await parseBody(c, RenameBody);
    return {
      passkey: await renamePasskey(db, c.get('userId') as string, Number(c.req.param('id')), body.name ?? ''),
    };
  }));

  // DELETE /api/auth/passkeys/:id
  router.delete('/:id', (c) => handle(c, async () => {
    await deletePasskey(db, c.get('userId') as string, Number(c.req.param('id')));
    return { ok: true };
  }));

  return router;
}

/** Sign-in. Unauthenticated by construction. */
export function createPasskeyLoginRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // POST /api/auth/passkey/options
  router.post('/options', (c) => handle(c, async () => {
    const body = await parseOptionalBody(c, LoginOptionsBody);
    return {
      options: await beginPasskeyAuthentication(db, relyingParty(c), {
        email: body.email ?? null,
        ipAddress: clientIp(c),
      }),
    };
  }));

  // POST /api/auth/passkey/verify
  router.post('/verify', (c) => handle(c, async () => {
    const body = await parseBody(c, AuthenticationBody);
    const issued = await signInWithPasskey(db, c.env.JWT_SECRET, relyingParty(c), body, {
      sessionName: body.sessionName ?? null,
      userAgent: userAgent(c),
      ipAddress: clientIp(c),
    });
    // `mfaRequired: false` is stated rather than omitted: the password flow returns
    // it, and a client branching on its presence must not read a passkey sign-in as
    // an unfinished one.
    return { ...issued, mfaRequired: false };
  }));

  return router;
}

/**
 * Payout routes — /api/payouts
 *
 * Where an earner's money goes, and what has left through it:
 *
 *   GET    /providers            → what this deployment offers + what is connected
 *   POST   /connections          → connect a `fields` provider (bank, Wise)
 *   GET    /connect/:provider    → the consent URL for an `oauth` provider
 *   GET    /callback/:provider   → provider redirect (PUBLIC, signed state)
 *   PUT    /connections/:id/default
 *   DELETE /connections/:id
 *   GET    /history              → payouts already sent
 *
 * Structurally the same as `driveRoutes` / `mailboxRoutes`, including the
 * callback's auth-middleware exception: a provider redirect is a top-level
 * navigation with no bearer token, so the SIGNED STATE authenticates it.
 *
 * One rule this file enforces that the others do not have to: a secret field a
 * person typed is WRITE-ONLY. It goes into the sealed credential and never comes
 * back out, so `/providers` returns the field DECLARATIONS (which the form needs)
 * and the masked label (which the list needs) and nothing else.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { resolveAppBaseUrl, type Env, type HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  buildProviderConsentUrl,
  completeProviderOAuthCallback,
} from '../../application/shared/providerOAuthConnect';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { PayoutAccountService } from '../../application/payouts/PayoutAccountService';
import {
  describePayoutProviders,
  getPayoutProvider,
  isPayoutProviderName,
  type PayoutCredential,
} from '../../application/payouts/payoutProviders';

/** Where the connect flow sends the browser back to when it is not told. */
const DEFAULT_RETURN_TO = '/billing/payouts';

export function createPayoutRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  r.use('*', async (c, next) => {
    if (c.req.path.includes('/callback/')) return next();
    return authMiddleware(c, next);
  });

  const service = (c: { env: unknown }) => new PayoutAccountService(db, c.env as Env);
  const callbackUrl = (c: { req: { url: string } }, provider: string) =>
    `${new URL(c.req.url).origin}/api/payouts/callback/${provider}`;

  r.get('/providers', async (c) => c.json({
    providers: describePayoutProviders(c.env as unknown as Record<string, unknown>),
    connections: await service(c).list(c.get('tenantId') as number, c.get('userId') as string),
  }));

  /** Connect a provider whose credential the earner TYPES. Required fields are
   *  checked here rather than in the adapter, so every provider's form fails the
   *  same way with the same message. */
  r.post('/connections', async (c) => {
    const body = await c.req.json<{ provider?: string; fields?: Record<string, unknown>; makeDefault?: boolean }>();
    const name = String(body.provider ?? '');
    const provider = isPayoutProviderName(name) ? getPayoutProvider(name) : null;
    if (!provider) return c.json({ error: 'Unknown payout provider.' }, 400);
    if (provider.connect !== 'fields') return c.json({ error: `${provider.label} is connected through consent, not a form.` }, 400);

    const fields: Record<string, string> = {};
    for (const field of provider.fields ?? []) {
      const raw = body.fields?.[field.key];
      const value = typeof raw === 'string' ? raw.trim().slice(0, 255) : '';
      if (!value && field.required) return c.json({ error: `${field.label} is required.` }, 400);
      if (value) fields[field.key] = value;
    }

    const account = await service(c).connect({
      userId: c.get('userId') as string,
      tenantId: c.get('tenantId') as number,
      provider: provider.name,
      credential: { fields },
      makeDefault: body.makeDefault === true,
    });
    return account ? c.json(account, 201) : c.json({ error: 'Could not save that payout destination.' }, 500);
  });

  r.get('/connect/:provider', async (c) => {
    const env = c.env as Env;
    const name = c.req.param('provider');
    const provider = isPayoutProviderName(name) ? getPayoutProvider(name) : null;
    if (!provider?.oauth) return c.json({ error: 'Unknown payout provider.' }, 400);

    const authUrl = await buildProviderConsentUrl(env, provider.oauth, {
      providerName: name,
      redirectUri: callbackUrl(c, name),
      userId: c.get('userId') as string,
      tenantId: c.get('tenantId') as number,
      returnTo: c.req.query('returnTo'),
      returnToFallback: DEFAULT_RETURN_TO,
    });
    if (!authUrl) return c.json({ error: `${provider.label} is not configured on this deployment.` }, 503);
    return c.json({ authUrl });
  });

  r.get('/callback/:provider', async (c) => {
    const env = c.env as Env;
    const name = c.req.param('provider');
    const provider = isPayoutProviderName(name) ? getPayoutProvider(name) : null;
    const base = resolveAppBaseUrl(env);

    if (c.req.query('error')) return c.redirect(`${base}${DEFAULT_RETURN_TO}?payout=declined`);
    const code = c.req.query('code');
    const rawState = c.req.query('state');
    if (!provider?.oauth || !code || !rawState) return c.redirect(`${base}${DEFAULT_RETURN_TO}?payout=error`);

    const result = await completeProviderOAuthCallback(env, provider.oauth, {
      providerName: name, code, rawState, redirectUri: callbackUrl(c, name),
    });
    if (!result.ok) {
      if (result.reason === 'exchange_failed') {
        reportCaughtError(result.error, { source: 'presentation/routes/payoutRoutes.ts', operation: 'callback' });
      }
      const returnTo = result.returnTo ?? DEFAULT_RETURN_TO;
      return c.redirect(`${base}${returnTo}?payout=${result.reason === 'exchange_failed' ? 'error' : result.reason}`);
    }

    const { state, tokens } = result;
    try {
      // Both OAuth payout vendors name the connected account in the token
      // response itself (Stripe's `stripe_user_id`, PayPal's id-token claims), so
      // there is no second round trip to identify it.
      const raw = tokens as unknown as Record<string, unknown>;
      const credential: PayoutCredential = {
        accessToken: tokens.access_token,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        ...(typeof raw.stripe_user_id === 'string' ? { externalAccountId: raw.stripe_user_id } : {}),
        ...(typeof raw.payer_id === 'string' ? { externalAccountId: raw.payer_id } : {}),
        ...(typeof raw.email === 'string' ? { fields: { email: raw.email } } : {}),
      };
      await new PayoutAccountService(db, env).connect({
        userId: state.userId,
        tenantId: state.tenantId,
        provider: provider.name,
        credential,
      });
      return c.redirect(`${base}${state.returnTo}?payout=connected`);
    } catch (error) {
      reportCaughtError(error, { source: 'presentation/routes/payoutRoutes.ts', operation: 'callback' });
      return c.redirect(`${base}${state.returnTo}?payout=error`);
    }
  });

  r.put('/connections/:id/default', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid connection id.' }, 400);
    const account = await service(c).setDefault(c.get('tenantId') as number, c.get('userId') as string, id);
    return account ? c.json(account) : c.json({ error: 'Payout destination not found.' }, 404);
  });

  r.delete('/connections/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid connection id.' }, 400);
    const removed = await service(c).disconnect(c.get('tenantId') as number, c.get('userId') as string, id);
    return removed ? c.json({ ok: true }) : c.json({ error: 'Payout destination not found.' }, 404);
  });

  r.get('/history', async (c) => c.json({
    payouts: await service(c).payouts(c.get('tenantId') as number, c.get('userId') as string, Number(c.req.query('limit') ?? 50)),
    paidCents: await service(c).paidCents(c.get('tenantId') as number, c.get('userId') as string),
  }));

  return r;
}

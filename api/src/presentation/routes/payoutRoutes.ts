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

import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { mountProviderOAuthConnect } from './providerOAuthConnectRoutes';
import { PayoutAccountService } from '../../application/payouts/PayoutAccountService';
import { userAccount } from '../../application/kernel/ledgerAccount';
import {
  describePayoutProviders,
  getPayoutProvider,
  isPayoutProviderName,
  type PayoutCredential,
  type PayoutProvider,
} from '../../application/payouts/payoutProviders';
import {
  connectWithdrawalMethod,
  removeWithdrawalMethod,
  setDefaultWithdrawalMethod,
  type WithdrawalContext,
  type WithdrawalRefusal,
} from '../../application/finance/withdrawalMethods';
import { limitParam } from './queryParams';
import { parseBody, z } from './requestBody';

/** Where the connect flow sends the browser back to when it is not told. */
const DEFAULT_RETURN_TO = '/billing/payouts';

/** The provider is checked against the registry below (so the 400 can name it);
 *  the field values are checked against THAT provider's declarations. */
const ConnectBody = z.object({
  provider: z.string().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  makeDefault: z.boolean().optional(),
});

/**
 * The wording this route has always answered a refused connect with. Kept stable for
 * existing clients; the refusal CODE comes from the shared use case.
 */
export function connectRefusalMessage(providerName: string, reason: WithdrawalRefusal, field?: string): string {
  const provider = isPayoutProviderName(providerName) ? getPayoutProvider(providerName) : null;
  if (!provider || reason === 'unknown_provider') return 'Unknown payout provider.';
  if (reason === 'wrong_connect_flow') return `${provider.label} is connected through consent, not a form.`;
  if (reason === 'missing_field') {
    const label = provider.fields?.find((f) => f.key === field)?.label ?? field ?? 'A field';
    return `${label} is required.`;
  }
  return 'Payout destination not found.';
}

export function createPayoutRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  r.use('*', async (c, next) => {
    if (c.req.path.includes('/callback/')) return next();
    return authMiddleware(c, next);
  });

  const service = (c: { env: unknown }) => new PayoutAccountService(db, c.env as Env);
  // The tenant JWT's workspace — the one difference from `/api/withdrawal-methods`,
  // which resolves the caller's OWN workspace for tenantless (web JWT) earners.
  const ctx = (c: Context<HonoEnv>): WithdrawalContext => ({
    tenantId: c.get('tenantId') as number,
    userId: c.get('userId') as string,
  });

  r.get('/providers', async (c) => c.json({
    providers: describePayoutProviders(c.env as unknown as Record<string, unknown>),
    connections: await service(c).list(c.get('tenantId') as number, c.get('userId') as string),
  }));

  /** Connect a provider whose credential the earner TYPES. Validation is the ONE
   *  rule in `connectWithdrawalMethod` (shared with `/api/withdrawal-methods`); this
   *  door only differs in WHICH tenant the credential is sealed under (the tenant
   *  JWT's) and in keeping its historical human-readable error strings. */
  r.post('/connections', async (c) => {
    const body = await parseBody(c, ConnectBody);
    const result = await connectWithdrawalMethod(db, c.env as Env, ctx(c), {
      provider: String(body.provider ?? ''),
      fields: body.fields ?? {},
      makeDefault: body.makeDefault === true,
    });
    if (result.ok) return c.json(result.method, 201);
    // The provider resolved and validated, so `not_saved` is the upsert returning no
    // row — an invariant failure the global handler reports, not a caller error.
    if (result.reason === 'not_saved') throw new Error('connections upsert returned no row');
    return c.json({ error: connectRefusalMessage(String(body.provider ?? ''), result.reason, result.field) }, 400);
  });

  // GET /connect/:provider + GET /callback/:provider — the shared connect pair;
  // only turning the token response into a payout credential is payouts' own.
  mountProviderOAuthConnect<PayoutProvider>(r, {
    callbackPath: (name) => `/api/payouts/callback/${name}`,
    outcomeParam: 'payout',
    defaultReturnTo: DEFAULT_RETURN_TO,
    source: 'presentation/routes/payoutRoutes.ts',
    resolveConnect: (name) => {
      const provider = isPayoutProviderName(name) ? getPayoutProvider(name) : null;
      return provider?.oauth ? { provider, oauth: provider.oauth, label: provider.label } : { error: 'Unknown payout provider.' };
    },
    onConnected: async (c, { provider, state, tokens }) => {
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
      await new PayoutAccountService(db, c.env as Env).connect({
        userId: state.userId,
        tenantId: state.tenantId,
        provider: provider.name,
        credential,
      });
      return 'connected';
    },
  });

  r.put('/connections/:id/default', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid connection id.' }, 400);
    const result = await setDefaultWithdrawalMethod(db, c.env as Env, ctx(c), id);
    return result.ok ? c.json(result.method) : c.json({ error: 'Payout destination not found.' }, 404);
  });

  r.delete('/connections/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid connection id.' }, 400);
    const removed = await removeWithdrawalMethod(db, c.env as Env, ctx(c), id);
    return removed ? c.json({ ok: true }) : c.json({ error: 'Payout destination not found.' }, 404);
  });

  r.get('/history', async (c) => c.json({
    payouts: await service(c).payouts(c.get('tenantId') as number, userAccount(c.get('userId') as string), limitParam(c.req.query('limit'), 50, 500)),
    paidCents: await service(c).paidCents(c.get('tenantId') as number, userAccount(c.get('userId') as string)),
  }));

  return r;
}

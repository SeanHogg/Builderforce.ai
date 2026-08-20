/**
 * Ledger routes — /api/ledger
 *
 * Connect a company's BOOKS, sync them, and read where its finance numbers came
 * from. This is the door for the seventh port in the family; the structure follows
 * `driveRoutes` deliberately, including the callback's auth-middleware exception —
 * a provider redirect is a top-level navigation with no bearer token, so it is
 * authenticated by the SIGNED STATE instead.
 *
 *   GET    /providers            → what this deployment offers + what is connected
 *   GET    /connect/:provider    → the consent URL to navigate to
 *   GET    /callback/:provider   → provider redirect (PUBLIC, signed state)
 *   POST   /connections          → connect a `fields` provider (NetSuite)
 *   DELETE /connections/:id      → disconnect
 *   POST   /sync                 → sync now, rather than waiting for the sweep
 *   GET    /summary              → the provenance behind burn, runway and cash
 *
 * Every handler is thin on purpose: the layering guard forbids a route owning a
 * query, and a route that owns one owns the tenant scoping in it — a tenancy
 * decision sitting where no other caller can reuse it and no use-case test covers it.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { resolveAppBaseUrl, type Env, type HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import {
  buildProviderConsentUrl,
  completeProviderOAuthCallback,
  verifyProviderConnectState,
} from '../../application/shared/providerOAuthConnect';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import {
  accountingProvider,
  describeAccountingProviders,
  isAccountingProviderName,
  AccountingProviderError,
} from '../../application/finance/accountingProviders';
import { exchangePlaidPublicToken } from '../../application/finance/accountingAdapters';
import {
  deleteLedgerConnection,
  listLedgerConnections,
  saveLedgerConnection,
} from '../../application/finance/ledgerConnections';
import { readLedgerSummary, syncTenantLedgers } from '../../application/finance/ledgerSync';

/** Where the connect flow sends the browser back to when it is not told. */
const DEFAULT_RETURN_TO = '/settings/integrations';

export function createLedgerRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  r.use('*', async (c, next) => {
    if (c.req.path.includes('/callback/')) return next();
    return authMiddleware(c, next);
  });

  const callbackUrl = (c: { req: { url: string } }, provider: string) =>
    `${new URL(c.req.url).origin}/api/ledger/callback/${provider}`;

  // GET /providers — the catalog AND what is already connected, in one call. Two
  // calls would let a UI render a "Connect" button beside a connected account for
  // as long as the second request was in flight.
  r.get('/providers', async (c) => c.json({
    providers: describeAccountingProviders(c.env as unknown as Record<string, unknown>),
    connections: await listLedgerConnections(db, c.get('tenantId') as number),
  }));

  /**
   * GET /connect/:provider — build the consent URL.
   *
   * Returned as JSON for the client to navigate to rather than as a 302 from here:
   * a top-level navigation cannot carry the bearer token, so the browser has to
   * make the jump itself after an authenticated fetch.
   */
  r.get('/connect/:provider', async (c) => {
    const env = c.env as Env;
    const name = c.req.param('provider');
    if (!isAccountingProviderName(name)) return c.json({ error: 'Unknown accounting provider.' }, 400);
    const provider = accountingProvider(name);
    if (provider.connect !== 'oauth' || !provider.oauth) {
      return c.json({ error: `${provider.label} is connected with typed fields, not a consent screen.` }, 400);
    }

    const authUrl = await buildProviderConsentUrl(env, provider.oauth, {
      providerName: name,
      redirectUri: callbackUrl(c, name),
      userId: c.get('userId') as string,
      tenantId: c.get('tenantId') as number,
      returnTo: c.req.query('returnTo'),
      returnToFallback: DEFAULT_RETURN_TO,
    });
    if (!authUrl) {
      return c.json({ error: `${provider.label} is not configured on this deployment.` }, 503);
    }
    return c.json({ authUrl });
  });

  // GET /callback/:provider — provider redirect (PUBLIC; authed by signed state).
  r.get('/callback/:provider', async (c) => {
    const env = c.env as Env;
    const name = c.req.param('provider');
    const base = resolveAppBaseUrl(env);
    const rawState = c.req.query('state');
    const code = c.req.query('code');

    // Declining consent is a normal outcome, not an error — say so.
    if (c.req.query('error')) return c.redirect(`${base}${DEFAULT_RETURN_TO}?ledger=declined`);
    if (!isAccountingProviderName(name) || !rawState) {
      return c.redirect(`${base}${DEFAULT_RETURN_TO}?ledger=error`);
    }
    const provider = accountingProvider(name);
    if (!provider.oauth) return c.redirect(`${base}${DEFAULT_RETURN_TO}?ledger=error`);

    /*
     * PLAID IS THE ONE EXCEPTION, and it is a wire-format difference rather than a
     * different security story. Link hands back a `public_token` instead of an
     * authorization code, so the state is verified through the SAME signed-state
     * primitive and only the exchange differs. The credential lands in the same
     * vault and the same `credentials` row as the other four — one storage path is
     * the invariant that matters, not one exchange.
     */
    if (name === 'plaid') {
      const publicToken = c.req.query('public_token');
      const bag = env as unknown as Record<string, string | undefined>;
      const clientId = bag.PLAID_CLIENT_ID;
      const secret = bag.PLAID_SECRET;
      if (!publicToken || !clientId || !secret) {
        return c.redirect(`${base}${DEFAULT_RETURN_TO}?ledger=unavailable`);
      }
      // The state carries the tenant and where to return; verifying it through the
      // shared callback with no code is not possible, so it is verified directly.
      const verified = await verifyProviderConnectState(env, name, rawState, DEFAULT_RETURN_TO);
      if (!verified) return c.redirect(`${base}${DEFAULT_RETURN_TO}?ledger=invalid_state`);
      try {
        const exchanged = await exchangePlaidPublicToken(
          { clientId, secret, environment: bag.PLAID_ENV }, publicToken,
        );
        await saveLedgerConnection(db, env, {
          tenantId: verified.tenantId,
          provider: name,
          externalAccount: exchanged.itemId,
          displayName: provider.label,
          accessToken: exchanged.accessToken,
          scope: provider.oauth.scopes.join(' '),
        });
        return c.redirect(`${base}${verified.returnTo}?ledger=connected`);
      } catch (error) {
        reportCaughtError(error, { source: 'presentation/routes/ledgerRoutes.ts', operation: 'plaidCallback' });
        return c.redirect(`${base}${verified.returnTo}?ledger=error`);
      }
    }

    if (!code) return c.redirect(`${base}${DEFAULT_RETURN_TO}?ledger=error`);
    const result = await completeProviderOAuthCallback(env, provider.oauth, {
      providerName: name, code, rawState, redirectUri: callbackUrl(c, name),
    });
    if (!result.ok) {
      if (result.reason === 'exchange_failed') {
        reportCaughtError(result.error, { source: 'presentation/routes/ledgerRoutes.ts', operation: 'callback' });
      }
      const returnTo = result.returnTo ?? DEFAULT_RETURN_TO;
      const outcome = result.reason === 'exchange_failed' ? 'error' : result.reason;
      return c.redirect(`${base}${returnTo}?ledger=${outcome}`);
    }

    const { state, tokens } = result;
    /*
     * The BOOK's own id, which every one of these providers needs in the request
     * and none of them carries in the token: QuickBooks returns `realmId` as a
     * query parameter on the redirect, Xero requires a second call to
     * `/connections`, and Stripe returns `stripe_user_id` in the token response.
     * A grant we cannot name is refused rather than stored half-identified — it
     * would authenticate and then be unable to say whose books it was reading.
     */
    const externalAccount = name === 'quickbooks'
      ? (c.req.query('realmId') ?? '')
      : name === 'stripe-revenue'
        ? String((tokens as unknown as { stripe_user_id?: string }).stripe_user_id ?? '')
        : await firstXeroTenantId(tokens.access_token);
    if (!externalAccount) {
      return c.redirect(`${base}${state.returnTo}?ledger=no_account`);
    }

    try {
      await saveLedgerConnection(db, env, {
        tenantId: state.tenantId,
        provider: name,
        externalAccount,
        displayName: provider.label,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresInSeconds: tokens.expires_in,
        scope: tokens.scope ?? provider.oauth.scopes.join(' '),
      });
      return c.redirect(`${base}${state.returnTo}?ledger=connected`);
    } catch (error) {
      reportCaughtError(error, { source: 'presentation/routes/ledgerRoutes.ts', operation: 'callback' });
      return c.redirect(`${base}${state.returnTo}?ledger=error`);
    }
  });

  /**
   * POST /connections — a `fields` provider (NetSuite).
   *
   * The typed key pair goes into the SAME sealed vault blob as an OAuth grant. A
   * second storage path for "the credential somebody typed" is how a fix to sealing
   * comes to land on half a port.
   */
  r.post('/connections', async (c) => {
    const env = c.env as Env;
    const body = await c.req.json().catch(() => ({})) as { provider?: string; fields?: Record<string, unknown> };
    const name = body.provider;
    if (!isAccountingProviderName(name)) return c.json({ error: 'Unknown accounting provider.' }, 400);
    const provider = accountingProvider(name);
    if (provider.connect !== 'fields' || !provider.fields) {
      return c.json({ error: `${provider.label} is connected through a consent screen, not typed fields.` }, 400);
    }

    const fields: Record<string, string> = {};
    for (const spec of provider.fields) {
      const value = body.fields?.[spec.key];
      const asText = typeof value === 'string' ? value.trim() : '';
      if (!asText && spec.required) return c.json({ error: `${spec.label} is required.` }, 400);
      if (asText) fields[spec.key] = asText;
    }

    const connection = await saveLedgerConnection(db, env, {
      tenantId: c.get('tenantId') as number,
      provider: name,
      // The account id is the natural key of the row AND the host every request
      // goes to, so it is what identifies the book here as well.
      externalAccount: fields.accountId ?? name,
      displayName: provider.label,
      fields,
    });
    return c.json({ connection });
  });

  r.delete('/connections/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid connection id.' }, 400);
    await deleteLedgerConnection(db, c.get('tenantId') as number, id);
    return c.json({ ok: true });
  });

  /**
   * POST /sync — pull now.
   *
   * The sweep runs daily, which is right for a cost budget and wrong for the minute
   * after somebody connects their books: waiting until tomorrow to find out whether
   * a connection works is how an integration gets reported as broken. The work is
   * identical to the sweep's — one function, two callers.
   */
  r.post('/sync', async (c) => {
    const tenantId = c.get('tenantId') as number;
    try {
      const results = await syncTenantLedgers(db, c.env as Env, tenantId);
      return c.json({
        synced: results.length,
        written: results.reduce((total, result) => total + result.transactionsWritten, 0),
        removed: results.reduce((total, result) => total + result.transactionsRemoved, 0),
        failures: results.filter((result) => result.error).map((result) => ({
          connectionId: result.connectionId, provider: result.provider, error: result.error,
        })),
        summary: await readLedgerSummary(db, c.env as Env, tenantId),
      });
    } catch (error) {
      reportCaughtError(error, { source: 'presentation/routes/ledgerRoutes.ts', operation: 'sync' });
      const status = error instanceof AccountingProviderError && error.retryable ? 503 : 502;
      return c.json({ error: 'Those books could not be synced right now.' }, status);
    }
  });

  /** GET /summary — what the burn, runway and cash figures actually stand on. */
  r.get('/summary', async (c) => c.json(
    await readLedgerSummary(db, c.env as Env, c.get('tenantId') as number),
  ));

  return r;
}

/**
 * Xero's tenant id, which the token response does not carry.
 *
 * One grant can reach several organisations, so Xero exposes them at
 * `/connections` and every subsequent request must name one in `Xero-Tenant-Id`.
 * The FIRST is taken, and that is a deliberate simplification with a stated cost: a
 * practice with several organisations connects the one Xero lists first and would
 * need a picker to choose another. Guessing silently is better than failing the
 * whole connect, and worse than asking — so it is worth asking later.
 */
async function firstXeroTenantId(accessToken: string): Promise<string> {
  const res = await fetch('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) return '';
  const body = await res.json().catch(() => []) as Array<{ tenantId?: string }>;
  return Array.isArray(body) ? String(body[0]?.tenantId ?? '') : '';
}

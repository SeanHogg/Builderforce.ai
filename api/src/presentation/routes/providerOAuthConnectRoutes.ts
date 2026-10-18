/**
 * The browser half of "connect a third-party account" — ONE pair of routes.
 *
 * Mailbox, drive, calendar, payouts, ledger and YouTube each mounted their own
 * `GET /connect/:provider` (build the consent URL, 503 when unconfigured) and
 * `GET /callback/:provider` (declined → missing params → verify + exchange →
 * redirect back with `?<noun>=<outcome>`). The six copies were line-for-line
 * the same apart from the provider registry, the query-param noun, and what the
 * domain does with the grant — and they had started to drift (one forgot the
 * declined case, one stopped reporting refused exchanges). This mounts both
 * routes from a spec; each domain keeps only its {@link ProviderOAuthConnectSpec.onConnected}
 * hook, which is the part that genuinely differs (which table, which account id).
 *
 * The callback is PUBLIC (a top-level redirect from the provider carries no
 * bearer token); each router keeps exempting `/callback` from its auth
 * middleware, and the signed state from `providerOAuthConnect` is what
 * authenticates it. Callback PATHS are registered with the providers, so the
 * spec states the full public path explicitly and this module never derives it.
 */

import type { Context, Hono } from 'hono';
import { resolveAppBaseUrl, type Env, type HonoEnv } from '../../env';
import {
  buildProviderConsentUrl,
  completeProviderOAuthCallback,
  type OAuthProviderConfig,
  type ProviderConnectState,
  type TokenResponse,
} from '../../application/shared/providerOAuthConnect';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';

/** A provider the spec resolved from the path, plus its OAuth descriptor. */
export interface ResolvedConnectProvider<P> {
  provider: P;
  oauth: OAuthProviderConfig;
  /** Human name for the "not configured on this deployment" message. */
  label: string;
}

export interface ConnectedGrant<P> {
  name: string;
  provider: P;
  oauth: OAuthProviderConfig;
  state: ProviderConnectState & { ts: number };
  tokens: TokenResponse;
}

export interface ProviderOAuthConnectSpec<P> {
  /**
   * The full PUBLIC callback path for a provider, e.g. `/api/drive/callback/google`.
   * Registered with every provider — changing it breaks every live connect.
   */
  callbackPath: (providerName: string) => string;
  /** Set for a single-provider router (YouTube): routes are `/connect` and `/callback`. */
  fixedProvider?: string;
  /** The query-param noun the app reads the outcome from (`?drive=connected`). */
  outcomeParam: string;
  defaultReturnTo: string;
  /** `caughtErrorReporter` source for this domain. */
  source: string;
  /** Resolve the CONNECT route's provider; `{ error }` answers 400 with that message. */
  resolveConnect: (name: string) => ResolvedConnectProvider<P> | { error: string };
  /** Resolve the CALLBACK route's provider; defaults to {@link resolveConnect}. */
  resolveCallback?: (name: string) => ResolvedConnectProvider<P> | null;
  /**
   * Runs before the code/state checks. Plaid is the one user: Link redirects with
   * a `public_token` instead of a `code`. Return a Response to take over.
   */
  interceptCallback?: (
    c: Context<HonoEnv>,
    ctx: { name: string; resolved: ResolvedConnectProvider<P>; rawState: string | undefined; back: (returnTo: string, outcome: string) => Response },
  ) => Promise<Response | null>;
  /**
   * The domain's post-connect side effect — identify the account and store the
   * grant. Returns the outcome to redirect with (`'connected'`, `'no_account'`).
   * A throw is reported and answered with `'error'`.
   */
  onConnected: (c: Context<HonoEnv>, grant: ConnectedGrant<P>) => Promise<string>;
}

export function mountProviderOAuthConnect<P>(router: Hono<HonoEnv>, spec: ProviderOAuthConnectSpec<P>): void {
  const nameOf = (c: Context<HonoEnv>): string => spec.fixedProvider ?? c.req.param('provider') ?? '';
  const redirectUri = (c: Context<HonoEnv>, name: string): string => `${new URL(c.req.url).origin}${spec.callbackPath(name)}`;
  const resolveCallback = spec.resolveCallback ?? ((name: string) => {
    const resolved = spec.resolveConnect(name);
    return 'error' in resolved ? null : resolved;
  });
  const suffix = spec.fixedProvider ? '' : '/:provider';

  /**
   * Returned as JSON for the client to navigate to, rather than a 302: a
   * top-level navigation cannot carry the bearer token, so the browser must make
   * the jump itself after an authenticated fetch.
   */
  router.get(`/connect${suffix}`, async (c) => {
    const name = nameOf(c);
    const resolved = spec.resolveConnect(name);
    if ('error' in resolved) return c.json({ error: resolved.error }, 400);

    const authUrl = await buildProviderConsentUrl(c.env as Env, resolved.oauth, {
      providerName: name,
      redirectUri: redirectUri(c, name),
      userId: c.get('userId') as string,
      tenantId: c.get('tenantId') as number,
      returnTo: c.req.query('returnTo'),
      returnToFallback: spec.defaultReturnTo,
    });
    if (!authUrl) return c.json({ error: `${resolved.label} is not configured on this deployment.` }, 503);
    return c.json({ authUrl });
  });

  router.get(`/callback${suffix}`, async (c) => {
    const env = c.env as Env;
    const name = nameOf(c);
    const base = resolveAppBaseUrl(env);
    // A `returnTo` may already carry a query (`/settings?tab=mail`); append to it
    // rather than producing a second `?`.
    const back = (returnTo: string, outcome: string) =>
      c.redirect(`${base}${returnTo}${returnTo.includes('?') ? '&' : '?'}${spec.outcomeParam}=${outcome}`);

    // Declining consent is a normal outcome, not an error — say so.
    if (c.req.query('error')) return back(spec.defaultReturnTo, 'declined');
    const resolved = resolveCallback(name);
    if (!resolved) return back(spec.defaultReturnTo, 'error');

    const rawState = c.req.query('state');
    if (spec.interceptCallback) {
      const taken = await spec.interceptCallback(c, { name, resolved, rawState, back });
      if (taken) return taken;
    }
    const code = c.req.query('code');
    if (!code || !rawState) return back(spec.defaultReturnTo, 'error');

    const result = await completeProviderOAuthCallback(env, resolved.oauth, {
      providerName: name, code, rawState, redirectUri: redirectUri(c, name), returnToFallback: spec.defaultReturnTo,
    });
    if (!result.ok) {
      if (result.reason === 'exchange_failed') reportCaughtError(result.error, { source: spec.source, operation: 'callback' });
      return back(result.returnTo ?? spec.defaultReturnTo, result.reason === 'exchange_failed' ? 'error' : result.reason);
    }

    try {
      const outcome = await spec.onConnected(c, {
        name, provider: resolved.provider, oauth: resolved.oauth, state: result.state, tokens: result.tokens,
      });
      return back(result.state.returnTo, outcome);
    } catch (error) {
      reportCaughtError(error, { source: spec.source, operation: 'callback' });
      return back(result.state.returnTo, 'error');
    }
  });
}

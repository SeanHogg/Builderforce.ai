import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
/**
 * "Connect your own subscription" — the ONE PKCE connect flow, for every
 * provider that offers one.
 *
 * Anthropic (Claude Pro/Max), OpenAI (ChatGPT/Codex) and xAI (SuperGrok) each
 * publish a PUBLIC OAuth client whose redirect we do not control, so all three
 * run the identical two-step dance: `start` mints PKCE + `state` and hands back
 * an authorize URL, the user consents on the provider's page and copies what it
 * shows them, `complete` recovers the verifier by `state` and exchanges the
 * code. Three copies of that dance had accumulated in `llmRoutes.ts`, and every
 * copy had drifted somewhere the operator could feel it — a different tolerance
 * for what may be pasted, a different verdict on a dead authorization code,
 * different HTTP statuses for the same upstream failure.
 *
 * What differs between providers is DATA, not control flow: the authorize URL,
 * the exchange call, and the sentence describing what to paste. Those live in
 * {@link SUBSCRIPTION_OAUTH_PROVIDERS}; adding a fourth provider is a row there,
 * never another pair of handlers.
 *
 * POLICY: a subscription token is a personal credential. Each tenant connects
 * THEIR OWN account — it is never resold or shared across workspaces, which is
 * why the pending PKCE record is scoped by tenant as well as by `state`.
 */
import type { Context, Hono } from 'hono';
import type { HonoEnv } from '../../env';
import {
  parsePastedAuthorizationCode,
  OAUTH_CODE_SPENT,
} from '../../application/llm/subscriptionOAuthCode';
import {
  generatePkce,
  generateState,
  buildAuthorizeUrl,
  exchangeAnthropicCode,
} from '../../application/llm/anthropicOAuth';
import {
  buildOpenAICodexAuthorizeUrl,
  exchangeOpenAICodexCode,
} from '../../application/llm/openaiCodexOAuth';
import { buildXaiAuthorizeUrl, exchangeXaiCode } from '../../application/llm/xaiOAuth';
import { pollKimiDeviceToken, startKimiDeviceAuthorization } from '../../application/llm/kimiOAuth';
import {
  setTenantProviderOAuth,
  type LlmProvider,
  type SubscriptionOAuthTokens,
} from '../../application/llm/tenantProviderKeyService';
import { clearProviderAuthAlert } from '../../application/llm/providerAuthAlerts';

/**
 * The caller's authentication, as the NARROWEST shape this flow needs: who is
 * connecting, and how to answer when they may not.
 *
 * Taken as a parameter rather than imported from `llmRoutes` on purpose — that
 * module imports this one to mount the routes, and depending back on it would
 * both close an import cycle and couple a self-contained flow to a 3,000-line
 * router. Only the two fields used here are named, so the real `TenantAccess`
 * satisfies it structurally with no changes.
 */
export interface SubscriptionOAuthGate {
  requireTenantAccess(c: Context<HonoEnv>): Promise<{ tenantId: number; userId: string | null }>;
  respondToAccessError(c: Context<HonoEnv>, err: unknown): Response;
}

/** The PKCE material held server-side between `start` and `complete`. */
interface PendingConnect {
  verifier: string;
  challenge: string;
}

/**
 * How a provider's grant is completed. A discriminated union rather than optional fields
 * so each style carries exactly its own inputs and neither can be half-configured.
 *
 * `paste` is the authorization-code dance the first three providers use: the user consents
 * and copies something back. `device` is RFC 8628, which Kimi's public client uses: there
 * is nothing to copy because the code travels in the URL, and `complete` POLLS for the
 * approval instead of redeeming a paste. The two share everything else — the tenant-scoped
 * pending record, its TTL, the CSRF role of `state`, and the storage call — which is why
 * they belong in one flow with two strategies rather than in two routers.
 */
type SubscriptionGrant =
  | {
      kind: 'paste';
      /** Where the user consents. May throw (xAI resolves its endpoint by OIDC discovery). */
      buildAuthorizeUrl(params: PendingConnect & { state: string }): string | Promise<string>;
      /** Redeem the code the user pasted. */
      exchange(params: PendingConnect & { code: string; state: string }): Promise<SubscriptionOAuthTokens>;
      /** What to say when the paste carried no code, or no `state` to look up. */
      missingPaste: string;
    }
  | {
      kind: 'device';
      /** Ask the provider for a device code and the page to send the user to. */
      begin(): Promise<{
        deviceCode: string;
        userCode: string;
        verificationUriComplete: string;
        interval: number;
      }>;
      /** One poll. `pending` keeps the client waiting; the rest are terminal. */
      poll(deviceCode: string): Promise<
        | { kind: 'tokens'; tokens: SubscriptionOAuthTokens }
        | { kind: 'pending' }
        | { kind: 'slow_down' }
        | { kind: 'expired' }
        | { kind: 'denied' }
      >;
    };

/** One provider's differences from the shared dance — data, not behaviour. */
interface SubscriptionOAuthAdapter {
  provider: LlmProvider;
  /**
   * KV key prefix for this provider's pending records. These strings are a
   * WIRE FORMAT, not a label: a connect started before a deploy must still
   * complete after it, so they never change once shipped.
   */
  kvPrefix: string;
  /** Where the user consents. May throw (xAI resolves its endpoint by OIDC discovery). */
  grant: SubscriptionGrant;
}

const SUBSCRIPTION_OAUTH_PROVIDERS: readonly SubscriptionOAuthAdapter[] = [
  {
    provider: 'anthropic',
    kvPrefix: 'anthropic_oauth',
    grant: {
      kind: 'paste',
      buildAuthorizeUrl,
      exchange: ({ code, state, verifier }) => exchangeAnthropicCode({ code, state, verifier }),
      missingPaste: 'Paste the full value Claude showed you (the `code#state` pair, or the whole callback URL) so the code and state can both be verified.',
    },
  },
  {
    provider: 'openai',
    kvPrefix: 'openai_codex_oauth',
    grant: {
      kind: 'paste',
      buildAuthorizeUrl: buildOpenAICodexAuthorizeUrl,
      exchange: ({ code, verifier }) => exchangeOpenAICodexCode({ code, verifier }),
      missingPaste: 'Paste the full OpenAI redirect URL so the code and state can both be verified.',
    },
  },
  {
    provider: 'xai',
    kvPrefix: 'xai_oauth',
    grant: {
      kind: 'paste',
      buildAuthorizeUrl: buildXaiAuthorizeUrl,
      exchange: ({ code, verifier, challenge }) => exchangeXaiCode({ code, verifier, challenge }),
      missingPaste: 'Paste the full xAI redirect URL so the code and state can both be verified.',
    },
  },
  {
    // Kimi Code. A subscription here issues no API key at all — Kimi's own config leaves
    // `api_key` empty beside an OAuth record — so the card that used to ask for an `sk-…`
    // was asking for a credential that does not exist.
    provider: 'kimi',
    kvPrefix: 'kimi_device_oauth',
    grant: {
      kind: 'device',
      begin: async () => {
        const authorization = await startKimiDeviceAuthorization();
        return {
          deviceCode: authorization.deviceCode,
          userCode: authorization.userCode,
          verificationUriComplete: authorization.verificationUriComplete,
          interval: authorization.interval,
        };
      },
      poll: (deviceCode) => pollKimiDeviceToken(deviceCode),
    },
  },
];

/**
 * 15 minutes to consent and paste. The PROVIDER's authorization code usually
 * dies well before this — that asymmetry is deliberate, so a late paste is
 * answered by the provider's own "code expired" (which
 * {@link OAUTH_CODE_SPENT} turns into an instruction) rather than by our
 * lookup silently missing and blaming CSRF.
 */
const OAUTH_PKCE_TTL_SECONDS = 900;

/** Pending-record key. Tenant-scoped so concurrent connects never collide. */
const pendingKey = (adapter: SubscriptionOAuthAdapter, tenantId: number, state: string): string =>
  `${adapter.kvPrefix}:${tenantId}:${state}`;

/**
 * Read a pending record. Historically two providers stored the bare verifier
 * and one stored JSON, so a plain string is still accepted: a connect started
 * before this consolidation shipped must be completable after it.
 */
function readPending(raw: string): PendingConnect {
  // The legacy value was the bare verifier — base64url, which can never begin
  // with `{`. That makes the format decidable without attempting a parse that
  // is EXPECTED to fail, so a genuinely malformed record still surfaces as an
  // error instead of being swallowed into a wrong verifier.
  if (!raw.startsWith('{')) return { verifier: raw, challenge: '' };
  const parsed = JSON.parse(raw) as Partial<PendingConnect>;
  return {
    verifier: typeof parsed.verifier === 'string' ? parsed.verifier : raw,
    challenge: typeof parsed.challenge === 'string' ? parsed.challenge : '',
  };
}

/**
 * Turn an exchange failure into the response the operator can act on.
 *
 * The distinction that matters: a dead authorization code is a 400 they fix by
 * consenting again, an unentitled account is a 403 they fix on the provider's
 * billing page, and only everything else is the 502 that says "not your fault".
 * Reporting all three as 502 with the upstream JSON body — which is what two of
 * the three copies did — leaves the operator retrying a code that can never work.
 */
function exchangeFailureResponse(error: unknown, provider: LlmProvider) {
  const failure = error as { status?: number; code?: string } | null;
  const message = error instanceof Error ? error.message : `${provider} OAuth exchange failed`;
  if (failure?.code === OAUTH_CODE_SPENT) return { body: { error: message, code: OAUTH_CODE_SPENT }, status: 400 as const };
  if (failure?.status === 403) return { body: { error: message, code: 'oauth_subscription_not_entitled' }, status: 403 as const };
  return { body: { error: message, code: 'oauth_exchange_failed' }, status: 502 as const };
}

/**
 * Mount `POST /provider-keys/:provider/oauth/{start,complete}` for every
 * provider in the registry, onto the router that already owns
 * `/provider-keys/*`.
 */
export function mountSubscriptionOAuthRoutes(router: Hono<HonoEnv>, gate: SubscriptionOAuthGate): void {
  for (const adapter of SUBSCRIPTION_OAUTH_PROVIDERS) {
    // Begin: mint PKCE + state, stash the verifier server-side, hand the browser
    // the authorize URL. The verifier never leaves the server — only the S256
    // challenge travels in the URL.
    router.post(`/provider-keys/${adapter.provider}/oauth/start`, async (c) => {
      let access: { tenantId: number; userId: string | null };
      try { access = await gate.requireTenantAccess(c); } catch (err) { return gate.respondToAccessError(c, err); }
      const kv = (c.env as { AUTH_CACHE_KV?: KVNamespace }).AUTH_CACHE_KV;
      if (!kv) return c.json({ error: 'OAuth connect unavailable (AUTH_CACHE_KV unbound)', code: 'oauth_unconfigured' }, 503);

      const state = generateState();

      if (adapter.grant.kind === 'device') {
        // No PKCE: a device grant carries its secret in the device code, which never
        // reaches the browser — only the short user code and the page URL do.
        let authorization: Awaited<ReturnType<typeof adapter.grant.begin>>;
        try {
          authorization = await adapter.grant.begin();
        } catch (e) {
          return c.json({ error: e instanceof Error ? e.message : 'Device authorization failed', code: 'oauth_discovery_failed' }, 502);
        }
        await kv.put(
          pendingKey(adapter, access.tenantId, state),
          JSON.stringify({ deviceCode: authorization.deviceCode }),
          { expirationTtl: OAUTH_PKCE_TTL_SECONDS },
        );
        return c.json({
          authorizeUrl: authorization.verificationUriComplete,
          state,
          // The client polls `complete` rather than collecting a paste. `userCode` is
          // shown so the operator can confirm the page they land on is the right one.
          grant: 'device',
          userCode: authorization.userCode,
          pollIntervalSeconds: authorization.interval,
        });
      }

      const { verifier, challenge } = await generatePkce();
      let authorizeUrl: string;
      try {
        // Built BEFORE the record is written: a discovery failure should leave
        // no pending state behind for a connect that never started.
        authorizeUrl = await adapter.grant.buildAuthorizeUrl({ state, verifier, challenge });
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : 'OAuth discovery failed', code: 'oauth_discovery_failed' }, 502);
      }
      await kv.put(pendingKey(adapter, access.tenantId, state), JSON.stringify({ verifier, challenge }), { expirationTtl: OAUTH_PKCE_TTL_SECONDS });
      return c.json({ authorizeUrl, state, grant: 'paste' });
    });

    // Finish: recover the verifier by `state` (which is also the CSRF check),
    // exchange the code, store the tokens encrypted.
    router.post(`/provider-keys/${adapter.provider}/oauth/complete`, async (c) => {
      let access: { tenantId: number; userId: string | null };
      try { access = await gate.requireTenantAccess(c); } catch (err) { return gate.respondToAccessError(c, err); }
      const kv = (c.env as { AUTH_CACHE_KV?: KVNamespace }).AUTH_CACHE_KV;
      if (!kv) return c.json({ error: 'OAuth connect unavailable (AUTH_CACHE_KV unbound)', code: 'oauth_unconfigured' }, 503);

      const body = await c.req.json<{ code?: string; state?: string }>().catch(() => ({} as { code?: string; state?: string }));
      const parsed = parsePastedAuthorizationCode(body.code ?? '');
      // `state` may ride inside the paste or be sent explicitly by a client that
      // still holds the one `start` returned. A device grant always sends it explicitly —
      // there is no paste for it to hide in.
      const state = (parsed.state ?? body.state ?? '').trim();
      const needsPaste = adapter.grant.kind === 'paste';
      if (!state || (needsPaste && !parsed.code)) {
        return c.json({
          error: adapter.grant.kind === 'paste'
            ? adapter.grant.missingPaste
            : 'Connect session missing — start again.',
          code: 'oauth_missing_code_or_state',
        }, 400);
      }

      const key = pendingKey(adapter, access.tenantId, state);
      const raw = await kv.get(key);
      if (!raw) return c.json({ error: 'Connect session expired or invalid — start again.', code: 'oauth_state_expired' }, 400);

      let tokens: SubscriptionOAuthTokens;
      if (adapter.grant.kind === 'device') {
        const deviceCode = (JSON.parse(raw) as { deviceCode?: string }).deviceCode ?? '';
        if (!deviceCode) return c.json({ error: 'Connect session expired or invalid — start again.', code: 'oauth_state_expired' }, 400);
        let outcome: Awaited<ReturnType<typeof adapter.grant.poll>>;
        try {
          outcome = await adapter.grant.poll(deviceCode);
        } catch (e) {
          const { body: failure, status } = exchangeFailureResponse(e, adapter.provider);
          return c.json(failure, status);
        }
        // Still waiting is a SUCCESSFUL poll, not an error — the client is meant to call
        // again. Reporting it as a failure would make a normal wait look like a breakage.
        if (outcome.kind === 'pending' || outcome.kind === 'slow_down') {
          return c.json({ ok: false, status: outcome.kind, provider: adapter.provider });
        }
        if (outcome.kind !== 'tokens') {
          // Terminal, and the pending record is spent — drop it so a retry starts clean.
          await kv.delete(key).catch(() => {});
          return c.json({
            error: outcome.kind === 'denied'
              ? 'The connection request was declined in Kimi.'
              : 'The connection request expired before it was approved — start again.',
            code: outcome.kind === 'denied' ? 'oauth_denied' : 'oauth_state_expired',
          }, 400);
        }
        tokens = outcome.tokens;
      } else {
        try {
          tokens = await adapter.grant.exchange({ code: parsed.code, state, ...readPending(raw) });
        } catch (e) {
          const { body: failure, status } = exchangeFailureResponse(e, adapter.provider);
          return c.json(failure, status);
        }
      }
      await setTenantProviderOAuth(c.env, access.tenantId, adapter.provider, tokens, access.userId);
      // A fresh consent may well have landed on a working account — retire the
      // "reconnect this account" prompt the previous rejection raised, or the
      // card keeps telling the operator to fix what they just fixed.
      await clearProviderAuthAlert(c.env, access.tenantId, adapter.provider);
      // Single-use verifier — drop it once it has done its job.
      await kv.delete(key).catch((error) => {
        reportCaughtError(error, { source: 'presentation/routes/subscriptionOAuthRoutes.ts', operation: 'completeSubscriptionOAuth' });
      });
      return c.json({ ok: true, provider: adapter.provider, authType: 'oauth' });
    });
  }
}

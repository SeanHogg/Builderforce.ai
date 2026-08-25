/**
 * THE VENDOR'S API — `/api/v1/extensions/*` (PRD 24 §5.3, §5.4).
 *
 * The surface a publisher's integration server calls, and the only one on this
 * platform where the caller is neither a person with a session nor a customer.
 *
 * ── TWO CREDENTIALS, TWO HALVES ─────────────────────────────────────────────
 *
 *   PUBLISHER KEY (`bfk_…` with `read:installs`) — "I am Acme Payroll."
 *     Answers questions about the publisher's OWN installs and mints tokens.
 *     Reaches no customer data.
 *
 *   INSTALL TOKEN (five minutes, from the exchange below) — "I am Acme Payroll,
 *     acting for the workspace that installed me." Bounded by exactly the scopes
 *     that install's admin approved. Everything that touches a customer needs one.
 *
 * The split is the whole security story, and it is why the exchange exists at all
 * rather than letting the publisher key do everything: a long-lived key that could
 * act for every customer is a key whose compromise is every customer's problem.
 *
 * ── WHY THIS IS MOUNTED ON `/api/v1` ────────────────────────────────────────
 * Because that is where credentialed machine callers already are, with one origin
 * allowlist, one rate limiter and one key resolver. A vendor API on its own mount
 * would be a second answer to "is this caller allowed in" — the duplication
 * `publicApiAuth.ts` was extracted to end.
 *
 * ── AND WHY IT IS NOT IN `presentation/routes` ──────────────────────────────
 * It is a sibling of the canvas, webhook and widget routers, which live here for
 * the reason `publicApiRoutes.ts` gives: one mount, one credential, one file per
 * surface. Every handler calls an application service; this file holds no SQL.
 */

import { Hono } from 'hono';

import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { touchTenantApiKey } from '../llm/tenantApiKeyService';
import { requirePublicApiKey } from './publicApiAuth';
import {
  InstallTokenError,
  mintInstallToken,
  resolveInstallToken,
  listPublisherInstalls,
  type ResolvedInstall,
} from '../developer/extensionInstallTokens';
import { recordUsage } from '../developer/extensionUsage';
import { openPeriodFor } from '../developer/extensionBilling';
import { EXTENSION_WEBHOOK_EVENTS } from '../seams/webhookService';

/** Map this surface's one error type onto a status, in one place. */
function fail(error: unknown): { body: { error: string }; status: 400 | 401 | 403 | 404 | 500 } {
  if (error instanceof InstallTokenError) return { body: { error: error.message }, status: error.status };
  return { body: { error: error instanceof Error ? error.message : 'unexpected error' }, status: 500 };
}

export function createPublicExtensionRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * The contract, so a vendor never hardcodes our vocabulary.
   *
   * Unauthenticated on purpose — it is documentation with a JSON content type,
   * and a developer reading it has not minted a key yet. It leaks nothing: every
   * value in it is in the published docs.
   */
  router.get('/extensions/contract', (c) =>
    c.json({
      tokenExchange: 'POST /api/v1/extensions/token',
      tokenType: 'Bearer',
      webhookEvents: EXTENSION_WEBHOOK_EVENTS,
      usage: 'POST /api/v1/extensions/usage',
    }),
  );

  /**
   * POST /extensions/token — the exchange.
   *
   * Client-credentials shaped: the publisher's key proves who the vendor is, and
   * the install id names which of their customers they want to act for. There is
   * no second consent screen because **the install IS the grant** — an admin
   * already read the scope list and pressed Install, and asking them to approve
   * the same scopes again on the vendor's site is the second signup §2.4 says
   * kills marketplace conversion.
   *
   * `read:installs` and not `write:packages`: minting a token is an act about the
   * publisher's INSTALLS, and a CI key that ships versions should not be able to
   * act for customers.
   */
  router.post('/extensions/token', async (c) => {
    const auth = await requirePublicApiKey(db, c.req.header('Authorization'), c.req.header('Origin') ?? null, 'read:installs');
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    c.executionCtx.waitUntil(touchTenantApiKey(db, auth.keyId));

    type Body = { installId?: string; scopes?: string[] };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    if (!body.installId) return c.json({ error: 'installId is required' }, 400);

    try {
      const minted = await mintInstallToken(db, c.env as Env, {
        // From the RESOLVED key, never from the body. That is the whole client
        // half of client-credentials: taking it from the request would let anyone
        // who knows an install id mint a token for it.
        publisherTenantId: auth.tenantId,
        installId: body.installId,
        requestScopes: body.scopes ?? null,
      });
      return c.json({
        // OAuth 2.0's field names, because a vendor's HTTP client already knows
        // them. The GRANT is ours; there is no reason the wire format should be.
        access_token: minted.accessToken,
        token_type: 'Bearer',
        expires_in: minted.expiresIn,
        scope: minted.scopes.join(' '),
        install: {
          id: minted.install.installId,
          package: minted.install.packageSlug,
          version: minted.install.semver,
          plan: minted.install.planCode,
        },
      });
    } catch (error) {
      const { body: b, status } = fail(error);
      return c.json(b, status);
    }
  });

  /**
   * GET /extensions/installs — every workspace running this publisher's packages.
   *
   * AGGREGATE-SAFE BY CONSTRUCTION: it returns install ids, packages, versions,
   * plans and dates — never the customer's workspace name, members or id. A vendor
   * needs to know that an install exists and how to talk to it; who the customer is
   * is the customer's to tell them. The projection is `listPublisherInstalls`'s, and
   * `installAnalytics` is where the same boundary is argued in full.
   */
  router.get('/extensions/installs', async (c) => {
    const auth = await requirePublicApiKey(db, c.req.header('Authorization'), c.req.header('Origin') ?? null, 'read:installs');
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    c.executionCtx.waitUntil(touchTenantApiKey(db, auth.keyId));

    const q = c.req.query();
    return c.json({
      installs: await listPublisherInstalls(db, auth.tenantId, {
        packageSlug: q.package ?? null,
        limit: q.limit ? Number(q.limit) : undefined,
      }),
    });
  });

  // ── Everything below needs an INSTALL TOKEN ───────────────────────────────

  /**
   * Resolve the bearer token to the install it names, or answer.
   *
   * The re-read inside `resolveInstallToken` is what makes an uninstall
   * immediate: the signature proves the token was ours, and the install row
   * decides what it may still do.
   */
  async function withInstall(
    c: { req: { header: (k: string) => string | undefined }; env: unknown },
  ): Promise<{ ok: true; install: ResolvedInstall } | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 500 }> {
    try {
      return { ok: true, install: await resolveInstallToken(db, c.env as Env, c.req.header('Authorization')) };
    } catch (error) {
      const { body, status } = fail(error);
      return { ok: false, error: body.error, status };
    }
  }

  /**
   * GET /extensions/me — who am I acting for, and what may I do?
   *
   * The call a vendor makes first, and the one that makes a scope failure
   * debuggable: without it, an integration that was granted less than it expected
   * discovers the fact as an unexplained 403 on a business call.
   */
  router.get('/extensions/me', async (c) => {
    const resolved = await withInstall(c);
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const { install } = resolved;
    return c.json({
      install: {
        id: install.installId,
        package: install.packageSlug,
        version: install.semver,
        scopes: install.grantedScopes,
        plan: install.planCode,
        subscription: install.subscriptionState,
      },
    });
  });

  /**
   * POST /extensions/usage — report metered units (PRD 24 §5.4 step 4).
   *
   * `usageId` is the vendor's own id for the occurrence and is THE idempotency
   * key: a retry after a slow response returns `recorded: false` and a 200,
   * because the platform's honest answer to "did you get that?" is "yes, exactly
   * once" — not an error that makes the vendor either lose revenue or report it
   * again under a new id.
   *
   * No scope is required beyond holding the token. Reporting usage is not an act
   * ON the customer's data — it is the vendor telling us what to bill for their
   * own product — and gating it behind a scope an admin could decline would let a
   * customer switch off the meter while keeping the extension.
   */
  router.post('/extensions/usage', async (c) => {
    const resolved = await withInstall(c);
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const { install } = resolved;

    type Body = { usageId?: string; units?: number; note?: string; occurredAt?: string };
    const body = await c.req.json<Body>().catch((): Body => ({}));

    try {
      // The window's floor is the install's own watermark, which `resolveInstallToken`
      // already read off the row — a backdated report must not be able to land in a
      // period that has already been invoiced, and re-deriving it here would cost a
      // vendor reporting per API call three extra queries per report.
      const occurredAt = body.occurredAt ? new Date(body.occurredAt) : null;
      const result = await recordUsage(db, {
        tenantId: install.tenantId,
        installId: install.installId,
        packageSlug: install.packageSlug,
        meteredSince: install.meteredSince,
        report: {
          usageId: body.usageId ?? '',
          units: Number(body.units),
          note: body.note ?? null,
          occurredAt: occurredAt && Number.isFinite(occurredAt.getTime()) ? occurredAt : null,
        },
      });
      return c.json({
        recorded: result.recorded,
        units: result.units,
        // What the period costs so far, so a vendor can show their own customer
        // the same number we will bill — computed by the SAME pricing function the
        // close uses, so the two cannot disagree.
        period: await openPeriodFor(db, install.tenantId, install.installId),
      });
    } catch (error) {
      const { body: b, status } = fail(error);
      return c.json(b, status);
    }
  });

  return router;
}

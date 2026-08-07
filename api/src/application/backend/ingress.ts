/**
 * ONE inbound-request executor for project backends, addressed two ways.
 *
 * A handler spec used to be reachable at exactly one URL: `/hooks/<token>/<route>`,
 * an opaque address suitable for pasting into a provider console and useless for
 * anything else. A person who had just published a site could not call their own
 * backend from their own page without hard-coding a token into client-side
 * JavaScript, so a published site could store a form submission and do nothing
 * else — the "a site cannot run server code" residual.
 *
 * This module is that dispatch, lifted out of the route so both addresses run it:
 *
 *   provider console →  api.builderforce.ai/hooks/<token>/<route>
 *   the site itself  →  <site-host>/api/<route>          (same handlers, same rules)
 *
 * Everything that makes the public path safe — the rate limit, the body cap, the
 * declared signature verification, the header allow-list, the step budget, the
 * request log — lives HERE rather than in either caller, so a second address
 * cannot be a second, weaker security posture. That was the whole risk in giving
 * handlers a friendlier URL.
 *
 * ── WHY A FAILURE STILL RETURNS 200 ─────────────────────────────────────────
 * An unmatched route or a failed verification is 4xx: the caller's problem to
 * see. But once a handler is MATCHED and VERIFIED, a step failing inside it
 * returns the handler's normal reply anyway (see handlerRuntime's failure
 * posture). A 500 to Twilio mid-call drops the call and mid-message triggers a
 * retry storm; a degraded but well-formed reply does not.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { executeConnectorAction } from '../connectors/connectorRuntime';
import { completeForTenant } from '../llm/tenantProxy';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { checkSlidingWindow } from '../ratelimit/slidingWindow';
import { loadProjectSecretValues } from '../secrets/projectSecrets';
import { listSiteRecordsForHandler } from '../ide/siteData';
import { loadHandlersCached, projectDisplayName, recordBackendRequest, type RequestVerdict } from './index';
import { executeHandler, type HandlerRuntimeDeps } from './handlerRuntime';
import { matchHandler, type HandlerSpec } from './handlerSpec';
import {
  VERIFY_SECRET_NAME,
  VERIFY_SIGNATURE_HEADER,
  verifyShopifySignature,
  verifySharedSecret,
  verifyStripeSignature,
  verifyTwilioSignature,
} from './webhookVerification';

/** Headers a handler template may read. An allow-list, so an author cannot
 *  accidentally echo an Authorization header or a provider signature into a
 *  reply that goes back out over SMS. */
const READABLE_HEADERS = new Set([
  'content-type',
  'user-agent',
  'x-forwarded-for',
  'cf-connecting-ip',
  'cf-ipcountry',
  'accept-language',
]);

/** Inbound bodies are capped well below a webhook's realistic size — an oversized
 *  body on a public endpoint is an attack, not a message. */
const MAX_BODY_BYTES = 128 * 1024;

/**
 * Requests per minute accepted per ingress address.
 *
 * What this caps is a flood at a VALID address, where each request costs a
 * handler lookup and a verified one can spend a connector call or an LLM step.
 *
 * 300/min is deliberately well above real provider throughput — Twilio sends at
 * one message per second per number by default, so this covers a project with
 * several numbers plus a status callback for each — and well below a rate that
 * could drain an account's balance before anyone notices.
 */
export const INGRESS_RPM = 300;

/** Who the request is for, and how it addressed them. */
export interface IngressTarget {
  projectId: number;
  tenantId: number;
  /**
   * Absolute base a handler's `{{project.ingressUrl}}` renders to. Differs per
   * address on purpose: a callback URL built on the site's own origin must come
   * back to the site's own origin, or Twilio's `<Gather action>` would bounce a
   * live call onto a different host mid-call.
   */
  ingressUrl: string;
  /** Rate-limit bucket. Per address, so a site flood cannot 429 the webhooks. */
  rateLimitKey: string;
}

export type IngressResult =
  /** No handler claims this route — the caller decides what that means. */
  | { matched: false; detail: string }
  | { matched: true; response: Response };

interface ParsedBody {
  body: Record<string, unknown>;
  formParams: Array<[string, string]>;
  rawBody: string;
  isForm: boolean;
}

async function readBody(request: Request): Promise<ParsedBody | { tooLarge: true }> {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    return { body: {}, formParams: [], rawBody: '', isForm: false };
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return { tooLarge: true };

  const contentType = request.headers.get('content-type') ?? '';
  const isForm = contentType.includes('application/x-www-form-urlencoded');
  if (isForm) {
    const formParams = [...new URLSearchParams(raw).entries()];
    const body: Record<string, unknown> = {};
    // Last value wins for the scope object (a template wants ONE value), while
    // `formParams` keeps every occurrence because the signature is computed over
    // all of them.
    for (const [k, v] of formParams) body[k] = v;
    return { body, formParams, rawBody: raw, isForm: true };
  }
  if (!raw) return { body: {}, formParams: [], rawBody: '', isForm: false };
  try {
    const parsed = JSON.parse(raw);
    return {
      body: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { value: parsed },
      formParams: [],
      rawBody: raw,
      isForm: false,
    };
  } catch {
    return { body: { raw }, formParams: [], rawBody: raw, isForm: false };
  }
}

/** Verify the request per the handler's declared kind. */
async function verifyRequest(
  handler: HandlerSpec,
  request: Request,
  parsed: ParsedBody,
  secrets: Record<string, string>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const header = (name: string) => request.headers.get(name);
  // A handler may name its OWN secret — Stripe issues one per endpoint, so the
  // kind's single default name can only ever verify one of several endpoints.
  const secretFor = (kind: Exclude<typeof handler.verify, 'none'>) =>
    secrets[handler.verifySecret ?? VERIFY_SECRET_NAME[kind]] ?? '';

  switch (handler.verify) {
    case 'none':
      return { ok: true };
    case 'twilio':
      return verifyTwilioSignature({
        url: request.url,
        signature: header(VERIFY_SIGNATURE_HEADER.twilio),
        authToken: secretFor('twilio'),
        formParams: parsed.formParams,
        rawBody: parsed.rawBody,
        isForm: parsed.isForm,
      });
    case 'stripe':
      return verifyStripeSignature({
        signature: header(VERIFY_SIGNATURE_HEADER.stripe),
        secret: secretFor('stripe'),
        rawBody: parsed.rawBody,
      });
    case 'shopify':
      return verifyShopifySignature({
        signature: header(VERIFY_SIGNATURE_HEADER.shopify),
        secret: secretFor('shopify'),
        rawBody: parsed.rawBody,
      });
    case 'shared-secret':
      // GitHub's header name is accepted too: a customer wiring a GitHub webhook
      // has no way to rename it, and the payload format is identical.
      return verifySharedSecret({
        signature: header(VERIFY_SIGNATURE_HEADER['shared-secret']) ?? header('x-hub-signature-256'),
        secret: secretFor('shared-secret'),
        rawBody: parsed.rawBody,
      });
  }
}

/**
 * Runtime dependencies bound to one project.
 *
 * The connector step runs as `actorKind: 'agent'` against the TENANT's
 * connections — a project backend is acting on the tenant's behalf, and reusing
 * `executeConnectorAction` means the SSRF guard, credential decryption, redaction
 * and call log all apply to a webhook-driven call exactly as they do to an agent's.
 *
 * The `read` dependency is what makes the site's datastore two-way. `siteData`
 * deliberately exposes NO public read endpoint — a collection is write-only from
 * the internet, because a signup form that anyone can enumerate is a leak. A
 * handler is not the internet: it runs server-side, its output is shaped by a
 * spec the tenant wrote, and it is the intended way to build a page out of
 * collected data.
 */
export function ingressRuntimeDeps(env: Env, db: Db, tenantId: number, projectId: number): HandlerRuntimeDeps {
  return {
    async llm(args) {
      const result = await completeForTenant(
        env,
        tenantId,
        {
          messages: [
            ...(args.system ? [{ role: 'system' as const, content: args.system }] : []),
            { role: 'user' as const, content: args.prompt },
          ],
          temperature: args.temperature ?? 0.4,
          max_tokens: args.maxTokens ?? 400,
          useCase: 'project_backend_handler',
        },
        { meterUseCase: 'project_backend_handler' },
      );
      if (result.response.status >= 400) return '';
      const raw = (await result.response.json().catch(() => null)) as
        | { choices?: Array<{ message?: { content?: unknown } }> }
        | null;
      const content = raw?.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    },

    callConnector(args) {
      return executeConnectorAction({
        db,
        env,
        tenantId,
        connectorKey: args.connector,
        actionKey: args.actionKey,
        input: args.input,
        connectionId: args.connectionId ?? null,
        actorKind: 'agent',
      });
    },

    readCollection(args) {
      return listSiteRecordsForHandler({
        db,
        tenantId,
        projectId,
        collectionName: args.collection,
        limit: args.limit,
        match: args.match,
      });
    },
  };
}

/**
 * Run one inbound request against the project's canvas handlers.
 *
 * `route` is the path AFTER whichever prefix addressed us, already normalised by
 * the caller — the two addresses have different prefixes and only the caller
 * knows how long its own is.
 */
export async function dispatchIngressRequest(args: {
  env: Env & { UPLOADS?: R2Bucket };
  db: Db;
  target: IngressTarget;
  request: Request;
  route: string;
}): Promise<IngressResult> {
  const { env, db, target, request } = args;
  const started = Date.now();
  const route = (args.route.replace(/\/+$/, '') || '/').toLowerCase();
  const method = request.method.toUpperCase();

  if (!env.UPLOADS) {
    return { matched: true, response: new Response('Storage not configured', { status: 503 }) };
  }

  const finish = async (status: number, verdict: RequestVerdict, error?: string): Promise<void> => {
    await recordBackendRequest(db, {
      projectId: target.projectId,
      tenantId: target.tenantId,
      route,
      method,
      statusCode: status,
      verdict,
      durationMs: Date.now() - started,
      ...(error ? { error } : {}),
    });
  };

  // Cap the flood BEFORE the handler read and any step execution — the point of
  // the limit is that an over-rate request costs nothing. A 429 with `Retry-After`
  // is also the answer a provider handles best: Twilio backs off and re-delivers
  // rather than treating the message as permanently failed.
  const limited = await checkSlidingWindow(env, target.rateLimitKey, INGRESS_RPM).catch((error) => {
    reportCaughtError(error, { source: 'application/backend/ingress.ts', operation: 'ingressRateLimit' });
    return null;
  });
  if (limited && !limited.allowed) {
    await finish(429, 'rate-limited', `Over ${INGRESS_RPM} requests/minute for this ingress`);
    return {
      matched: true,
      response: new Response('Too many requests', {
        status: 429,
        headers: { 'Retry-After': String(limited.retryAfterSeconds) },
      }),
    };
  }

  const { specs, errors } = await loadHandlersCached(env, env.UPLOADS, target.projectId);
  const handler = matchHandler(specs, route, method);
  if (!handler) {
    // A broken spec for this exact route is the likeliest reason a handler is
    // "missing", so say so rather than reporting a bare 404 the author will
    // spend an afternoon on.
    const broken = errors.find((e) => e.path.includes(route.replace(/^\//, '')));
    const detail = broken
      ? `Handler ${broken.path} did not parse: ${broken.reason}`
      : `No handler for ${method} ${route}`;
    await finish(404, 'no-handler', detail);
    return { matched: false, detail };
  }

  const parsed = await readBody(request);
  if ('tooLarge' in parsed) {
    await finish(413, 'error', 'Request body too large');
    return { matched: true, response: new Response('Request body too large', { status: 413 }) };
  }

  // Secrets are loaded ONLY for verification and never enter the template scope
  // — see the scope note in handlerSpec.ts.
  const secrets =
    handler.verify === 'none' ? {} : await loadProjectSecretValues(db, env, target.tenantId, target.projectId);

  const verified = await verifyRequest(handler, request, parsed, secrets);
  if (!verified.ok) {
    await finish(403, 'unverified', verified.reason);
    return { matched: true, response: new Response(verified.reason, { status: 403 }) };
  }

  const url = new URL(request.url);
  try {
    const execution = await executeHandler(
      handler,
      {
        body: parsed.body,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: Object.fromEntries(
          [...request.headers.entries()].filter(([k]) => READABLE_HEADERS.has(k.toLowerCase())),
        ),
        project: {
          id: target.projectId,
          name: await projectDisplayName(db, target.tenantId, target.projectId),
          ingressUrl: target.ingressUrl,
        },
      },
      ingressRuntimeDeps(env, db, target.tenantId, target.projectId),
    );

    const failed = execution.steps.filter((s) => !s.ok && !s.skipped);
    await finish(
      execution.status,
      failed.length ? 'error' : 'ok',
      failed.length ? failed.map((s) => `${s.id}: ${s.error}`).join('; ') : undefined,
    );
    return {
      matched: true,
      response: new Response(execution.body, { status: execution.status, headers: execution.headers }),
    };
  } catch (error) {
    reportCaughtError(error, { source: 'application/backend/ingress.ts', operation: `handler:${handler.name}` });
    await finish(500, 'error', error instanceof Error ? error.message : 'Handler failed');
    return { matched: true, response: new Response('Handler failed', { status: 500 }) };
  }
}

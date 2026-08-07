/**
 * `/hooks/:ingressToken/*` — the PUBLIC front door for project backends.
 *
 * This is where a provider's webhook lands: an inbound SMS, an IVR leg on a live
 * call, a WhatsApp reply, a delivery-status callback. It is the piece the
 * platform was missing — everything else could produce a static site, and no
 * interesting system is a static site.
 *
 * ── NO JWT, ON PURPOSE ──────────────────────────────────────────────────────
 * Twilio cannot present a Builderforce session, so this route is unauthenticated
 * at the transport level and authenticated at the MESSAGE level: each handler
 * declares a `verify` kind and the request is rejected before any step runs if it
 * does not check out. The ingress token in the path is NOT the authentication —
 * it prevents enumeration of other tenants' projects, nothing more. A handler
 * that genuinely wants to be open must say `"verify": "none"`, which is a choice
 * recorded in the spec rather than a default nobody noticed.
 *
 * ── WHY A FAILURE STILL RETURNS 200 ─────────────────────────────────────────
 * For an unmatched route or a failed verification we return 4xx, because those
 * are the provider's problem to see. But once a handler is MATCHED and VERIFIED,
 * a step failing inside it returns the handler's normal reply anyway (see
 * handlerRuntime's failure posture). A 500 to Twilio mid-call drops the call and
 * mid-message triggers a retry storm; a degraded but well-formed reply does not.
 */

import { Hono } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import {
  backendByIngressToken,
  ingressUrlFor,
  loadHandlers,
  projectDisplayName,
  recordBackendRequest,
  type ProjectBackend,
} from '../../application/backend';
import { matchHandler, type HandlerSpec } from '../../application/backend/handlerSpec';
import { executeHandler, type HandlerRuntimeDeps } from '../../application/backend/handlerRuntime';
import { VERIFY_SECRET_NAME, verifySharedSecret, verifyTwilioSignature } from '../../application/backend/webhookVerification';
import { loadProjectSecretValues } from '../../application/secrets/projectSecrets';
import { executeConnectorAction } from '../../application/connectors/connectorRuntime';
import { completeForTenant } from '../../application/llm/tenantProxy';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';

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
  switch (handler.verify) {
    case 'none':
      return { ok: true };
    case 'twilio':
      return verifyTwilioSignature({
        url: request.url,
        signature: request.headers.get('x-twilio-signature'),
        authToken: secrets[VERIFY_SECRET_NAME.twilio] ?? '',
        formParams: parsed.formParams,
        rawBody: parsed.rawBody,
        isForm: parsed.isForm,
      });
    case 'shared-secret':
      return verifySharedSecret({
        signature: request.headers.get('x-builderforce-signature') ?? request.headers.get('x-hub-signature-256'),
        secret: secrets[VERIFY_SECRET_NAME['shared-secret']] ?? '',
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
 */
function runtimeDeps(env: Env, db: Db, tenantId: number): HandlerRuntimeDeps {
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
  };
}

export function createHooksRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.all('/:token/*', async (c) => {
    const started = Date.now();
    const token = c.req.param('token');
    const env = c.env as Env & { UPLOADS?: R2Bucket };

    const backend = await backendByIngressToken(env, db, token);
    // An unknown token is a 404 with no detail: distinguishing "no such project"
    // from "that project has no such route" would make the token enumerable.
    if (!backend) return c.text('Not found', 404);
    if (!env.UPLOADS) return c.text('Storage not configured', 503);

    // Everything after `/hooks/<token>` is the handler route.
    const url = new URL(c.req.url);
    const prefix = `/hooks/${token}`;
    const route = (url.pathname.slice(prefix.length).replace(/\/+$/, '') || '/').toLowerCase();
    const method = c.req.method.toUpperCase();

    const finish = async (
      status: number,
      verdict: Parameters<typeof recordBackendRequest>[1]['verdict'],
      error?: string,
    ): Promise<void> => {
      await recordBackendRequest(db, {
        projectId: backend.projectId,
        tenantId: backend.tenantId,
        route,
        method,
        statusCode: status,
        verdict,
        durationMs: Date.now() - started,
        ...(error ? { error } : {}),
      });
    };

    const { specs, errors } = await loadHandlers(env.UPLOADS, backend.projectId);
    const handler = matchHandler(specs, route, method);
    if (!handler) {
      // A broken spec for this exact route is the likeliest reason a handler is
      // "missing", so say so rather than reporting a bare 404 the author will
      // spend an afternoon on.
      const broken = errors.find((e) => e.path.includes(route.replace(/^\//, '')));
      const detail = broken ? `Handler ${broken.path} did not parse: ${broken.reason}` : `No handler for ${method} ${route}`;
      await finish(404, 'no-handler', detail);
      return c.text(detail, 404);
    }

    const parsed = await readBody(c.req.raw);
    if ('tooLarge' in parsed) {
      await finish(413, 'error', 'Request body too large');
      return c.text('Request body too large', 413);
    }

    // Secrets are loaded ONLY for verification and never enter the template scope
    // — see the scope note in handlerSpec.ts.
    const secrets =
      handler.verify === 'none'
        ? {}
        : await loadProjectSecretValues(db, env, backend.tenantId, backend.projectId);

    const verified = await verifyRequest(handler, c.req.raw, parsed, secrets);
    if (!verified.ok) {
      await finish(403, 'unverified', verified.reason);
      return c.text(verified.reason, 403);
    }

    try {
      const execution = await executeHandler(
        handler,
        {
          body: parsed.body,
          query: Object.fromEntries(url.searchParams.entries()),
          headers: Object.fromEntries(
            [...c.req.raw.headers.entries()].filter(([k]) => READABLE_HEADERS.has(k.toLowerCase())),
          ),
          project: {
            id: backend.projectId,
            name: await projectDisplayName(db, backend.tenantId, backend.projectId),
            ingressUrl: ingressUrlFor(env, backend.ingressToken),
          },
        },
        runtimeDeps(env, db, backend.tenantId),
      );

      const failed = execution.steps.filter((s) => !s.ok && !s.skipped);
      await finish(
        execution.status,
        failed.length ? 'error' : 'ok',
        failed.length ? failed.map((s) => `${s.id}: ${s.error}`).join('; ') : undefined,
      );
      return new Response(execution.body, { status: execution.status, headers: execution.headers });
    } catch (error) {
      reportCaughtError(error, { source: 'presentation/routes/hooksRoutes.ts', operation: `handler:${handler.name}` });
      await finish(500, 'error', error instanceof Error ? error.message : 'Handler failed');
      return c.text('Handler failed', 500);
    }
  });

  // A bare `/hooks/<token>` with no path is the URL a user is most likely to open
  // in a browser to check the ingress is alive. Answer usefully instead of 404ing.
  router.get('/:token', async (c) => {
    const env = c.env as Env & { UPLOADS?: R2Bucket };
    const backend = await backendByIngressToken(env, db, c.req.param('token'));
    if (!backend) return c.text('Not found', 404);
    if (!env.UPLOADS) return c.text('Storage not configured', 503);
    const { specs, errors } = await loadHandlers(env.UPLOADS, backend.projectId);
    return c.json({
      ingressUrl: ingressUrlFor(env, backend.ingressToken),
      strategy: backend.strategy,
      handlers: specs.map((s) => ({ name: s.name, method: s.method, route: s.route, verify: s.verify })),
      errors,
    });
  });

  return router;
}

export type { ProjectBackend };

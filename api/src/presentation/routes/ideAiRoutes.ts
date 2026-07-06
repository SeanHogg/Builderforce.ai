/**
 * IDE AI chat — streaming chat for the in-IDE assistant.
 * POST /api/ai/chat — body: { projectId?, messages } — returns SSE stream.
 * When projectId is provided, injects project context (file tree, package.json) so the model
 * responds for this project instead of assuming a generic stack (e.g. Express/EJS).
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { ProjectService } from '../../application/project/ProjectService';
import { authMiddleware } from '../middleware/authMiddleware';
import { ideProxy, newTraceId } from '../../application/llm/LlmProxyService';
import { tenantProxyForPlan } from '../../application/llm/tenantProxy';
import { logTrace } from '../../application/llm/traceLogger';

const IDE_PREFIX = 'ide/';

/** Build project context from R2: file list + package.json (and optionally index.html) for tech stack. */
async function buildProjectContext(
  bucket: R2Bucket,
  projectId: number
): Promise<string> {
  const prefix = `${IDE_PREFIX}projects/${String(projectId)}/`;
  const listed = await bucket.list({ prefix });
  const paths = (listed.objects ?? []).map((o) => o.key!.replace(prefix, '')).filter(Boolean);
  if (paths.length === 0) return `Project files: (empty or not yet created).`;

  const lines = ['Current project file tree:', ...paths.sort().map((p) => `  ${p}`)];
  const keyFiles = ['package.json', 'index.html'];
  for (const name of keyFiles) {
    const key = prefix + name;
    const obj = await bucket.get(key);
    if (obj) {
      const text = await obj.text();
      const preview = text.length > 2000 ? text.slice(0, 2000) + '\n... (truncated)' : text;
      lines.push('', `--- ${name} ---`, preview);
    }
  }
  return lines.join('\n');
}

export function createIdeAiRoutes(projectService: ProjectService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.post('/chat', async (c) => {
    const body = await c.req.json<{ projectId?: string | number; model?: string; messages: Array<{ role: string; content: string }> }>();
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: 'messages array is required' }, 400);
    }

    // Route workforce agents to their dedicated inference endpoint.
    // Accept both the new `builderforce/workforce-<id>` prefix and the legacy
    // `coderclawllm/workforce-<id>` prefix for backwards compatibility.
    const workforceMatch = typeof body.model === 'string'
      ? /^(?:builderforce|coderclawllm)\/workforce-([^/\s]+)$/.exec(body.model)
      : null;
    if (workforceMatch) {
      const agentId = workforceMatch[1];
      const agentUrl = new URL(c.req.url);
      agentUrl.pathname = agentUrl.pathname.replace('/ai/chat', `/ide/agents/${agentId}/chat`);
      const forwarded = new Request(agentUrl.toString(), {
        method: 'POST',
        headers: c.req.raw.headers,
        body: JSON.stringify({ messages: body.messages, stream: true }),
      });
      return fetch(forwarded);
    }

    if (!c.env.OPENROUTER_API_KEY || !c.env.OPENROUTER_API_KEY.trim()) {
      return c.json(
        {
          error: 'LLM not configured',
          hint: 'Set OPENROUTER_API_KEY: get a key at openrouter.ai, then run in api/: wrangler secret put OPENROUTER_API_KEY  (or add to .env and run npm run secrets:from-env)',
        },
        503
      );
    }

    let messages = body.messages.map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));

    if (body.projectId != null && body.projectId !== '') {
      const projectId = Number(body.projectId);
      if (Number.isFinite(projectId) && projectId >= 1) {
        await projectService.getProject(projectId, c.get('tenantId'));
        const bucket = c.env.UPLOADS;
        if (bucket) {
          const context = await buildProjectContext(bucket, projectId);
          const systemContext =
            'You are an expert coding assistant inside the Builderforce IDE. The user is working on a specific project. Use the following project context to give accurate, actionable answers. Do not assume a different stack (e.g. do not assume Express/EJS unless the project files show that). Prefer editing/creating files that match the existing structure.\n\n' +
            context;
          const existingSystem = messages.find((m) => m.role === 'system');
          if (existingSystem) {
            messages = messages.map((m) =>
              m.role === 'system' ? { ...m, content: systemContext + '\n\n--- User instructions ---\n' + m.content } : m
            );
          } else {
            messages = [{ role: 'system', content: systemContext }, ...messages];
          }
        }
      }
    }

    const traceId = newTraceId();
    const requestBody = { messages, stream: true } as const;
    // Tenant-facing IDE assistant chat → run on the tenant's connected BYO account when
    // they have one (the connected flagship leads; plain chat → Sonnet for Anthropic),
    // falling back to the operator pool otherwise. Not a tool loop, so no codingOnly.
    const ideChatTenantId = c.get('tenantId');
    const { proxy: ideChatProxy } = ideChatTenantId != null
      ? await tenantProxyForPlan(c.env, ideChatTenantId)
      : { proxy: ideProxy(c.env) };
    const result = await ideChatProxy.complete(requestBody, undefined, traceId);

    // Full diagnostic trace (builder-side only). Surface is `ide-chat` so the
    // superadmin trace view can tell in-IDE assistant calls apart from gateway
    // API traffic. Tenant comes from the auth middleware; no end-user id here.
    logTrace(c.env, c.executionCtx, {
      traceId, surface: 'ide-chat',
      tenantId: c.get('tenantId') ?? null,
      userId: c.get('userId') ?? null,
      result, streamed: true,
      requestIp: c.req.header('cf-connecting-ip') ?? null,
      origin: c.req.header('Origin') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
      requestBody: requestBody as unknown as Record<string, unknown>,
      responseBody: null, errorMessage: null,
    });

    if (!result.response.body) {
      return c.json({ error: 'No stream body', traceId }, 502);
    }
    return new Response(result.response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked',
        'x-builderforce-trace-id': traceId,
      },
    });
  });

  return router;
}

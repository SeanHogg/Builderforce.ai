/**
 * IDE AI chat — streaming chat for the in-IDE assistant.
 * POST /api/ai/chat — body: { projectId?, messages } — returns SSE stream.
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import { LlmProxyService, FREE_MODEL_POOL } from '../../application/llm/LlmProxyService';

export function createIdeAiRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.post('/chat', async (c) => {
    const body = await c.req.json<{ projectId?: string; messages: Array<{ role: string; content: string }> }>();
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: 'messages array is required' }, 400);
    }
    const apiKey = c.env.OPENROUTER_API_KEY;
    if (!apiKey) return c.json({ error: 'LLM not configured' }, 503);

    const service = new LlmProxyService(apiKey, {
      modelPool: FREE_MODEL_POOL,
      preferredPoolSize: 2,
      productName: 'builderforce-ide-chat',
    });
    const result = await service.complete({
      messages: body.messages.map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
      stream: true,
    });

    if (!result.response.body) {
      return c.json({ error: 'No stream body' }, 502);
    }
    return new Response(result.response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked',
      },
    });
  });

  return router;
}

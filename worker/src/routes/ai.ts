import { Hono } from 'hono';
import { streamAIResponse } from '../services/ai';
import type { AIEnv } from '../services/ai';

const ai = new Hono<{ Bindings: AIEnv }>();

ai.post('/chat', async (c) => {
  try {
    const body = await c.req.json<{
      projectId: string;
      messages: { role: string; content: string }[];
    }>();

    const messages = body.messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    return streamAIResponse(messages, c.env);
  } catch (e) {
    console.error('AI chat error:', e);
    return c.json({ error: 'AI service error' }, 500);
  }
});

export default ai;

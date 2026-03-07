import { Hono } from 'hono';
import { stream } from 'hono/streaming';

interface Env {
  AI: Ai;
}

const ai = new Hono<{ Bindings: Env }>();

ai.post('/chat', async (c) => {
  try {
    const body = await c.req.json<{
      projectId: string;
      messages: { role: string; content: string }[];
    }>();

    const messages: RoleScopedChatInput[] = body.messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    if (!messages.find(m => m.role === 'system')) {
      messages.unshift({
        role: 'system',
        content: 'You are an expert coding assistant. Help users write, debug, and improve code. Be concise and provide working code examples.',
      });
    }

    return stream(c, async (streamWriter) => {
      const response = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct' as keyof AiModels, {
        messages,
        stream: true,
      });

      if (response instanceof ReadableStream) {
        const reader = response.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          await streamWriter.write(text);
        }
      } else {
        const result = response as { response?: string };
        await streamWriter.write(`data: ${JSON.stringify({ response: result.response || '' })}\n\n`);
      }
    });
  } catch (e) {
    console.error('AI chat error:', e);
    return c.json({ error: 'AI service error' }, 500);
  }
});

export default ai;

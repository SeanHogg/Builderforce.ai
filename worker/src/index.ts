import { Hono } from 'hono';
import { cors } from 'hono/cors';
import projectsRouter from './routes/projects';
import filesRouter from './routes/files';
import aiRouter from './routes/ai';
import { CollaborationRoom } from './durable-objects/CollaborationRoom';

export { CollaborationRoom };

interface Env {
  NEON_DATABASE_URL: string;
  STORAGE: R2Bucket;
  /** Cloudflare Workers AI binding — used when AI_PROVIDER is "cloudflare" (default) or "ab". */
  AI?: Ai;
  /** OpenRouter API key — used when AI_PROVIDER is "openrouter" or "ab". */
  OPENROUTER_API_KEY?: string;
  /** Selects the active AI provider: "cloudflare" | "openrouter" | "ab". Defaults to "cloudflare". */
  AI_PROVIDER?: 'cloudflare' | 'openrouter' | 'ab';
  COLLABORATION_ROOM: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.route('/api/projects', projectsRouter);
app.route('/api/projects/:projectId/files', filesRouter);
app.route('/api/ai', aiRouter);

app.get('/api/collab/:sessionId/ws', async (c) => {
  const sessionId = c.req.param('sessionId');
  const id = c.env.COLLABORATION_ROOM.idFromName(sessionId);
  const room = c.env.COLLABORATION_ROOM.get(id);
  return room.fetch(c.req.raw);
});

app.get('/api/collab/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const id = c.env.COLLABORATION_ROOM.idFromName(sessionId);
  const room = c.env.COLLABORATION_ROOM.get(id);
  return room.fetch(c.req.raw);
});

app.get('/', (c) => c.json({ name: 'Builderforce Worker', version: '0.1.0' }));

export default app;

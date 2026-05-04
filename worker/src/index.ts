import { Hono } from 'hono';
import { cors } from 'hono/cors';
import projectsRouter from './routes/projects';
import filesRouter from './routes/files';
import datasetsRouter from './routes/datasets';
import trainingRouter from './routes/training';
import agentsRouter from './routes/agents';
import { CollaborationRoom } from './durable-objects/CollaborationRoom';

export { CollaborationRoom };

interface Env {
  NEON_DATABASE_URL: string;
  STORAGE: R2Bucket;
  /** Gateway base URL for worker -> api.builderforce.ai /llm calls. */
  BUILDERFORCE_API_BASE_URL?: string;
  COLLABORATION_ROOM: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Global error handler middleware
app.onError((err, c) => {
  const errorDetails = {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    route: c.req.path,
    method: c.req.method,
    timestamp: new Date().toISOString(),
  };
  // Log to console
  console.error('Global error handler:', errorDetails);
  // Optionally log to R2 if available
  if (typeof c.env?.STORAGE?.put === 'function') {
    const logPath = 'logs/global-errors.txt';
    const logMsg = `${JSON.stringify(errorDetails)}\n`;
    c.env.STORAGE.put(logPath, logMsg, { httpMetadata: { contentType: 'text/plain' } });
  }
  return c.json({ error: 'Internal Server Error', details: errorDetails }, 500);
});

app.route('/api/projects', projectsRouter);
app.route('/api/projects/:projectId/files', filesRouter);
app.route('/api/datasets', datasetsRouter);
app.route('/api/training', trainingRouter);
app.route('/api/agents', agentsRouter);

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

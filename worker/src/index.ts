import { Hono } from 'hono';
import { cors } from 'hono/cors';
import filesRouter from './routes/files';
import datasetsRouter from './routes/datasets';
import trainingRouter from './routes/training';
import agentsRouter from './routes/agents';

interface Env {
  NEON_DATABASE_URL: string;
  STORAGE: R2Bucket;
  /** Gateway base URL for worker -> api.builderforce.ai /llm calls. */
  BUILDERFORCE_API_BASE_URL?: string;
  /** SECURITY (H9): shared HS256 session-token secret — MUST equal the api's
   *  JWT_SECRET. Set via `wrangler secret put JWT_SECRET` in worker/. The data
   *  routes fail closed (503) without it. See lib/auth.ts. */
  JWT_SECRET?: string;
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

// NOTE: there is no worker `/api/projects` CRUD router any more — it was a
// drifted duplicate of the API's (unscoped reads, dropped `dueDate`, no health
// aggregate) and is retired. Only the FILES sub-path below is served here.
app.route('/api/projects/:projectId/files', filesRouter);
app.route('/api/datasets', datasetsRouter);
app.route('/api/training', trainingRouter);
app.route('/api/agents', agentsRouter);

// NOTE: real-time co-editing does NOT live here. `CollaborationRoom` used to be a
// Durable Object in this script with two UNAUTHENTICATED routes — any caller could
// name any room and read or write the document inside it — and this script has never
// been deployed, so the feature could not exist either. It is now `CollaborationRoomDO`
// in the api Worker, behind authMiddleware plus a per-scope authorization registry
// (api/src/application/collab/collabScopes.ts), and it ships with the ordinary api
// release. Do not reintroduce a second room here.

app.get('/', (c) => c.json({ name: 'Builderforce Worker', version: '0.1.0' }));

export default app;

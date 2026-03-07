import { Hono } from 'hono';
import { cors } from 'hono/cors';
import projectsRouter from './routes/projects';
import aiRouter from './routes/ai';
import { CollaborationRoom } from './durable-objects/CollaborationRoom';

export { CollaborationRoom };

interface Env {
  NEON_DATABASE_URL: string;
  STORAGE: R2Bucket;
  AI: Ai;
  COLLABORATION_ROOM: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.route('/api/projects', projectsRouter);

app.get('/api/projects/:projectId/files', async (c) => {
  const projectId = c.req.param('projectId');
  try {
    const listed = await c.env.STORAGE.list({ prefix: `${projectId}/` });
    const fileEntries = listed.objects.map(obj => ({
      path: obj.key.replace(`${projectId}/`, ''),
      type: 'file' as const,
      content: '',
    }));
    return c.json(fileEntries);
  } catch (e) {
    return c.json({ error: 'Failed to list files' }, 500);
  }
});

app.get('/api/projects/:projectId/files/*', async (c) => {
  const projectId = c.req.param('projectId');
  const filePath = c.req.param('*') || '';
  const key = `${projectId}/${filePath}`;
  try {
    const obj = await c.env.STORAGE.get(key);
    if (!obj) return c.text('', 200);
    return c.text(await obj.text());
  } catch (e) {
    return c.json({ error: 'Failed to read file' }, 500);
  }
});

app.put('/api/projects/:projectId/files/*', async (c) => {
  const projectId = c.req.param('projectId');
  const filePath = c.req.param('*') || '';
  const key = `${projectId}/${filePath}`;
  try {
    const content = await c.req.text();
    await c.env.STORAGE.put(key, content);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: 'Failed to write file' }, 500);
  }
});

app.delete('/api/projects/:projectId/files/*', async (c) => {
  const projectId = c.req.param('projectId');
  const filePath = c.req.param('*') || '';
  const key = `${projectId}/${filePath}`;
  try {
    await c.env.STORAGE.delete(key);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: 'Failed to delete file' }, 500);
  }
});

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

import { Hono } from 'hono';
import { validateWorkspacePath } from '../lib/workspacePath';
import { requireAuth, type WorkerAuthBindings } from '../lib/auth';

interface Env extends WorkerAuthBindings {
  STORAGE: R2Bucket;
}

const files = new Hono<{ Bindings: Env }>();

// SECURITY (H9/L7): require a valid Bearer session token before any R2 file access.
// Path validation (below) stops key traversal; this gate stops anonymous access —
// together they close the "any caller who knows a projectId can read/write/delete
// its files" hole. Needs JWT_SECRET bound in the worker (see lib/auth.ts).
files.use('*', requireAuth);

files.get('/', async (c) => {
  try {
    const projectId = c.req.param('projectId');
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

files.get('/*', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const filePath = c.req.param('*') || '';
    const valid = validateWorkspacePath(filePath);
    if (!valid.ok) return c.json({ error: valid.reason }, 400);
    const key = `${projectId}/${filePath}`;
    const obj = await c.env.STORAGE.get(key);
    // Missing is 404, matching the api's workspaceStore semantics — an empty 200
    // for a never-written object let callers cache '' as if it were real content.
    if (!obj) return c.json({ error: 'File not found' }, 404);
    const content = await obj.text();
    return c.text(content);
  } catch (e) {
    return c.json({ error: 'Failed to read file' }, 500);
  }
});

files.put('/*', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const filePath = c.req.param('*') || '';
    const valid = validateWorkspacePath(filePath);
    if (!valid.ok) return c.json({ error: valid.reason }, 400);
    const key = `${projectId}/${filePath}`;
    const content = await c.req.text();
    await c.env.STORAGE.put(key, content);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: 'Failed to write file' }, 500);
  }
});

files.delete('/*', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const filePath = c.req.param('*') || '';
    const valid = validateWorkspacePath(filePath);
    if (!valid.ok) return c.json({ error: valid.reason }, 400);
    const key = `${projectId}/${filePath}`;
    await c.env.STORAGE.delete(key);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: 'Failed to delete file' }, 500);
  }
});

export default files;

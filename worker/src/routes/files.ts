import { Hono } from 'hono';
import { validateWorkspacePath } from '../lib/workspacePath';

interface Env {
  STORAGE: R2Bucket;
}

const files = new Hono<{ Bindings: Env }>();

// SECURITY NOTE (L7): this router mounts at /api/projects/:projectId/files with
// NO authentication upstream (worker/src/index.ts applies only permissive CORS)
// and no per-tenant ownership check on projectId. The path validation below stops
// key traversal/injection, but access control is still MISSING — any caller who
// knows a projectId can read/write/delete its files. Adding an auth check here
// (shared bearer/JWT, matching the api gateway) is an ops follow-up that needs a
// worker secret binding; flagged in the remediation report.

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

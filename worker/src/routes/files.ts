import { Hono } from 'hono';

interface Env {
  STORAGE: R2Bucket;
}

const files = new Hono<{ Bindings: Env }>();

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
    const key = `${projectId}/${filePath}`;
    const obj = await c.env.STORAGE.get(key);
    if (!obj) return c.text('', 200);
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
    const key = `${projectId}/${filePath}`;
    await c.env.STORAGE.delete(key);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: 'Failed to delete file' }, 500);
  }
});

export default files;

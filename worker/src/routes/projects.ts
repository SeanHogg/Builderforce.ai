import { Hono } from 'hono';

interface Env {
  DB: D1Database;
}

const projects = new Hono<{ Bindings: Env }>();

function generateId(): string {
  return crypto.randomUUID();
}

projects.get('/', async (c) => {
  try {
    const result = await c.env.DB.prepare(
      'SELECT * FROM projects ORDER BY updated_at DESC'
    ).all();
    return c.json(result.results);
  } catch (e) {
    return c.json({ error: 'Failed to fetch projects' }, 500);
  }
});

projects.post('/', async (c) => {
  try {
    const body = await c.req.json<{ name: string; description?: string; template?: string }>();
    const id = generateId();
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'INSERT INTO projects (id, name, description, owner_id, template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, body.name, body.description || null, 'anonymous', body.template || 'vanilla', now, now).run();
    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
    return c.json(project, 201);
  } catch (e) {
    return c.json({ error: 'Failed to create project' }, 500);
  }
});

projects.get('/:id', async (c) => {
  try {
    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?')
      .bind(c.req.param('id'))
      .first();
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(project);
  } catch (e) {
    return c.json({ error: 'Failed to fetch project' }, 500);
  }
});

projects.put('/:id', async (c) => {
  try {
    const body = await c.req.json<{ name?: string; description?: string }>();
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = ? WHERE id = ?'
    ).bind(body.name || null, body.description || null, now, c.req.param('id')).run();
    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?')
      .bind(c.req.param('id'))
      .first();
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(project);
  } catch (e) {
    return c.json({ error: 'Failed to update project' }, 500);
  }
});

projects.delete('/:id', async (c) => {
  try {
    await c.env.DB.prepare('DELETE FROM projects WHERE id = ?')
      .bind(c.req.param('id'))
      .run();
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: 'Failed to delete project' }, 500);
  }
});

export default projects;

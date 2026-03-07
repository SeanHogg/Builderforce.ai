import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';

interface Env {
  NEON_DATABASE_URL: string;
}

const projects = new Hono<{ Bindings: Env }>();

function generateId(): string {
  return crypto.randomUUID();
}

projects.get('/', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`SELECT * FROM projects ORDER BY updated_at DESC`;
    return c.json(rows);
  } catch (e) {
    return c.json({ error: 'Failed to fetch projects' }, 500);
  }
});

projects.post('/', async (c) => {
  try {
    const body = await c.req.json<{ name: string; description?: string; template?: string }>();
    const sql = neon(c.env.NEON_DATABASE_URL);
    const id = generateId();
    const rows = await sql`
      INSERT INTO projects (id, name, description, owner_id, template)
      VALUES (${id}, ${body.name}, ${body.description ?? null}, 'anonymous', ${body.template ?? 'vanilla'})
      RETURNING *
    `;
    return c.json(rows[0], 201);
  } catch (e) {
    return c.json({ error: 'Failed to create project' }, 500);
  }
});

projects.get('/:id', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`SELECT * FROM projects WHERE id = ${c.req.param('id')}`;
    if (rows.length === 0) return c.json({ error: 'Project not found' }, 404);
    return c.json(rows[0]);
  } catch (e) {
    return c.json({ error: 'Failed to fetch project' }, 500);
  }
});

projects.put('/:id', async (c) => {
  try {
    const body = await c.req.json<{ name?: string; description?: string }>();
    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`
      UPDATE projects
      SET
        name        = COALESCE(${body.name ?? null}, name),
        description = COALESCE(${body.description ?? null}, description),
        updated_at  = NOW()
      WHERE id = ${c.req.param('id')}
      RETURNING *
    `;
    if (rows.length === 0) return c.json({ error: 'Project not found' }, 404);
    return c.json(rows[0]);
  } catch (e) {
    return c.json({ error: 'Failed to update project' }, 500);
  }
});

projects.delete('/:id', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`DELETE FROM projects WHERE id = ${c.req.param('id')} RETURNING id`;
    if (rows.length === 0) return c.json({ error: 'Project not found' }, 404);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: 'Failed to delete project' }, 500);
  }
});

export default projects;

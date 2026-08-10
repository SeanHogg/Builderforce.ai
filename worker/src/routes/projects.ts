import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { requireAuth, type WorkerAuthBindings } from '../lib/auth';
import { scaffoldForProject } from '../../../api/src/application/project/projectTemplate';

interface Env extends WorkerAuthBindings {
  NEON_DATABASE_URL: string;
  STORAGE: R2Bucket;
}

const projects = new Hono<{ Bindings: Env }>();

// SECURITY (H9): the worker project routes read/create/update/delete rows over the
// open internet; require a valid Bearer session token (matches the api gateway).
projects.use('*', requireAuth);

export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Starter templates come from the API's `projectTemplate` module — the single
 * source the auth API and the lazy self-heal already seed from. This route used
 * to keep its own `VANILLA_TEMPLATE` copy AND ignore its `template` argument, so
 * a `mobile` / `webmobile` project created through this legacy worker was seeded
 * with the Vite scaffold and opened unrunnable. Re-exported for the tests that
 * assert the scaffold's shape.
 */
export { VANILLA_TEMPLATE, MOBILE_TEMPLATE } from '../../../api/src/application/project/projectTemplate';

/** Seed a new project's workspace with the scaffold its template/modality selects. */
export async function createTemplateFiles(
  storage: R2Bucket,
  projectId: string,
  template: string | null,
  modality = 'designer',
): Promise<void> {
  const files = scaffoldForProject({ id: 0, template, modality, sourceControlRepoFullName: null, githubRepoUrl: null });
  if (!files) return;
  await Promise.all(
    Object.entries(files).map(([path, content]) =>
      storage.put(`${projectId}/${path}`, content)
    )
  );
}

projects.get('/', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`SELECT * FROM projects ORDER BY updated_at DESC`;
    return c.json(rows);
  } catch (e) {
    // Log error to R2 in Worker, console.error for local
    const logPath = 'logs/errors.txt';
    const logMsg = `[${new Date().toISOString()}] GET /api/projects error: ${e instanceof Error ? e.stack : e}\n`;
    if (typeof c.env.STORAGE?.put === 'function') {
      await c.env.STORAGE.put(logPath, logMsg, { httpMetadata: { contentType: 'text/plain' } });
    }
    // Always print error details to console
    console.error('GET /api/projects error:', e instanceof Error ? e.stack : e);
    return c.json({ error: 'Failed to fetch projects', logPath }, 500);
  }
});

projects.post('/', async (c) => {
  try {
    const body = await c.req.json<{ name: string; description?: string; template?: string; modality?: string }>();
    const sql = neon(c.env.NEON_DATABASE_URL);
    const id = generateId();
    // No `?? 'vanilla'` default: an explicit template WINS over the modality, so
    // defaulting it here silently shadowed the modality and seeded every Mobile /
    // Web + Mobile project with the Vite scaffold. Null lets the modality decide,
    // matching the auth API's create path.
    const template = body.template ?? null;
    const modality = body.modality ?? 'designer';
    const rows = await sql`
      INSERT INTO projects (id, name, description, owner_id, template, modality)
      VALUES (${id}, ${body.name}, ${body.description ?? null}, 'anonymous', ${template}, ${modality})
      RETURNING *
    `;
    await createTemplateFiles(c.env.STORAGE, id, template, modality);
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
    const body = await c.req.json<{ name?: string; description?: string; modality?: string; key?: string; status?: string }>();
    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`
      UPDATE projects
      SET
        name        = COALESCE(${body.name ?? null}, name),
        description = COALESCE(${body.description ?? null}, description),
        modality    = COALESCE(${body.modality ?? null}, modality),
        key         = COALESCE(UPPER(${body.key?.trim() || null}), key),
        status      = COALESCE(${body.status ?? null}, status),
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

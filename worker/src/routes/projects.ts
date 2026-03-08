import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';

interface Env {
  NEON_DATABASE_URL: string;
  STORAGE: R2Bucket;
}

const projects = new Hono<{ Bindings: Env }>();

export function generateId(): string {
  return crypto.randomUUID();
}

/** Default files for new (vanilla) projects. Must match API template and Run flow. */
export const VANILLA_TEMPLATE: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'my-app',
    version: '1.0.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
    devDependencies: { '@vitejs/plugin-react': '^4.0.0', vite: '^4.3.9' },
  }, null, 2),
  'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`,
  'src/main.jsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

function App() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Hello World! 🚀</h1>
      <p>Edit src/main.jsx to get started.</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);`,
  'src/index.css': `body {
  margin: 0;
  padding: 0;
  font-family: system-ui, -apple-system, sans-serif;
}`,
  'vite.config.js': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});`,
};

export async function createTemplateFiles(storage: R2Bucket, projectId: string, template: string): Promise<void> {
  const files = VANILLA_TEMPLATE;
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
    const body = await c.req.json<{ name: string; description?: string; template?: string }>();
    const sql = neon(c.env.NEON_DATABASE_URL);
    const id = generateId();
    const template = body.template ?? 'vanilla';
    const rows = await sql`
      INSERT INTO projects (id, name, description, owner_id, template)
      VALUES (${id}, ${body.name}, ${body.description ?? null}, 'anonymous', ${template})
      RETURNING *
    `;
    await createTemplateFiles(c.env.STORAGE, id, template);
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

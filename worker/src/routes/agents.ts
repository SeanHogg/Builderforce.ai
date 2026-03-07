import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { generateId } from './projects';

interface Env {
  NEON_DATABASE_URL: string;
  STORAGE: R2Bucket;
}

const agents = new Hono<{ Bindings: Env }>();

agents.get('/', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`
      SELECT * FROM agents WHERE status = 'active' ORDER BY hire_count DESC, created_at DESC
    `;
    return c.json(rows);
  } catch (e) {
    return c.json({ error: 'Failed to fetch agents' }, 500);
  }
});

agents.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      project_id: string;
      job_id?: string;
      name: string;
      title: string;
      bio: string;
      skills?: string[];
      base_model: string;
      lora_rank?: number;
      r2_artifact_key?: string;
      resume_md?: string;
      eval_score?: number;
    }>();
    const sql = neon(c.env.NEON_DATABASE_URL);
    const id = generateId();
    const skillsJson = JSON.stringify(body.skills ?? []);
    const rows = await sql`
      INSERT INTO agents (
        id, project_id, job_id, name, title, bio, skills,
        base_model, lora_rank, r2_artifact_key, resume_md,
        status, hire_count, eval_score
      ) VALUES (
        ${id}, ${body.project_id}, ${body.job_id ?? null},
        ${body.name}, ${body.title}, ${body.bio}, ${skillsJson},
        ${body.base_model}, ${body.lora_rank ?? null}, ${body.r2_artifact_key ?? null},
        ${body.resume_md ?? null}, 'active', 0, ${body.eval_score ?? null}
      )
      RETURNING *
    `;
    return c.json(rows[0], 201);
  } catch (e) {
    return c.json({ error: 'Failed to publish agent' }, 500);
  }
});

agents.get('/:id', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`SELECT * FROM agents WHERE id = ${c.req.param('id')}`;
    if (rows.length === 0) return c.json({ error: 'Agent not found' }, 404);
    return c.json(rows[0]);
  } catch (e) {
    return c.json({ error: 'Failed to fetch agent' }, 500);
  }
});

agents.post('/:id/hire', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const rows = await sql`
      UPDATE agents
      SET hire_count = hire_count + 1, updated_at = NOW()
      WHERE id = ${c.req.param('id')}
      RETURNING *
    `;
    if (rows.length === 0) return c.json({ error: 'Agent not found' }, 404);
    return c.json(rows[0]);
  } catch (e) {
    return c.json({ error: 'Failed to hire agent' }, 500);
  }
});

export default agents;

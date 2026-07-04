/**
 * Project facts routes — the shared, per-project write-through knowledge tier
 * ([[evermind-learning-architecture]]). Two auth front doors share ONE set of core
 * handlers (DRY): the web UI / VS Code reach `/api/projects/:projectId/facts`; on-prem
 * agents (agentHost key, not a JWT) reach `/api/agent/projects/:projectId/facts`. Both
 * resolve to the same tenant-scoped `projectFacts` service, so every surface reads +
 * writes the SAME facts.
 *
 *   GET  /facts?query=&limit=  — recall (read-through cached)
 *   POST /facts { key, content, source? } — write-through upsert (replace by key)
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { resolveHostAuth } from '../../infrastructure/auth/agentHostAuth';
import { projects } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { recallProjectFacts, upsertProjectFact } from '../../application/llm/projectFacts';

/** Verify the project exists AND belongs to this tenant (IDOR guard). */
async function ownsProject(db: Db, tenantId: number, projectId: number): Promise<boolean> {
  if (!Number.isInteger(projectId) || projectId <= 0) return false;
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  return !!row;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const pid = (c: Context): number => Number(c.req.param('projectId'));

async function recallCore(env: Env, db: Db, tenantId: number, projectId: number, c: Context): Promise<Response> {
  if (!(await ownsProject(db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const query = c.req.query('query') ?? undefined;
  const limitQ = Number(c.req.query('limit'));
  const facts = await recallProjectFacts(env, db, tenantId, projectId, {
    ...(query ? { query } : {}),
    ...(Number.isFinite(limitQ) && limitQ > 0 ? { limit: limitQ } : {}),
  });
  return json({ facts });
}

async function rememberCore(env: Env, db: Db, tenantId: number, projectId: number, c: Context): Promise<Response> {
  if (!(await ownsProject(db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const body = (await c.req.json<{ key?: unknown; content?: unknown; source?: unknown }>().catch(() => ({}))) as {
    key?: unknown; content?: unknown; source?: unknown;
  };
  const key = typeof body.key === 'string' ? body.key : '';
  const content = typeof body.content === 'string' ? body.content : '';
  if (!key.trim() || !content.trim()) return json({ error: 'key and content are required' }, 400);
  const ok = await upsertProjectFact(env, db, tenantId, projectId, key, content, typeof body.source === 'string' ? body.source : 'agent');
  return json({ ok, key: key.trim() });
}

// ── JWT front door (web UI + VS Code + internal JWT callers) ──────────────────
export function createProjectFactsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  const t = (c: Context) => c.get('tenantId') as number;

  router.get('/:projectId/facts', (c) => recallCore(c.env as Env, db, t(c), pid(c), c));
  router.post('/:projectId/facts', (c) => rememberCore(c.env as Env, db, t(c), pid(c), c));
  return router;
}

// ── Agent (on-prem host key) front door ───────────────────────────────────────
export function createProjectFactsAgentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const auth = async (c: Context): Promise<number | null> => {
    const host = await resolveHostAuth(db, c);
    return host?.tenantId ?? null;
  };
  router.get('/:projectId/facts', async (c) => {
    const tenantId = await auth(c);
    if (tenantId == null) return json({ error: 'unauthorized' }, 401);
    return recallCore(c.env as Env, db, tenantId, pid(c), c);
  });
  router.post('/:projectId/facts', async (c) => {
    const tenantId = await auth(c);
    if (tenantId == null) return json({ error: 'unauthorized' }, 401);
    return rememberCore(c.env as Env, db, tenantId, pid(c), c);
  });
  return router;
}

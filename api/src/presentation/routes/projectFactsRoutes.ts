/**
 * Project facts routes — the shared, per-project write-through knowledge tier
 * ([[evermind-learning-architecture]]). Two auth front doors share ONE set of core
 * handlers (DRY): the web UI / VS Code reach `/api/projects/:projectId/facts`; on-prem
 * agents (agentHost key, not a JWT) reach `/api/agent/projects/:projectId/facts`. Both
 * are the SAME router built with a different {@link FrontDoor}, so every surface reads +
 * writes the SAME facts.
 *
 *   GET  /facts?query=&limit=  — recall (read-through cached)
 *   POST /facts { key, content, source? } — write-through upsert (replace by key)
 *   DELETE /facts/:key          — retire one fact (a writer removing what it owns)
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { tenantDoor, type FrontDoor } from '../middleware/frontDoor';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { deleteProjectFact, hostDirectoryHashReader, parseFactFileAnchors, recallProjectFacts, upsertProjectFact } from '../../application/llm/projectFacts';
import { cloudExecutionIdFromRequest } from '../../application/llm/cloudByoPolicy';
import { resolveMemoryAnswer, cacheProjectAnswer } from '../../application/llm/projectMemory';
import { recordMemoryAnswerSavings } from '../../application/llm/memoryAnswerSavings';
import { normalizeUsageSurface } from '../../application/llm/savingsLedger';
import { evermindGenerate, type ArtifactStore } from '../../application/llm/evermindRuntime';
import { projectInTenantCached } from '../../application/project/projectOwnership';
import { parseOptionalBody, z } from './requestBody';

/** Every field is type-guarded by the handler, which answers its own
 *  "… are required" — the schema only refuses a non-object body. */
const RememberFactBody = z.object({
  key: z.unknown().optional(),
  content: z.unknown().optional(),
  source: z.unknown().optional(),
  fileAnchors: z.unknown().optional(),
  origin: z.object({
    model: z.string().max(200),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
  }).optional(),
});

const CacheAnswerBody = z.object({
  question: z.unknown().optional(),
  answer: z.unknown().optional(),
  /** What producing `answer` cost — the writing turn's served model and summed tokens.
   *  Stored with the cached answer so its replays are priced from a recorded figure. */
  origin: z.object({
    model: z.string().max(200),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
  }).optional(),
  fileAnchors: z.unknown().optional(),
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const pid = (c: Context): number => Number(c.req.param('projectId'));

async function recallCore(env: Env, db: Db, tenantId: number, projectId: number, c: Context): Promise<Response> {
  if (!(await projectInTenantCached(env, db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const query = c.req.query('query') ?? undefined;
  const limitQ = Number(c.req.query('limit'));
  const facts = await recallProjectFacts(env, db, tenantId, projectId, {
    ...(query ? { query } : {}),
    ...(Number.isFinite(limitQ) && limitQ > 0 ? { limit: limitQ } : {}),
    readFileHash: hostDirectoryHashReader(db, tenantId),
  });
  return json({ facts });
}

async function rememberCore(env: Env, db: Db, tenantId: number, projectId: number, c: Context): Promise<Response> {
  if (!(await projectInTenantCached(env, db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const body = await parseOptionalBody(c, RememberFactBody);
  const key = typeof body.key === 'string' ? body.key : '';
  const content = typeof body.content === 'string' ? body.content : '';
  if (!key.trim() || !content.trim()) return json({ error: 'key and content are required' }, 400);
  const fileAnchors = parseFactFileAnchors(body.fileAnchors);
  const originExecutionId = cloudExecutionIdFromRequest((name) => c.req.header(name));
  const ok = await upsertProjectFact(env, db, tenantId, projectId, key, content, typeof body.source === 'string' ? body.source : 'agent', {
    ...(originExecutionId != null ? { originExecutionId } : {}),
    ...(body.origin ? { origin: body.origin } : {}),
    ...(fileAnchors ? { fileAnchors } : {}),
  });
  return json({ ok, key: key.trim() });
}

/** Retire one fact by key. `ok` says whether a fact was removed (absent is not an error). */
async function forgetCore(env: Env, db: Db, tenantId: number, projectId: number, c: Context): Promise<Response> {
  if (!(await projectInTenantCached(env, db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const key = decodeURIComponent(c.req.param('key') ?? '');
  if (!key.trim()) return json({ error: 'key is required' }, 400);
  const removed = await deleteProjectFact(env, db, tenantId, projectId, key);
  return json({ ok: true, removed, key: key.trim() });
}

/**
 * Memory-first "answer without the LLM" resolver. Consults the ONE shared capability
 * (`resolveMemoryAnswer`): the exact-repeat Q&A cache first (an O(1), read-through-cached
 * PK lookup), then — only when the project opted into inference — the project's Evermind
 * SSM run DIRECTLY (`evermindGenerate`, no gateway / no paid model). Returns `{ answer:null }`
 * when memory can't confidently answer, so the caller runs its normal loop. The cheap path
 * is cached; the Evermind path is bounded by the `inferenceEnabled` opt-in and is followed
 * by a write-through to the Q&A cache (the caller's cache step), so repeats become O(1).
 *
 * `?tools=0` declares a caller with NO tools available — the only case where the Evermind
 * leg may pre-empt the model (it cannot call a tool, so it must never short-circuit a run
 * that could fetch the real answer). Absent/anything else = tools available = cache only.
 */
async function resolveAnswerCore(env: Env, db: Db, tenantId: number, projectId: number, c: Context, userId: string | null): Promise<Response> {
  if (!(await projectInTenantCached(env, db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const question = c.req.query('query') ?? '';
  if (!question.trim()) return json({ error: 'query is required' }, 400);
  const store = env.UPLOADS as ArtifactStore | undefined;
  const runEvermind = store
    ? async (ref: string, q: string): Promise<string | null> => {
        try {
          const gen = await evermindGenerate(store, ref, [{ role: 'user', content: q }], { maxTokens: 400 });
          return gen.content ?? null;
        } catch {
          return null; // SSM miss/error → fall through to the LLM
        }
      }
    : undefined;
  const toolsAvailable = c.req.query('tools') !== '0';
  const answer = await resolveMemoryAnswer(env, db, tenantId, projectId, question, {
    ...(runEvermind ? { runEvermind } : {}),
    toolsAvailable,
  });
  if (!answer) return json({ answer: null });
  // A hit is a model call that did not happen — record what it would have cost. Off the
  // response path: the person is waiting for the answer, not for the bookkeeping.
  const chatId = Number(c.req.query('chatId'));
  const saving = recordMemoryAnswerSavings(env, db, {
    tenantId,
    userId,
    projectId,
    chatId: Number.isSafeInteger(chatId) && chatId > 0 ? chatId : null,
    surface: normalizeUsageSurface(c.req.query('surface')),
    model: c.req.query('model') ?? null,
    question,
    answer,
  });
  c.executionCtx.waitUntil(saving);
  // `costBasis` is the ledger's input, not the client's business.
  const { costBasis: _costBasis, ...publicAnswer } = answer;
  return json({ answer: publicAnswer });
}

/** Write-through a (question → answer) pair to the Q&A cache so the next exact repeat
 *  short-circuits (no LLM). Best-effort — never fails the caller's reply. */
async function cacheAnswerCore(env: Env, db: Db, tenantId: number, projectId: number, c: Context): Promise<Response> {
  if (!(await projectInTenantCached(env, db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const body = await parseOptionalBody(c, CacheAnswerBody);
  const question = typeof body.question === 'string' ? body.question : '';
  const answer = typeof body.answer === 'string' ? body.answer : '';
  if (!question.trim() || !answer.trim()) return json({ error: 'question and answer are required' }, 400);
  await cacheProjectAnswer(
    env, db, tenantId, projectId, question, answer,
    body.origin ?? null,
    parseFactFileAnchors(body.fileAnchors),
    cloudExecutionIdFromRequest((name) => c.req.header(name)),
  );
  return json({ ok: true });
}

// ── ONE router, two front doors (JWT at /api/projects, host key at /api/agent/projects) ──
export function createProjectFactsRoutes(db: Db, door: FrontDoor = tenantDoor): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  // Scoped to this surface's own paths: a catch-all `use('*')` would also gate every
  // other router sharing the mount (run-context accepts JWT on the agent prefix too).
  for (const path of ['/:projectId/facts', '/:projectId/facts/*', '/:projectId/answer']) router.use(path, door.auth);
  const t = (c: Context) => c.get('tenantId') as number;
  // A host key acts for the agent host, not a person: no user to attribute savings to.
  const person = (c: Context) => (door.agentHost ? null : (c.get('userId') as string | undefined) ?? null);

  router.get('/:projectId/facts', (c) => recallCore(c.env as Env, db, t(c), pid(c), c));
  router.post('/:projectId/facts', (c) => rememberCore(c.env as Env, db, t(c), pid(c), c));
  router.delete('/:projectId/facts/:key', (c) => forgetCore(c.env as Env, db, t(c), pid(c), c));
  // Memory-first: resolve an answer from memory (skip the LLM) / cache a Q&A pair.
  router.get('/:projectId/answer', (c) => resolveAnswerCore(c.env as Env, db, t(c), pid(c), c, person(c)));
  router.post('/:projectId/answer', (c) => cacheAnswerCore(c.env as Env, db, t(c), pid(c), c));
  return router;
}

/**
 * Project knowledge routes — the knowledge graph API (PRD 38 §4.8). Served through the same
 * two front doors as project facts: people and VS Code with a tenant JWT under
 * `/api/projects`, on-prem agents with their host key under `/api/agent/projects`.
 *
 *   GET  /:projectId/knowledge/scopes                       reviewed roots (cached)
 *   GET  /:projectId/knowledge/facts?root=                  the root's stored facts with author +
 *                                                           origin (cached), and the viewer
 *   GET  /:projectId/knowledge-graph?root=&focus=&maxNodes=&at=
 *                                                           server-built graph (cached); `at` =
 *                                                           a past review digest (Compare's baseline)
 *   POST /:projectId/knowledge/write                        the single writer (≤ 500 rows)
 *   GET  /:projectId/knowledge/extracted/:hash              extracted output by content hash
 *   PUT  /:projectId/knowledge/extracted/:hash              … upload (≤ 1 MB)
 *   PUT  /:projectId/code-analysis/:sha?root=               code-pack analyzer snapshot (≤ 2 MB), stored per root
 *                                                           and sha (a root's paths are its own)
 *   POST /:projectId/knowledge/judge                        routed, metered model call
 *   GET  /:projectId/knowledge/judge/estimate               ≈ USD of one judged section (cached; no model call)
 *   GET  /:projectId/knowledge/search?root=&q=&k=           knowledge index search
 *
 * Tenancy: the door authenticates (JWT → `resolveMembership`, or the host key) and every
 * handler checks the project is the tenant's (`projectInTenantCached`) before a port is
 * composed. Handlers call application use cases only.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { tenantDoor, type FrontDoor } from '../middleware/frontDoor';
import { personOf } from '../middleware/personOf';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { projectInTenantCached } from '../../application/project/projectOwnership';
import { knowledgePortsFor, type KnowledgePorts } from '../../application/knowledge/knowledgeComposition';
import { getKnowledgeGraph } from '../../application/knowledge/getKnowledgeGraph';
import { listKnowledgeFacts, listKnowledgeScopes } from '../../application/knowledge/listKnowledge';
import { factViewer } from '../../application/knowledge/deleteKnowledgeFact';
import { searchKnowledge } from '../../application/knowledge/knowledgeIndexPort';
import { writeKnowledge } from '../../application/knowledge/writeKnowledge';
import { KnowledgeWriteError } from '../../application/knowledge/knowledgeWriteError';
import {
  KNOWLEDGE_HASH_PATTERN, MAX_ANALYSIS_SNAPSHOT_BYTES, MAX_EXTRACTED_BYTES, putAnalysisSnapshot, putExtracted,
} from '../../application/knowledge/knowledgePerception';
import { MAX_JUDGE_ITEMS, judgeKnowledge } from '../../application/knowledge/judgeKnowledge';
import { judgeCostFor } from '../../application/knowledge/judgeCostEstimate';
import { parseBody, z } from './requestBody';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Bytes a write body may take — 500 rows of facts with anchors fit well inside. */
const MAX_WRITE_BYTES = 4 * 1024 * 1024;
const MAX_JUDGE_BYTES = 256 * 1024;
const DEFAULT_SEARCH_K = 10;
/** A review digest (`knowledge_scopes.last_digest` / `previous_digest`): hex, ≤ 64. */
const DIGEST_PATTERN = /^[0-9a-f]{8,64}$/i;
const MAX_SEARCH_K = 50;

// ── Schemas ──────────────────────────────────────────────────────────────────
const zRef = z.string().min(5).max(512).regex(/^(src|ent|fact):/, 'a NodeRef (src: | ent: | fact:)');
/** The origin is admitted as any of the four so the WRITER answers `extracted` (400), not zod. */
const zOrigin = z.enum(['extracted', 'model', 'human', 'agent']);
const zAnchor = z.object({
  path: z.string().min(1).max(1024),
  line: z.number().int().nonnegative().optional(),
  contentHash: z.string().max(128).optional(),
});
const zFact = z.object({
  key: z.string().trim().min(1).max(255),
  content: z.string().trim().min(1).max(20_000),
  source: z.string().max(64).optional(),
  importance: z.number().min(0).max(1).optional(),
  origin: zOrigin.optional(),
  fileAnchors: z.array(zAnchor).max(64).default([]),
});
const zRelation = z.object({
  from: zRef,
  to: zRef,
  kind: z.string().min(1).max(32),
  weight: z.number().finite(),
  origin: zOrigin,
  confidence: z.number().min(0).max(1).optional(),
  sourceHash: z.string().max(64).optional(),
  staleAt: z.string().datetime().nullable().optional(),
});
const zScope = z.object({
  rootId: z.string().min(1).max(512),
  title: z.string().max(255).default(''),
  packs: z.array(z.string().min(1).max(64)).max(16),
  lastDigest: z.string().max(64).optional(),
  lastReviewedAt: z.string().datetime().optional(),
});
const WriteBody = z.object({
  scope: zScope.optional(),
  facts: z.array(zFact).default([]),
  relations: z.array(zRelation).default([]),
  stale: z.array(z.object({ sourceRef: zRef, currentHash: z.string().max(160) })).default([]),
});
const zKNode = z.object({
  ref: zRef, kind: z.string().max(64), label: z.string().max(2048), pack: z.string().max(64),
  partition: z.string().max(128).optional(), area: zRef.optional(), importance: z.number(),
  origin: zOrigin, sourceHash: z.string().max(160).optional(), stale: z.boolean().optional(),
  badges: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});
const zKEdge = z.object({
  from: zRef, to: zRef, kind: z.string().max(32), weight: z.number(), origin: zOrigin,
  confidence: z.number().optional(), verdict: z.enum(['allowed', 'same', 'skips', 'upward']).optional(),
  cycle: z.boolean().optional(),
});
const ExtractedBody = z.array(z.object({
  sourceRef: zRef,
  sourceHash: z.string().max(160),
  nodes: z.array(zKNode),
  edges: z.array(zKEdge),
  keys: z.array(z.object({ ref: zRef, key: z.string().max(512) })),
}));
const AnalysisBody = z.object({
  version: z.literal(1),
  id: z.string().max(200),
  capturedAt: z.string().max(64),
  source: z.object({}).passthrough(),
  tools: z.array(z.object({}).passthrough()),
  nodes: z.array(z.string().max(1024)),
  edges: z.array(z.object({ from: z.string().max(1024), to: z.string().max(1024), circular: z.boolean() })),
  issues: z.array(z.object({}).passthrough()),
}).passthrough();
const JudgeBody = z.object({
  kind: z.enum(['extract', 'compare']),
  items: z.array(z.object({ ref: zRef, text: z.string().max(20_000), sourceHash: z.string().max(160) })).min(1).max(MAX_JUDGE_ITEMS),
});

// ── Helpers ──────────────────────────────────────────────────────────────────
const pid = (c: Context): number => Number(c.req.param('projectId'));

/** Refuses a body over `max` bytes by its declared length (checked again after parsing). */
function declaredTooLarge(c: Context, max: number): boolean {
  const declared = Number(c.req.header('content-length'));
  return Number.isFinite(declared) && declared > max;
}

/** The answer for a write or upload the caller got wrong; anything else is a server fault and rethrows. */
function writeRefusal(error: unknown): Response {
  if (error instanceof KnowledgeWriteError) return json({ error: error.message, code: error.code }, error.status);
  throw error;
}

const tooLarge = (max: number) => json({ error: `request body exceeds ${max} bytes`, code: 'payload_too_large' }, 413);

const byteLength = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

// ── ONE router, two front doors ──────────────────────────────────────────────
export function createProjectKnowledgeRoutes(db: Db, door: FrontDoor = tenantDoor): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  for (const path of ['/:projectId/knowledge/*', '/:projectId/knowledge-graph', '/:projectId/code-analysis/*']) router.use(path, door.auth);

  /** The person acting — null for a host key or another machine token. It decides the
   *  writer's provenance (`human` only from a person), a human fact's author, and the
   *  viewer the facts read reports. */
  const person = (c: Context): string | null => personOf(c, door);

  /** Composes the ports once the project is known to be the tenant's; else the 404. */
  const withPorts = async (c: Context, run: (ports: KnowledgePorts) => Promise<Response>): Promise<Response> => {
    const env = c.env as Env;
    const tenantId = c.get('tenantId') as number;
    const projectId = pid(c);
    if (!Number.isInteger(projectId) || projectId <= 0 || !(await projectInTenantCached(env, db, tenantId, projectId))) {
      return json({ error: 'project not found' }, 404);
    }
    return run(knowledgePortsFor(env, db, tenantId, projectId));
  };

  router.get('/:projectId/knowledge/scopes', (c) => withPorts(c, async (p) => json({ scopes: await listKnowledgeScopes(p.graph) })));

  router.get('/:projectId/knowledge/facts', (c) => withPorts(c, async (p) => {
    const rootId = c.req.query('root')?.trim();
    if (!rootId) return json({ error: 'root is required' }, 400);
    const [facts, viewer] = await Promise.all([
      listKnowledgeFacts(p.graph, rootId),
      factViewer(p.env, { userId: person(c), role: (c.get('role') as string | undefined) ?? null }),
    ]);
    return facts ? json({ facts, viewer }) : json({ error: 'unknown knowledge root' }, 404);
  }));

  router.get('/:projectId/knowledge-graph', (c) => withPorts(c, async (p) => {
    const rootId = c.req.query('root')?.trim();
    if (!rootId) return json({ error: 'root is required' }, 400);
    const at = c.req.query('at')?.trim();
    if (at && !DIGEST_PATTERN.test(at)) return json({ error: 'invalid digest' }, 400);
    const maxNodes = Number(c.req.query('maxNodes'));
    const graph = await getKnowledgeGraph(p.graph, {
      rootId,
      ...(at ? { at } : {}),
      focus: c.req.queries('focus') ?? [],
      ...(Number.isFinite(maxNodes) && maxNodes > 0 ? { maxNodes } : {}),
    });
    return graph ? json({ graph }) : json({ error: 'unknown knowledge root' }, 404);
  }));

  router.post('/:projectId/knowledge/write', (c) => withPorts(c, async (p) => {
    if (declaredTooLarge(c, MAX_WRITE_BYTES)) return tooLarge(MAX_WRITE_BYTES);
    const body = await parseBody(c, WriteBody);
    try {
      const result = await writeKnowledge(
        { env: p.env, db: p.db, tenantId: p.tenantId, projectId: p.projectId, store: p.store, blobs: p.extracted, userId: person(c) },
        body as unknown as Parameters<typeof writeKnowledge>[1],
      );
      return json({ ok: true, ...result });
    } catch (error) {
      return writeRefusal(error);
    }
  }));

  router.get('/:projectId/knowledge/extracted/:hash', (c) => withPorts(c, async (p) => {
    const hash = c.req.param('hash');
    if (!KNOWLEDGE_HASH_PATTERN.test(hash)) return json({ error: 'invalid hash' }, 400);
    const extracted = await p.extracted.get(hash);
    return extracted ? json({ extracted }) : json({ error: 'not found' }, 404);
  }));

  router.put('/:projectId/knowledge/extracted/:hash', (c) => withPorts(c, async (p) => {
    const hash = c.req.param('hash');
    if (!KNOWLEDGE_HASH_PATTERN.test(hash)) return json({ error: 'invalid hash' }, 400);
    if (declaredTooLarge(c, MAX_EXTRACTED_BYTES)) return tooLarge(MAX_EXTRACTED_BYTES);
    const extracted = await parseBody(c, ExtractedBody);
    if (byteLength(extracted) > MAX_EXTRACTED_BYTES) return tooLarge(MAX_EXTRACTED_BYTES);
    try {
      await putExtracted(p, hash, extracted as unknown as Parameters<typeof putExtracted>[2]);
    } catch (error) {
      return writeRefusal(error);
    }
    return json({ ok: true, hash });
  }));

  router.put('/:projectId/code-analysis/:sha', (c) => withPorts(c, async (p) => {
    const sha = c.req.param('sha');
    if (!KNOWLEDGE_HASH_PATTERN.test(sha)) return json({ error: 'invalid sha' }, 400);
    if (declaredTooLarge(c, MAX_ANALYSIS_SNAPSHOT_BYTES)) return tooLarge(MAX_ANALYSIS_SNAPSHOT_BYTES);
    const snapshot = await parseBody(c, AnalysisBody);
    if (byteLength(snapshot) > MAX_ANALYSIS_SNAPSHOT_BYTES) return tooLarge(MAX_ANALYSIS_SNAPSHOT_BYTES);
    const rootId = c.req.query('root')?.trim() || (await p.graph.repo.linked())?.rootId;
    if (!rootId) return json({ error: 'root is required: the project has no linked repository' }, 400);
    await putAnalysisSnapshot(p, sha, rootId, snapshot);
    return json({ ok: true, sha, rootId });
  }));

  router.post('/:projectId/knowledge/judge', (c) => withPorts(c, async (p) => {
    if (declaredTooLarge(c, MAX_JUDGE_BYTES)) return tooLarge(MAX_JUDGE_BYTES);
    const req = await parseBody(c, JudgeBody);
    const result = await judgeKnowledge(
      { env: p.env, tenantId: p.tenantId, projectId: p.projectId, userId: person(c) },
      req as unknown as Parameters<typeof judgeKnowledge>[1],
    );
    return json(result);
  }));

  router.get('/:projectId/knowledge/judge/estimate', (c) => withPorts(c, async (p) => json(await judgeCostFor(p.env, p.tenantId))));

  router.get('/:projectId/knowledge/search', (c) => withPorts(c, async (p) => {
    const rootId = c.req.query('root')?.trim();
    const query = c.req.query('q')?.trim();
    if (!rootId || !query) return json({ error: 'root and q are required' }, 400);
    const kRaw = Number(c.req.query('k'));
    const k = Number.isFinite(kRaw) && kRaw > 0 ? Math.min(MAX_SEARCH_K, Math.floor(kRaw)) : DEFAULT_SEARCH_K;
    const result = await searchKnowledge({ graph: p.graph, index: p.index }, { rootId, query, k });
    return result ? json(result) : json({ error: 'unknown knowledge root' }, 404);
  }));

  return router;
}

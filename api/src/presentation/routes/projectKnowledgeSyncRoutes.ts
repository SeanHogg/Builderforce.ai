/**
 * Pack sync routes (PRD 41 A11), mounted by `createProjectKnowledgeRoutes` on BOTH doors (tenant JWT under
 * `/api/projects`, host key under `/api/agent/projects`) next to the other knowledge routes:
 *
 *   POST /:projectId/knowledge/sync?syncId=&part=&parts=   one BFKP pack (or one part of one) → { generation, digest }
 *   GET  /:projectId/knowledge/sync/manifest?root=         the root digest and the 4,096 bucket digests (BFKP)
 *   GET  /:projectId/knowledge/sync/manifest?root=&view=generation   `{ generation, digest }` only (JSON): the quiet-root probe
 *   POST /:projectId/knowledge/sync/manifest               the leaves of the buckets asked for (BFKP in, BFKP out)
 *   POST /:projectId/knowledge/sync/have                   a BFKP HASH section in, a bitmap of the held hashes out
 *
 * Thin by design: the body is read, its size is checked against the declared length, and the application
 * use case does the rest. 409 `generation_mismatch` / `digest_mismatch`, 413 `pack_too_large` and 422 `bad_pack`
 * are the typed answers a client reacts to.
 */
import type { Context, Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { KPACK_CONTENT_TYPE } from '@seanhogg/builderforce-memory/knowledge/pack';
import type { KnowledgePorts } from '../../application/knowledge/knowledgeComposition';
import { applyKnowledgePack } from '../../application/knowledge/sync/applyKnowledgePack';
import { bucketIdsOf, haveBitmap, manifestGeneration, manifestLeaves, manifestSummary } from '../../application/knowledge/sync/knowledgeSyncManifest';
import { KnowledgeSyncError, MAX_SYNC_BODY_BYTES } from '../../application/knowledge/sync/knowledgeSyncPorts';
import { reportedFallback } from '../../application/observability/caughtErrorReporter';
import { KnowledgeWriteError } from '../../application/knowledge/knowledgeWriteError';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const binary = (bytes: Uint8Array, type: string): Response =>
  new Response(bytes as unknown as BodyInit, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });

export interface SyncRouteHelpers {
  withPorts(c: Context, run: (ports: KnowledgePorts) => Promise<Response>): Promise<Response>;
  /** The person acting, or null for a host key / machine token. */
  person(c: Context): string | null;
}

/** The request body, refused past `MAX_SYNC_BODY_BYTES` by its declared length first and its real length after. */
async function bodyOf(c: Context): Promise<Uint8Array> {
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > MAX_SYNC_BODY_BYTES) {
    throw new KnowledgeSyncError(413, 'payload_too_large', `a pack request is at most ${MAX_SYNC_BODY_BYTES} bytes`);
  }
  // Read as a stream with a running count: a chunked body (no Content-Length) is cut off at the cap, never buffered whole.
  const stream = c.req.raw.body;
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_SYNC_BODY_BYTES) {
      await reader.cancel().catch(reportedFallback(undefined, { source: 'presentation/routes/projectKnowledgeSyncRoutes.ts', operation: 'cancelOversizedBody' }));
      throw new KnowledgeSyncError(413, 'payload_too_large', `a pack request is at most ${MAX_SYNC_BODY_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}

/**
 * Who a request's staged parts belong to: the key id, else the host's machine identity, else the user id — never a bare
 * `machine:` that every caller would share, so two callers' `syncId`s can never meet.
 */
export function stageActorOf(c: Context): string | undefined {
  const keyId = c.get('apiKeyId') as string | number | undefined;
  if (keyId !== undefined && keyId !== null && keyId !== '') return `key:${keyId}`;
  const machine = c.get('machineActor') as { kind?: string; agentHostId?: number | string } | undefined;
  if (machine && machine.agentHostId !== undefined && machine.agentHostId !== null && machine.agentHostId !== '') return `${machine.kind ?? 'machine'}:${machine.agentHostId}`;
  const userId = c.get('userId') as string | number | undefined;
  if (userId !== undefined && userId !== null && userId !== '') return `user:${userId}`;
  return undefined;
}

const intOf =(v: string | undefined): number | undefined => (v === undefined || v === '' ? undefined : Number(v));

/** A typed sync refusal as a response: its status, `{ error, code, …detail }`, and `Retry-After` on a retryable 503. */
export function syncRefusal(error: KnowledgeSyncError): Response {
  const res = json({ error: error.message, code: error.code, ...(error.detail ?? {}) }, error.status);
  if (error.retryAfterSeconds !== undefined) res.headers.set('Retry-After', String(error.retryAfterSeconds));
  return res;
}

/** Runs a sync handler and answers its typed refusals; anything else is a server fault and rethrows. */
async function answering(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof KnowledgeSyncError) return syncRefusal(error);
    // The writer's own refusals (a bad origin, too many rows) are the caller's 4xx, not a server fault.
    if (error instanceof KnowledgeWriteError) return json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
}

export function registerKnowledgeSyncRoutes(router: Hono<HonoEnv>, h: SyncRouteHelpers): void {
  router.post('/:projectId/knowledge/sync', (c) => h.withPorts(c, (p) => answering(async () => {
    const type = c.req.header('content-type') ?? '';
    if (!type.startsWith(KPACK_CONTENT_TYPE)) return json({ error: `send ${KPACK_CONTENT_TYPE}`, code: 'unsupported_media_type' }, 415);
    const syncId = c.req.query('syncId');
    const parts = intOf(c.req.query('parts'));
    const part = intOf(c.req.query('part'));
    const result = await applyKnowledgePack(
      { ...p, userId: h.person(c), actorRole: (c.get('role') as string | undefined) ?? null, stageActor: stageActorOf(c) },
      { body: await bodyOf(c), ...(syncId ? { syncId } : {}), ...(part !== undefined ? { part } : {}), ...(parts !== undefined ? { parts } : {}) },
    );
    return json({ ok: true, ...result });
  })));

  router.get('/:projectId/knowledge/sync/manifest', (c) => h.withPorts(c, (p) => answering(async () => {
    // Trimmed by `normalizeRootId` inside the use case: the pack route, this one and the leaf request read one root the same way.
    const rootId = c.req.query('root');
    if (!rootId?.trim()) return json({ error: 'root is required' }, 400);
    if (c.req.query('view') === 'generation') {
      return new Response(JSON.stringify(await manifestGeneration(p, rootId)), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    return binary(await manifestSummary(p, rootId), KPACK_CONTENT_TYPE);
  })));

  router.post('/:projectId/knowledge/sync/manifest', (c) => h.withPorts(c, (p) => answering(async () => {
    const { rootId, buckets } = await bucketIdsOf(await bodyOf(c));
    return binary(await manifestLeaves(p, rootId, buckets), KPACK_CONTENT_TYPE);
  })));

  router.post('/:projectId/knowledge/sync/have', (c) => h.withPorts(c, (p) => answering(async () =>
    binary(await haveBitmap(p, await bodyOf(c)), 'application/octet-stream'))));
}

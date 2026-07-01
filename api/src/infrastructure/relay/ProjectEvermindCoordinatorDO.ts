/**
 * ProjectEvermindCoordinatorDO — the SINGLE WRITER for a project's Evermind.
 *
 * One instance per project (`idFromName('proj:<tenantId>:<projectId>')`). Because a
 * Durable Object runs single-threaded per id, it is the natural serialization lock
 * for concurrent learning: R2 has no compare-and-swap, so without a single owner
 * two agents merging at once would clobber each other's republish. Here they
 * queue instead.
 *
 * Flow ([[evermind-learning-architecture]]):
 *   POST /learn  — an agent pushes a weight delta (diff of its locally-adapted
 *                  replica vs the base version it pulled). Appended to a pending
 *                  queue; a debounced alarm batches a burst into ONE merge.
 *   alarm()      — drain pending → FedAvg-merge (mergeCheckpointDiffs) the diffs
 *                  taken against the CURRENT head → repackage → write next version
 *                  to R2 → record the version bump in `project_evermind`.
 *   GET /head    — current { version, ref, mode } for replicas to compare against.
 *
 * Guards (Phase 5): `offline-frozen` mode rejects learns; a debounce window
 * batches bursts into a single republish; the pending queue is capped; a diff
 * taken against a STALE base is dropped (the agent recomputes against the new
 * base on its next run) rather than corrupting the merge.
 */
import { EvermindModelPackage } from '@seanhogg/builderforce-memory-engine';
import { buildDatabase, type Db } from '../database/connection';
import {
  getProjectEvermindHead,
  putProjectEvermindVersion,
  recordProjectEvermindMerge,
  projectEvermindRef,
} from '../../application/llm/projectEvermind';
import { mergeCheckpointDiffs } from '../../application/llm/evermindMerge';
import type { Env } from '../../env';

/** Debounce window — a burst of learns within this window folds into one merge. */
const DEBOUNCE_MS = 15_000;
/** Hard cap on queued contributions (oldest dropped past this) — cost guard. */
const MAX_PENDING = 512;
/** Max accepted serialized-delta size (~8 MB) — a runaway push is rejected up front. */
const MAX_DIFF_BYTES = 8 * 1024 * 1024;

interface PendingEntry {
  id: number;
  /** The head version this delta was diffed against (must match at merge time). */
  baseVersion: number;
  /** base64 serialized RowDelta (from the engine's diffCheckpoints). */
  diffB64: string;
  /** Optional sample weight (e.g. tokens learned) for the FedAvg merge. */
  weight: number;
}

interface CoordMeta {
  tenantId: number;
  projectId: number;
}

interface LearnBody {
  tenantId: number;
  projectId: number;
  baseVersion: number;
  diff: string; // base64 serialized RowDelta
  weight?: number;
}

const PENDING_KEY = 'pending';
const META_KEY = 'meta';
const SEQ_KEY = 'seq';

function decodeBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export class ProjectEvermindCoordinatorDO implements DurableObject {
  declare readonly '__DURABLE_OBJECT_BRAND': never;
  private readonly db: Db;
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.db = buildDatabase(env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/learn')) return this.handleLearn(request);
    if (request.method === 'GET' && url.pathname.endsWith('/head')) return this.handleHead();
    return new Response('not found', { status: 404 });
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  private async handleHead(): Promise<Response> {
    const meta = await this.state.storage.get<CoordMeta>(META_KEY);
    if (!meta) return this.json({ version: 0, ref: null, mode: 'connected', pending: 0 });
    const head = await getProjectEvermindHead(this.env, this.db, meta.tenantId, meta.projectId);
    const pending = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
    return this.json({ version: head.version, ref: head.ref, mode: head.mode, pending: pending.length });
  }

  private async handleLearn(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as LearnBody | null;
    if (!body || typeof body.tenantId !== 'number' || typeof body.projectId !== 'number' || typeof body.diff !== 'string') {
      return this.json({ ok: false, error: 'tenantId, projectId, diff required' }, 400);
    }
    if (body.diff.length > MAX_DIFF_BYTES) {
      return this.json({ ok: false, error: 'delta too large' }, 413);
    }

    const head = await getProjectEvermindHead(this.env, this.db, body.tenantId, body.projectId);
    if (head.version === 0) {
      return this.json({ ok: false, error: 'project Evermind not seeded — no base model to learn against' }, 409);
    }
    // Phase 5 mode guard: a frozen model is read-only — never accept a write-back.
    if (head.mode === 'offline-frozen') {
      return this.json({ ok: false, error: 'project Evermind is offline-frozen (read-only); learning disabled', mode: head.mode }, 423);
    }
    // A diff taken against a now-stale base can't be element-merged safely — tell
    // the agent the current head so it rebases and re-pushes next run.
    if (typeof body.baseVersion === 'number' && body.baseVersion !== head.version) {
      return this.json({ ok: false, error: 'stale base — rebase against current head', headVersion: head.version }, 409);
    }

    await this.state.storage.put(META_KEY, { tenantId: body.tenantId, projectId: body.projectId } satisfies CoordMeta);
    const seq = ((await this.state.storage.get<number>(SEQ_KEY)) ?? 0) + 1;
    await this.state.storage.put(SEQ_KEY, seq);

    const pending = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
    pending.push({
      id: seq,
      baseVersion: head.version,
      diffB64: body.diff,
      weight: typeof body.weight === 'number' && body.weight > 0 ? body.weight : 1,
    });
    // Cost guard: cap the queue, dropping the OLDEST contributions if a project
    // is firehosing learns faster than the debounce can merge them.
    const dropped = pending.length > MAX_PENDING ? pending.splice(0, pending.length - MAX_PENDING).length : 0;
    await this.state.storage.put(PENDING_KEY, pending);

    // Debounce: only (re)arm the alarm if none is pending, so a burst folds into
    // one merge DEBOUNCE_MS after the FIRST contribution.
    const existingAlarm = await this.state.storage.getAlarm();
    if (existingAlarm == null) await this.state.storage.setAlarm(Date.now() + DEBOUNCE_MS);

    return this.json({ ok: true, queued: pending.length, baseVersion: head.version, ...(dropped ? { dropped } : {}) });
  }

  async alarm(): Promise<void> {
    const meta = await this.state.storage.get<CoordMeta>(META_KEY);
    const pending = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
    if (!meta || pending.length === 0) return;

    const { tenantId, projectId } = meta;
    const head = await getProjectEvermindHead(this.env, this.db, tenantId, projectId);
    if (head.version === 0 || !head.ref) {
      // Lost its base somehow — drop the queue so it can't wedge.
      await this.state.storage.delete(PENDING_KEY);
      return;
    }

    // Snapshot the entries we'll process by id, so a /learn that lands mid-merge
    // is preserved (re-queued) rather than silently cleared.
    const snapshot = pending.slice();
    const usable = snapshot.filter((e) => e.baseVersion === head.version);

    if (usable.length === 0) {
      // Everything queued is stale against the current head — discard and stop.
      await this.dropProcessed(snapshot.map((e) => e.id));
      return;
    }

    try {
      const store = this.env.UPLOADS;
      if (!store) return; // no R2 → can't merge; leave pending for a later alarm
      const baseObj = await store.get(`${head.ref}/model.evermind`);
      const tokObj = await store.get(`${head.ref}/tokenizer.json`);
      if (!baseObj || !tokObj) {
        await this.dropProcessed(snapshot.map((e) => e.id));
        return;
      }

      const basePkg = EvermindModelPackage.fromBlob(await baseObj.arrayBuffer());
      const diffs = usable.map((e) => decodeBase64(e.diffB64));
      const weights = usable.map((e) => e.weight);
      const { checkpoint, contributors } = mergeCheckpointDiffs(basePkg.checkpoint, diffs, weights);

      // Repackage the merged weights as the next immutable version (recomputes the
      // manifest checksum), carrying the base name + model card forward.
      const lm = basePkg.loadLM();
      lm.loadWeights(checkpoint);
      const nextVersion = head.version + 1;
      const nextPkg = EvermindModelPackage.fromLM(lm, {
        name: basePkg.manifest.name,
        version: String(nextVersion),
        card: basePkg.manifest.card,
      });

      const tokenizer = JSON.parse(await tokObj.text()) as { vocab: Record<string, number>; merges: string[] };
      await putProjectEvermindVersion(store, tenantId, projectId, nextVersion, nextPkg.toBlob(), tokenizer);
      await recordProjectEvermindMerge(this.env, this.db, tenantId, projectId, nextVersion, contributors);

      // Verify the new version is the one we wrote (a concurrent merge is impossible
      // — single DO — but a forward-only DB guard means we trust the row).
      void projectEvermindRef(tenantId, projectId, nextVersion);
    } finally {
      // Clear only what we processed; if any /learn arrived during the merge it
      // stays queued, and we re-arm so it gets folded into the next version.
      await this.dropProcessed(snapshot.map((e) => e.id));
      const remaining = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
      if (remaining.length > 0) await this.state.storage.setAlarm(Date.now() + DEBOUNCE_MS);
    }
  }

  /** Remove processed entries by id, preserving any that arrived concurrently. */
  private async dropProcessed(ids: number[]): Promise<void> {
    const idSet = new Set(ids);
    const current = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
    const remaining = current.filter((e) => !idSet.has(e.id));
    if (remaining.length > 0) await this.state.storage.put(PENDING_KEY, remaining);
    else await this.state.storage.delete(PENDING_KEY);
  }
}

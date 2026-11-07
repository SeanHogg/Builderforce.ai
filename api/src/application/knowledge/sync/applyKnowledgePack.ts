/**
 * applyKnowledgePack — `POST …/knowledge/sync` (PRD 41 A11 rules 3-4a): one BFKP pack in, the root's rows brought
 * to the pack's state, `{ generation, digest }` out.
 *
 * Guards, before any row is touched: compressed body ≤ 8 MB; parts staged by `syncId` (expire in 1 h) and applied
 * only when the last arrives; the shared codec checks the magic, the CRC-32, the 64 MB inflate cap and the
 * string/row counts (413 `pack_too_large`, 422 `bad_pack`); the pack's `baseGeneration` must be 0 (a full pack) or
 * the root's current generation (else 409 `generation_mismatch`); every file whose body the pack leaves out must
 * be held already (ONE index query, else 409 `extracted_missing`).
 *
 * Storage is bounded per pack, not per file:
 *   objects   the pack's bodies are ONE content-addressed bundle (written before the transaction); the only other
 *             writes are the earlier parts, `sync.json`, and one review snapshot when the scope records a new digest.
 *   rows      ONE Postgres transaction holds the bundle index, the source rows, relation stale marks, facts (the
 *             shared multi-row fact writer, via `writeKnowledge`), relations, tombstones and the scope.
 *   digest    inside the transaction the server recomputes the root digest with the codec's `manifestTree`; unequal to
 *             the pack's `targetDigest` throws, the transaction rolls back and the answer is 409 `digest_mismatch`.
 *             An orphan bundle left behind is harmless (content-addressed) and swept by age.
 */
import { joinParts, applyEntryDiffs, ZERO_DIGEST, type Pack, type PackExtr } from '@seanhogg/builderforce-memory/knowledge/pack';
import { srcRef, type Extracted } from '@seanhogg/builderforce-memory/knowledge';
import { inTransaction, type Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import type { ExtractedCachePort, KnowledgeStorePort } from '../knowledgePorts';
import { KNOWLEDGE_HASH_PATTERN, MAX_ANALYSIS_SNAPSHOT_BYTES, putAnalysisSnapshot } from '../knowledgePerception';
import { clampExtracted, sanitizeExtracted } from '../knowledgePrivacy';
import { bumpKnowledgeVersion } from '../knowledgeVersion';
import { deleteKnowledgeFact } from '../deleteKnowledgeFact';
import { sourceId } from '../knowledgeBlobs';
import { buildBundle } from '../knowledgeBundles';
import { drizzleLedger, type KnowledgeLedgerPort, type SourceRow } from '../knowledgeLedger';
import { drizzleKnowledgeStore } from '../knowledgeStore';
import { MAX_KNOWLEDGE_WRITE_ROWS, writeKnowledge, type KnowledgeFactInput } from '../writeKnowledge';
import { decodeGuarded } from './decodeGuarded';
import { KnowledgeSyncError, MAX_SYNC_BODY_BYTES, MAX_SYNC_PARTS, SYNC_ID_PATTERN, type KnowledgeSyncPort } from './knowledgeSyncPorts';
import { serverManifest } from './knowledgeSyncManifest';

/** What one transaction writes through: the store and the ledger bound to the SAME handle. */
export interface PackUnit {
  db: Db;
  store: KnowledgeStorePort;
  ledger: KnowledgeLedgerPort;
}

export interface ApplyDeps {
  env: Env;
  db: Db;
  tenantId: number;
  projectId: number;
  store: KnowledgeStorePort;
  extracted: ExtractedCachePort;
  sync: KnowledgeSyncPort;
  userId: string | null;
  actorRole: string | null;
  /** Runs `work` as ONE transaction (default: a Postgres transaction over `db`). A test seam. */
  atomically?: <T>(work: (unit: PackUnit) => Promise<T>) => Promise<T>;
}

export interface ApplyInput {
  body: Uint8Array;
  /** Present on every part of a multi-part pack. */
  syncId?: string;
  part?: number;
  parts?: number;
}

export type ApplyResult =
  | { applied: false; syncId: string; received: number; parts: number }
  | { applied: true; generation: number; digest: string; files: number; extracted: number; facts: number; relations: number; deleted: number };

const CONCURRENCY = 8;

async function mapBounded<T>(items: readonly T[], n: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => { while (next < items.length) await work(items[next++]!); };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane));
}

const defaultAtomically = (deps: ApplyDeps): NonNullable<ApplyDeps['atomically']> => (work) =>
  inTransaction(deps.db, (tx) => {
    const db = tx as unknown as Db;
    return work({ db, store: drizzleKnowledgeStore(db, deps.tenantId, deps.projectId), ledger: drizzleLedger(db, deps.tenantId, deps.projectId) });
  });

/**
 * Parks an earlier part; returns the whole pack's bytes once the last part arrived. The LAST part is never staged:
 * it rides this request, so a pack of N parts costs N-1 staging writes.
 */
async function assemble(deps: ApplyDeps, input: ApplyInput): Promise<Uint8Array | { staged: ApplyResult }> {
  const { syncId, part, parts } = input;
  if (!parts || parts <= 1) return input.body;
  if (!syncId || !SYNC_ID_PATTERN.test(syncId) || part === undefined || !Number.isInteger(part) || !Number.isInteger(parts)
    || part < 0 || part >= parts || parts > MAX_SYNC_PARTS) {
    throw new KnowledgeSyncError(400, 'bad_parts', 'a multi-part pack names a syncId, a part within 0..parts-1 and at most 64 parts');
  }
  await deps.sync.sweepStaged().catch(() => undefined);
  if (part !== parts - 1) {
    await deps.sync.stagePart(syncId, part, input.body);
    return { staged: { applied: false, syncId, received: part + 1, parts } };
  }
  const earlier = parts > 1 ? await deps.sync.stagedParts(syncId, parts - 1) : [];
  if (!earlier) throw new KnowledgeSyncError(409, 'parts_missing', 'a part of this pack is missing or expired; send the pack again', { syncId });
  return joinParts([...earlier, input.body]);
}

/**
 * A file whose body the client skipped (the project already held that hash) must still be named by the stored body:
 * the body is per hash, its entries per source. ONE index query answers it for every such file; any that fails is a
 * 409 `extracted_missing` naming the hashes, and the client sends those bodies. Checked BEFORE anything is written.
 */
async function verifyBodies(deps: ApplyDeps, pack: Pack): Promise<void> {
  const shipped = new Set((pack.extracted ?? []).map((x) => x.hash));
  const owed = (pack.files ?? []).filter((f) => !shipped.has(f.hash));
  if (owed.length === 0) return;
  const held = await deps.sync.heldBodies([...new Set(owed.map((f) => f.hash))]);
  const missing = new Set<string>();
  for (const f of owed) if (!held.get(f.hash)?.includes(srcRef(pack.rootId, f.path))) missing.add(f.hash);
  if (missing.size > 0) throw new KnowledgeSyncError(409, 'extracted_missing', 'the server lacks the extracted output of some files; send those bodies', { hashes: [...missing] });
}

async function expand(deps: ApplyDeps, x: PackExtr): Promise<Extracted[]> {
  if (x.kind === 'full') return x.entries;
  const prior = await deps.extracted.get(x.prior);
  if (!prior) throw new KnowledgeSyncError(409, 'prior_missing', `the server does not hold the prior extraction ${x.prior}`, { prior: x.prior });
  try {
    return applyEntryDiffs(prior, x.entries);
  } catch (error) {
    throw new KnowledgeSyncError(409, 'prior_missing', error instanceof Error ? error.message : 'the prior extraction does not fit', { prior: x.prior });
  }
}

/** One body as it is stored: the hash it claims, one line per label, no ref over the graph's bound (see `putExtracted`). */
function storable(hash: string, entries: readonly Extracted[]): Extracted[] {
  const stray = entries.find((e) => e.sourceHash !== hash);
  if (stray) throw new KnowledgeSyncError(422, 'bad_pack', `extracted output for ${stray.sourceRef} is at hash '${stray.sourceHash}', not the '${hash}' it was sent under`);
  return clampExtracted(sanitizeExtracted(entries).entries);
}

interface SourcePlan {
  upsert: SourceRow[];
  remove: string[];
  stale: Array<{ sourceRef: `src:${string}`; currentHash: string }>;
  /** The root's sources after the pack. */
  after: Array<{ path: string; hash: string }>;
}

function planSources(pack: Pack, heldNow: ReadonlyArray<{ path: string; hash: string }>): SourcePlan {
  const held = new Map(heldNow.map((s) => [sourceId(s.path, s.hash), s] as const));
  const plan: SourcePlan = { upsert: [], remove: [], stale: [], after: [] };
  const after = new Map(held);
  const prefix = `src:${pack.rootId}::`;
  const rows = new Map<string, SourceRow>();
  for (const f of pack.files ?? []) rows.set(sourceId(f.path, f.hash), { sourceId: sourceId(f.path, f.hash), path: f.path, hash: f.hash });
  for (const s of pack.stale ?? []) {
    if (s.sourceRef.startsWith(prefix) && s.hash) rows.set(s.sourceRef.slice(prefix.length), { sourceId: s.sourceRef.slice(prefix.length), path: s.sourceRef.slice(prefix.length), hash: s.hash });
  }
  for (const row of rows.values()) {
    const before = held.get(row.sourceId);
    if (before?.hash === row.hash) continue;
    plan.upsert.push(row);
    after.set(row.sourceId, { path: row.path, hash: row.hash });
    // A source that changed from a known hash makes its model relations stale; one new to the root has none to mark.
    // (A plain path's id is the path; the held entry under that id carries the hash it changed from.)
    if (before && !row.hash.startsWith('~')) plan.stale.push({ sourceRef: srcRef(pack.rootId, row.path) as `src:${string}`, currentHash: row.hash });
  }
  for (const id of pack.deletes?.files ?? []) {
    const before = held.get(id);
    plan.remove.push(id);
    after.delete(id);
    if (before && !id.startsWith('~')) plan.stale.push({ sourceRef: srcRef(pack.rootId, id) as `src:${string}`, currentHash: '' });
  }
  plan.after = [...after.values()];
  return plan;
}

async function applyAnalysis(deps: ApplyDeps, pack: Pack): Promise<void> {
  const a = pack.analysis as { sha?: unknown; snapshot?: unknown } | undefined;
  if (!a || typeof a.sha !== 'string' || !KNOWLEDGE_HASH_PATTERN.test(a.sha) || a.snapshot == null) return;
  if (JSON.stringify(a.snapshot).length > MAX_ANALYSIS_SNAPSHOT_BYTES) throw new KnowledgeSyncError(413, 'payload_too_large', 'the analysis snapshot is over 2 MB');
  await putAnalysisSnapshot(deps, a.sha, pack.rootId, a.snapshot);
}

/** Facts, relations and the scope, through the single writer, on the transaction's handle. */
async function writeRows(deps: ApplyDeps, unit: PackUnit, pack: Pack): Promise<{ facts: number; relations: number }> {
  const root = pack.rootId;
  // The pack already wrote the sources and the review snapshot; the writer only writes rows here.
  const blobs: ExtractedCachePort = { ...deps.extracted, setSource: async () => undefined, snapshotReview: async () => undefined };
  const write = (rows: Parameters<typeof writeKnowledge>[1]) => writeKnowledge(
    { env: deps.env, db: unit.db, tenantId: deps.tenantId, projectId: deps.projectId, store: unit.store, blobs, userId: deps.userId, actorRole: deps.actorRole, embedFacts: false, skipVersionBump: true },
    { root, ...rows },
  );
  const facts = (pack.facts ?? []) as KnowledgeFactInput[];
  const relations = pack.relations ?? [];
  const written = { facts: 0, relations: 0 };
  // Facts first, then relations: a relation to a fact never lands before the fact.
  for (let i = 0; i < facts.length; i += MAX_KNOWLEDGE_WRITE_ROWS) written.facts += (await write({ facts: facts.slice(i, i + MAX_KNOWLEDGE_WRITE_ROWS) })).factsWritten;
  for (let i = 0; i < relations.length; i += MAX_KNOWLEDGE_WRITE_ROWS) written.relations += (await write({ relations: relations.slice(i, i + MAX_KNOWLEDGE_WRITE_ROWS) })).relationsWritten;
  if (pack.scope) await write({ scope: pack.scope });
  return written;
}

async function applyTombstones(deps: ApplyDeps, unit: PackUnit, pack: Pack): Promise<number> {
  const d = pack.deletes;
  if (!d) return 0;
  let removed = 0;
  if (d.relations.length > 0) {
    // A person's edge is only removed by a person.
    const human = deps.userId ? new Set<string>() : await unit.store.humanRelationKeys(d.relations);
    removed += await unit.store.deleteRelationRows(d.relations.filter((r) => !human.has(`${r.from}\u0000${r.to}\u0000${r.kind}`)));
  }
  for (const key of d.facts) {
    const r = await deleteKnowledgeFact({ env: deps.env, db: unit.db, tenantId: deps.tenantId, projectId: deps.projectId, store: unit.store }, { userId: deps.userId, role: deps.actorRole }, key);
    if (r.ok && r.removed) removed += 1;
  }
  return removed;
}

export async function applyKnowledgePack(deps: ApplyDeps, input: ApplyInput): Promise<ApplyResult> {
  if (input.body.length > MAX_SYNC_BODY_BYTES) throw new KnowledgeSyncError(413, 'payload_too_large', `a pack request is at most ${MAX_SYNC_BODY_BYTES} bytes`);
  const assembled = await assemble(deps, input);
  if (!(assembled instanceof Uint8Array)) return assembled.staged;
  try {
    const pack = await decodeGuarded(assembled);
    const root = pack.rootId;
    const state = await deps.sync.state(root);
    if (pack.baseGeneration !== 0 && pack.baseGeneration !== state.generation) {
      throw new KnowledgeSyncError(409, 'generation_mismatch', 'the server moved since this pack was built', { generation: state.generation, digest: state.digest });
    }
    await verifyBodies(deps, pack);

    // Everything that reads or writes OBJECTS happens here, before the transaction: the bodies as one bundle, and
    // the review snapshot (never recorded after the scope row that names its digest).
    const extracted = pack.extracted ?? [];
    const bodies: Array<{ hash: string; entries: Extracted[] }> = [];
    await mapBounded(extracted, CONCURRENCY, async (x) => { bodies.push({ hash: x.hash, entries: storable(x.hash, await expand(deps, x)) }); });
    bodies.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
    const bundle = bodies.length > 0 ? buildBundle(deps.tenantId, bodies) : undefined;
    const plan = planSources(pack, await deps.sync.sources(root));
    if (pack.scope?.lastDigest) await deps.sync.snapshotReview(root, pack.scope.lastDigest, plan.after);
    if (bundle) await deps.sync.putBundle(bundle);

    const atomically = deps.atomically ?? defaultAtomically(deps);
    const done = await atomically(async (unit) => {
      if (bundle) await unit.ledger.index.upsert(bundle.locs);
      await unit.ledger.sources.upsert(root, plan.upsert);
      await unit.ledger.sources.remove(root, plan.remove);
      if (plan.stale.length > 0) await unit.store.markRelationsStaleMany(plan.stale);
      const written = await writeRows(deps, unit, pack);
      const deleted = await applyTombstones(deps, unit, pack);
      // The digest is checked INSIDE the transaction: a mismatch throws and nothing above is kept.
      const { tree } = await serverManifest({ store: unit.store, sync: deps.sync }, root, unit.ledger);
      if (pack.targetDigest !== ZERO_DIGEST && tree.root !== pack.targetDigest) {
        throw new KnowledgeSyncError(409, 'digest_mismatch', 'the server did not reach the pack’s digest; reconcile', { generation: state.generation, digest: tree.root });
      }
      return { written, deleted, digest: tree.root };
    });

    const next = { generation: state.generation + 1, digest: done.digest };
    await deps.sync.saveState(root, next);
    await bumpKnowledgeVersion(deps.env, deps.tenantId, deps.projectId);
    await applyAnalysis(deps, pack);
    return { applied: true, ...next, files: plan.upsert.length + plan.remove.length, extracted: bodies.length, facts: done.written.facts, relations: done.written.relations, deleted: done.deleted };
  } finally {
    if (input.syncId && (input.parts ?? 1) > 1) await deps.sync.dropStaged(input.syncId).catch(() => undefined);
  }
}

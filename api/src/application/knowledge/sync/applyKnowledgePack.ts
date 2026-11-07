/**
 * applyKnowledgePack — `POST …/knowledge/sync` (PRD 41 A11 rules 3-4b): one BFKP pack in, the root's rows brought
 * to the pack's state, `{ generation, digest }` out.
 *
 * Refused before any row or object is written: a body over 8 MB; more than 8 parts, or parts adding up past 64 MB
 * (summed as they load); a wrong generation (read from the FRAME, before any inflation); a frame that is
 * malformed, fails its CRC (header and body) or inflates past the codec's caps (413 / 422); rows the writer cannot
 * take (ids, lengths, duplicates, non-model rows: `packValidation`); an unauthorised pack root; an oversized
 * analysis; a skipped body the project does not really hold (409 `extracted_missing`).
 *
 * Storage is bounded per pack, not per file: the bodies are ONE content-addressed bundle object (merged with what is
 * stored, by `sourceRef`); then ONE Postgres transaction holds the bundle index, source rows, relation stale marks,
 * facts (the shared multi-row writer), relations, tombstones, the root's LEAVES and its generation.
 *
 * The root's manifest is its leaves (`knowledge_sync_leaves`), never the shared fact and relation tables. Inside the
 * transaction the digest of those leaves is checked against the pack's `targetDigest` (409 `digest_mismatch`), and
 * the generation is advanced with a conditional UPDATE (409 `generation_mismatch` for the loser of a race); either
 * throws and everything rolls back. A tombstone must name a leaf of THIS root (422 `not_owned`); it always removes the
 * leaf, and deletes the fact or relation row only when no other root's leaves name it and the author rule allows —
 * what is kept is reported in `skipped`, never silently. Objects that must not live inside the transaction (the
 * review snapshot, legacy source deletes, the analysis) are written after it commits.
 */
import { fileLeafKey, factDigest, factLeafKey, manifestTree, relationDigest, relationLeafKey, ZERO_DIGEST, joinParts, type Pack } from '@seanhogg/builderforce-memory/knowledge/pack';
import { srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { isPackRootId } from '@builderforce/agent-tools';
import { inTransaction, type Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import type { ExtractedCachePort, KnowledgeStorePort } from '../knowledgePorts';
import { KNOWLEDGE_HASH_PATTERN, MAX_ANALYSIS_SNAPSHOT_BYTES, putAnalysisSnapshot } from '../knowledgePerception';
import { bumpKnowledgeVersion } from '../knowledgeVersion';
import { factViewer } from '../deleteKnowledgeFact';
import { authorizePackUpload } from '../packAccess';
import { sourceId } from '../knowledgeBlobs';
import { buildBundle } from '../knowledgeBundles';
import { drizzleLedger, type KnowledgeLedgerPort, type LeafRow, type SourceRow } from '../knowledgeLedger';
import { drizzleKnowledgeStore } from '../knowledgeStore';
import { MAX_KNOWLEDGE_WRITE_ROWS, writeKnowledge, type KnowledgeFactInput } from '../writeKnowledge';
import { decodeGuarded, peekGuarded } from './decodeGuarded';
import { KnowledgeSyncError, MAX_PACK_BYTES, MAX_SYNC_BODY_BYTES, MAX_SYNC_PARTS, SYNC_ID_PATTERN, type KnowledgeSyncPort } from './knowledgeSyncPorts';
import { buildBodies } from './packBodies';
import { MAX_ROOT_ID, tombstoneKeys, validatePack } from './packValidation';

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

/** A tombstone whose leaf was removed but whose row was kept, and why. */
export interface SkippedTombstone { key: string; reason: 'other_root' | 'not_permitted' }

export type ApplyResult =
  | { applied: false; syncId: string; received: number; parts: number }
  | { applied: true; generation: number; digest: string; files: number; extracted: number; facts: number; relations: number; deleted: number; skipped: SkippedTombstone[] };

const defaultAtomically = (deps: ApplyDeps): NonNullable<ApplyDeps['atomically']> => (work) =>
  inTransaction(deps.db, (tx) => {
    const db = tx as unknown as Db;
    return work({ db, store: drizzleKnowledgeStore(db, deps.tenantId, deps.projectId), ledger: drizzleLedger(db, deps.tenantId, deps.projectId) });
  });

const actorOf = (deps: ApplyDeps): string => deps.userId ?? 'machine';

/**
 * Parks an earlier part; returns the whole pack's bytes once the last part arrived. The LAST part is never staged:
 * it rides this request, so a pack of N parts costs N-1 staging writes. The parts' sizes are summed as they load.
 */
async function assemble(deps: ApplyDeps, input: ApplyInput): Promise<Uint8Array | { staged: ApplyResult }> {
  const { syncId, part, parts } = input;
  if (!parts || parts <= 1) return input.body;
  if (!syncId || !SYNC_ID_PATTERN.test(syncId) || part === undefined || !Number.isInteger(part) || !Number.isInteger(parts)
    || part < 0 || part >= parts || parts > MAX_SYNC_PARTS) {
    throw new KnowledgeSyncError(400, 'bad_parts', `a multi-part pack names a syncId, a part within 0..parts-1 and at most ${MAX_SYNC_PARTS} parts`);
  }
  await deps.sync.sweepStaged().catch(() => undefined);
  if (part !== parts - 1) {
    await deps.sync.stagePart(actorOf(deps), syncId, part, input.body);
    return { staged: { applied: false, syncId, received: part + 1, parts } };
  }
  const earlier = await deps.sync.stagedParts(actorOf(deps), syncId, parts - 1, MAX_PACK_BYTES - input.body.length);
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

interface SourcePlan {
  upsert: SourceRow[];
  remove: string[];
  stale: Array<{ sourceRef: `src:${string}`; currentHash: string }>;
  /** The root's sources after the pack. */
  after: Array<{ path: string; hash: string }>;
}

function planSources(pack: Pack, heldNow: ReadonlyArray<{ path: string; hash: string }>): SourcePlan {
  const held = new Map(heldNow.map((s) => [sourceId(s.path, s.hash), s] as const));
  const after = new Map(held);
  const plan: SourcePlan = { upsert: [], remove: [], stale: [], after: [] };
  for (const f of pack.files ?? []) {
    const id = sourceId(f.path, f.hash);
    const before = held.get(id);
    if (before?.hash === f.hash) continue;
    plan.upsert.push({ sourceId: id, path: f.path, hash: f.hash });
    after.set(id, { path: f.path, hash: f.hash });
    // A source that changed from a known hash makes its model relations stale; one new to the root has none to mark.
    if (before && !f.hash.startsWith('~')) plan.stale.push({ sourceRef: srcRef(pack.rootId, f.path) as `src:${string}`, currentHash: f.hash });
  }
  for (const id of new Set(pack.deletes?.files ?? [])) {
    const before = held.get(id);
    plan.remove.push(id);
    after.delete(id);
    if (before && !id.startsWith('~')) plan.stale.push({ sourceRef: srcRef(pack.rootId, id) as `src:${string}`, currentHash: '' });
  }
  plan.after = [...after.values()];
  return plan;
}

/** The leaves a pack sets: the digests of its own rows, by the codec's functions, so they are the client's digests. */
function leavesOf(pack: Pack): LeafRow[] {
  return [
    ...(pack.files ?? []).map((f) => ({ key: fileLeafKey(f.path, f.hash), digest: f.hash })),
    ...(pack.facts ?? []).map((f) => ({ key: factLeafKey(f.key), digest: factDigest(f) })),
    ...(pack.relations ?? []).map((r) => ({ key: relationLeafKey(r), digest: relationDigest(r) })),
  ];
}

/** Facts, relations and the scope, through the single writer, on the transaction's handle. */
async function writeRows(deps: ApplyDeps, unit: PackUnit, pack: Pack): Promise<{ facts: number; relations: number }> {
  const root = pack.rootId;
  // The pack already wrote the sources and the review snapshot; the writer only writes rows here.
  const blobs: ExtractedCachePort = { ...deps.extracted, setSource: async () => undefined, snapshotReview: async () => undefined };
  const write = (rows: Parameters<typeof writeKnowledge>[1]) => writeKnowledge(
    {
      env: deps.env, db: unit.db, tenantId: deps.tenantId, projectId: deps.projectId, store: unit.store, blobs, userId: deps.userId, actorRole: deps.actorRole,
      embedFacts: false, skipVersionBump: true, packAuthorized: true,
    },
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

/**
 * Tombstones, limited to this root: each must already be a leaf of the root (else 422 `not_owned`, nothing written);
 * each removes its leaf; its fact or relation row is deleted only when no OTHER root's leaves name the key and the
 * author rule allows (SQL, in batches). Whatever is kept is returned, not hidden.
 */
async function applyTombstones(deps: ApplyDeps, unit: PackUnit, pack: Pack, admin: boolean): Promise<{ deleted: number; skipped: SkippedTombstone[] }> {
  const keys = tombstoneKeys(pack);
  if (keys.all.length === 0) return { deleted: 0, skipped: [] };
  const root = pack.rootId;
  const owned = await unit.ledger.leaves.existing(root, keys.all);
  const stray = keys.all.filter((k) => !owned.has(k));
  if (stray.length > 0) throw new KnowledgeSyncError(422, 'not_owned', 'a tombstone names a key this root never synced', { keys: stray.slice(0, 50) });

  const shared = await unit.ledger.leaves.namedByOthers(root, [...keys.facts, ...keys.relations]);
  const skipped: SkippedTombstone[] = [...shared].map((key) => ({ key, reason: 'other_root' as const }));
  let deleted = 0;

  const factKeys = keys.facts.filter((k) => !shared.has(k)).map((k) => k.slice(2));
  if (factKeys.length > 0) {
    const gone = new Set(await unit.store.deleteFactsByKeys(factKeys, { userId: deps.userId, admin }));
    deleted += gone.size;
    for (const k of factKeys) if (!gone.has(k)) skipped.push({ key: `a:${k}`, reason: 'not_permitted' });
  }
  const relKeys = keys.relations.filter((k) => !shared.has(k));
  if (relKeys.length > 0) {
    const rows = relKeys.map((k) => { const [from = '', to = '', kind = ''] = k.slice(2).split('\u0000'); return { from, to, kind }; });
    deleted += await unit.store.deleteRelationRows(rows, { origin: 'model' });
  }
  await unit.ledger.leaves.remove(root, keys.all);
  return { deleted: deleted + keys.files.length, skipped };
}

function checkAnalysis(pack: Pack): { sha: string; snapshot: unknown } | undefined {
  const a = pack.analysis as { sha?: unknown; snapshot?: unknown } | undefined;
  if (!a || typeof a.sha !== 'string' || !KNOWLEDGE_HASH_PATTERN.test(a.sha) || a.snapshot == null) return undefined;
  if (JSON.stringify(a.snapshot).length > MAX_ANALYSIS_SNAPSHOT_BYTES) throw new KnowledgeSyncError(413, 'payload_too_large', 'the analysis snapshot is over 2 MB');
  return { sha: a.sha, snapshot: a.snapshot };
}

export async function applyKnowledgePack(deps: ApplyDeps, input: ApplyInput): Promise<ApplyResult> {
  if (input.body.length > MAX_SYNC_BODY_BYTES) throw new KnowledgeSyncError(413, 'payload_too_large', `a pack request is at most ${MAX_SYNC_BODY_BYTES} bytes`);
  const assembled = await assemble(deps, input);
  if (!(assembled instanceof Uint8Array)) return assembled.staged;
  try {
    // The generation is read from the frame: a stale pack is refused before a byte of it is inflated.
    const head = peekGuarded(assembled);
    if (!head.rootId || head.rootId.length > MAX_ROOT_ID) throw new KnowledgeSyncError(422, 'bad_pack', `the root id is 1..${MAX_ROOT_ID} characters`);
    const root = head.rootId;
    const state = await deps.sync.state(root);
    // A full pack (generation 0) is accepted only while the root has no row; any other must be at the current generation.
    if (head.baseGeneration !== state.generation) {
      throw new KnowledgeSyncError(409, 'generation_mismatch', 'the server moved since this pack was built', { generation: state.generation, digest: state.digest });
    }
    const pack = await decodeGuarded(assembled);
    validatePack(pack);
    if (isPackRootId(root)) {
      const access = await authorizePackUpload(deps.env, deps.store, { userId: deps.userId, role: deps.actorRole }, root);
      if (!access.ok) throw new KnowledgeSyncError(403, 'forbidden', access.error);
    }
    const analysis = checkAnalysis(pack);
    await verifyBodies(deps, pack);
    // Whoever may delete any fact is decided once, outside the transaction (it can call out).
    const admin = (pack.deletes?.facts.length ?? 0) > 0 ? (await factViewer(deps.env, { userId: deps.userId, role: deps.actorRole })).canAdmin : false;

    // Objects and lookups that must not sit inside the transaction: the bodies as one bundle, the held sources.
    const bodies = await buildBodies(deps.extracted, pack.extracted ?? []);
    const bundle = bodies.length > 0 ? buildBundle(deps.tenantId, bodies) : undefined;
    const plan = planSources(pack, await deps.sync.sources(root));
    if (bundle) await deps.sync.putBundle(bundle);

    const atomically = deps.atomically ?? defaultAtomically(deps);
    const done = await atomically(async (unit) => {
      const tomb = await applyTombstones(deps, unit, pack, admin);
      if (bundle) await unit.ledger.index.upsert(bundle.locs);
      await unit.ledger.sources.upsert(root, plan.upsert);
      await unit.ledger.sources.remove(root, plan.remove);
      if (plan.stale.length > 0) await unit.store.markRelationsStaleMany(plan.stale);
      const written = await writeRows(deps, unit, pack);
      await unit.ledger.leaves.upsert(root, leavesOf(pack));
      // The digest of THIS ROOT'S leaves, checked inside the transaction: a mismatch throws and nothing above is kept.
      const tree = manifestTree(await unit.ledger.leaves.all(root));
      if (pack.targetDigest !== ZERO_DIGEST && tree.root !== pack.targetDigest) {
        throw new KnowledgeSyncError(409, 'digest_mismatch', 'the server did not reach the pack’s digest; reconcile', { generation: state.generation, digest: tree.root });
      }
      const generation = await unit.ledger.roots.advance(root, head.baseGeneration, tree.root);
      if (generation === null) throw new KnowledgeSyncError(409, 'generation_mismatch', 'another pack reached this root first', { generation: state.generation });
      return { written, tomb, generation, digest: tree.root };
    });

    // After the commit: objects and calls the transaction must not hold open.
    await deps.sync.deleteLegacySources(root, plan.remove).catch(() => undefined);
    if (pack.scope?.lastDigest) await deps.sync.snapshotReview(root, pack.scope.lastDigest, plan.after).catch(() => undefined);
    await bumpKnowledgeVersion(deps.env, deps.tenantId, deps.projectId);
    if (analysis) await putAnalysisSnapshot(deps, analysis.sha, root, analysis.snapshot);
    return {
      applied: true, generation: done.generation, digest: done.digest, files: plan.upsert.length + plan.remove.length, extracted: bodies.length,
      facts: done.written.facts, relations: done.written.relations, deleted: done.tomb.deleted, skipped: done.tomb.skipped,
    };
  } finally {
    if (input.syncId && (input.parts ?? 1) > 1) await deps.sync.dropStaged(actorOf(deps), input.syncId).catch(() => undefined);
  }
}

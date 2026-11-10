/**
 * applyKnowledgePack — `POST …/knowledge/sync` (PRD 41 A11 rules 3-4b): one BFKP pack in, the root's rows brought
 * to the pack's state, `{ generation, digest }` out.
 *
 * Refused before any row or object is written: a body over 8 MB; more than 8 parts, or parts adding up past 24 MB
 * (summed as they load); a wrong generation (read from the FRAME, before any inflation); a frame that is
 * malformed, fails its CRC (header and body) or inflates past the codec's caps (413 / 422); rows the writer cannot
 * take (ids, byte lengths, control characters, duplicates, contradictions, non-model rows: `packValidation`); an
 * unauthorised pack root; an oversized analysis; a skipped body the project does not really hold for this root's file
 * (409 `extracted_missing`).
 *
 * Storage is bounded per pack, not per file: the bodies are ONE content-addressed bundle object (merged with what is
 * stored, by `sourceRef`); then ONE Postgres transaction holds the bundle index, source rows, relation stale marks,
 * facts (the shared multi-row writer), relations, tombstones, the root's LEAVES, its bucket digests and its generation.
 *
 * Packs of one project are SERIALISED: the transaction's first statement takes the project's sync advisory lock. Under
 * it, "no other root names this key" (tombstones) is true when acted on, and the body merge — built from the bodies read
 * BEFORE the transaction — is checked against the index: a hash whose bundle moved since is `409 body_conflict` (the
 * client rebuilds and resends), and the index write is conditional on the same key as a second safeguard. The skipped
 * bodies are verified again under the lock (the sweep takes the same lock before it drops index rows), and a FULL pack
 * (generation 0) first clears the root's leaves and bucket digests, so nothing left behind can wedge it. The wait for the
 * lock is bounded (10 s, then a retryable `503 sync_busy`).
 *
 * The root's manifest is its leaves (`knowledge_sync_leaves`) and the stored bucket digests built from them, never the
 * shared fact and relation tables. A pack recomputes only the buckets it touched. Inside the transaction the root digest is
 * checked against the pack's `targetDigest` (409 `digest_mismatch`), and the generation is advanced with a conditional
 * UPDATE (409 `generation_mismatch`); either throws and everything rolls back. A tombstone must name a leaf of THIS root
 * (422 `not_owned`); what is kept is reported in `skipped`, never silently (`packRows.ts`). A removed source is a MARKER
 * row in the same transaction, so a legacy object that cannot be deleted afterwards is harmless. Objects that must not
 * live inside the transaction (the review snapshot, legacy source deletes, the analysis) are written after it commits.
 */
import { ZERO_DIGEST, type Pack } from '@seanhogg/builderforce-memory/knowledge/pack';
import { srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { isPackRootId } from '@builderforce/agent-tools';
import { inTransaction, type Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import type { ExtractedCachePort, KnowledgeStorePort, ScopeMeasuredWith } from '../knowledgePorts';
import { KNOWLEDGE_HASH_PATTERN, MAX_ANALYSIS_SNAPSHOT_BYTES, putAnalysisSnapshot } from '../knowledgePerception';
import { reportedFallback } from '../../observability/caughtErrorReporter';
import { bumpKnowledgeVersion } from '../knowledgeVersion';
import { factViewer } from '../deleteKnowledgeFact';
import { authorizePackUpload } from '../packAccess';
import { sourceId } from '../knowledgeBlobs';
import { buildBundle } from '../knowledgeBundles';
import { commitLeaves, ensureBuckets } from '../knowledgeBuckets';
import { invalidateLostBodies } from '../knowledgeHeal';
import { drizzleLedger, type KnowledgeLedgerPort, type SourceRow } from '../knowledgeLedger';
import { drizzleKnowledgeStore } from '../knowledgeStore';
import { decodeGuarded, peekGuarded } from './decodeGuarded';
import { KnowledgeSyncError, MAX_PACK_BYTES, MAX_SYNC_BODY_BYTES, MAX_SYNC_PARTS, SYNC_ID_PATTERN, type KnowledgeSyncPort } from './knowledgeSyncPorts';
import { buildBodies } from './packBodies';
import { applyTombstones, leavesOf, reconcileLegacyRows, writeRows } from './packRows';
import { checkRootId, validatePack } from './packValidation';

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
  /** The ledger over `db` (reads outside the transaction). */
  ledger: KnowledgeLedgerPort;
  userId: string | null;
  actorRole: string | null;
  /** Who staged parts are keyed by when `userId` is null: the machine key's id (never a literal shared by every key). */
  stageActor?: string;
  /** Runs `work` as ONE transaction (default: a Postgres transaction over `db`). A test seam. */
  atomically?: <T>(work: (unit: PackUnit) => Promise<T>) => Promise<T>;
}

export interface ApplyInput {
  body: Uint8Array;
  /** Present on every part of a multi-part pack. */
  syncId?: string;
  part?: number;
  parts?: number;
  /**
   * What the review this pack records was measured with (PRD 41 §C9), stated beside the pack (its scope section has no
   * field for it). Stored on the root's scope only with a scope that records a review digest.
   */
  measured?: ScopeMeasuredWith;
}

/** A tombstone whose leaf was removed but whose row was kept, and why. */
export interface SkippedTombstone { key: string; reason: 'other_root' | 'not_permitted' }

export type ApplyResult =
  | { applied: false; syncId: string; received: number; parts: number }
  /** `reconcile`: this pack's own root lost a stored body to a heal and its leaves were invalidated; the client reconciles at once. */
  | { applied: true; reconcile?: true; generation: number; digest: string; files: number; extracted: number; facts: number; relations: number; deleted: number; skipped: SkippedTombstone[] };

const defaultAtomically = (deps: ApplyDeps): NonNullable<ApplyDeps['atomically']> => (work) =>
  inTransaction(deps.db, (tx) => {
    const db = tx as unknown as Db;
    return work({ db, store: drizzleKnowledgeStore(db, deps.tenantId, deps.projectId), ledger: drizzleLedger(db, deps.tenantId, deps.projectId) });
  });

const SOURCE = 'application/knowledge/sync/applyKnowledgePack.ts';

/** Whose staged parts these are. With no identity at all there is nobody to key them to: refused, never a literal shared by every caller. */
const actorOf = (deps: ApplyDeps): string => {
  const actor = deps.userId ?? deps.stageActor;
  if (!actor) throw new KnowledgeSyncError(403, 'forbidden', 'a multi-part pack needs an authenticated caller');
  return actor;
};

const bodyConflict = (hashes: readonly string[]): KnowledgeSyncError =>
  new KnowledgeSyncError(409, 'body_conflict', 'another pack changed these extracted bodies while this one was applied; rebuild and resend', { hashes: hashes.slice(0, 50) });

/**
 * Parks an earlier part; returns the whole pack as its ordered parts once the last part arrived. The LAST part is never
 * staged: it rides this request, so a pack of N parts costs N-1 staging writes. The parts' sizes are summed as they
 * load, and they are NOT joined: the codec inflates them as one stream.
 */
async function assemble(deps: ApplyDeps, input: ApplyInput): Promise<Uint8Array[] | { staged: ApplyResult }> {
  const { syncId, part, parts } = input;
  if (!parts || parts <= 1) return [input.body];
  if (!syncId || !SYNC_ID_PATTERN.test(syncId) || part === undefined || !Number.isInteger(part) || !Number.isInteger(parts)
    || part < 0 || part >= parts || parts > MAX_SYNC_PARTS) {
    throw new KnowledgeSyncError(400, 'bad_parts', `a multi-part pack names a syncId, a part within 0..parts-1 and at most ${MAX_SYNC_PARTS} parts`);
  }
  await deps.sync.sweepStaged().catch(reportedFallback(undefined, { source: SOURCE, operation: 'sweepStaged' }));
  if (part !== parts - 1) {
    await deps.sync.stagePart(actorOf(deps), syncId, part, input.body);
    return { staged: { applied: false, syncId, received: part + 1, parts } };
  }
  const earlier = await deps.sync.stagedParts(actorOf(deps), syncId, parts - 1, MAX_PACK_BYTES - input.body.length);
  if (!earlier) throw new KnowledgeSyncError(409, 'parts_missing', 'a part of this pack is missing or expired; send the pack again', { syncId });
  return [...earlier, input.body];
}

/**
 * A file whose body the client skipped (the project already held that hash) must still be named by the stored body:
 * the body is per hash, its entries per source (a source declared entry-less, i.e. binary, counts). ONE indexed query answers it for every such `(hash, sourceRef)`; any that
 * fails is a 409 `extracted_missing` naming the hashes, and the client sends those bodies. Checked BEFORE anything is written.
 */
async function verifyBodies(deps: ApplyDeps, pack: Pack, over?: KnowledgeLedgerPort): Promise<void> {
  const shipped = new Set((pack.extracted ?? []).map((x) => x.hash));
  const owed = (pack.files ?? []).filter((f) => !shipped.has(f.hash));
  if (owed.length === 0) return;
  const pairs = owed.map((f) => ({ hash: f.hash, sourceRef: srcRef(pack.rootId, f.path) }));
  const held = await deps.sync.heldEntries(pairs, over, { entryless: true });
  const missing = new Set<string>();
  pairs.forEach((p, i) => { if (!held.has(i)) missing.add(p.hash); });
  if (missing.size > 0) throw new KnowledgeSyncError(409, 'extracted_missing', 'the server lacks the extracted output of some files; send those bodies', { hashes: [...missing] });
}

interface SourcePlan {
  upsert: SourceRow[];
  /** Source ids to mark removed (the pack's own tombstones, plus, on a migrated root, the legacy sources it does not name). */
  remove: string[];
  stale: Array<{ sourceRef: `src:${string}`; currentHash: string }>;
  /** The root's sources after the pack. */
  after: Array<{ path: string; hash: string }>;
  /** Paths of legacy sources a migrated root's first pack drops: their model rows go too. */
  legacyPaths: string[];
}

function planSources(pack: Pack, heldNow: ReadonlyArray<{ path: string; hash: string }>, migrated: boolean): SourcePlan {
  const held = new Map(heldNow.map((s) => [sourceId(s.path, s.hash), s] as const));
  const after = new Map(held);
  const plan: SourcePlan = { upsert: [], remove: [], stale: [], after: [], legacyPaths: [] };
  const named = new Set<string>();
  for (const f of pack.files ?? []) {
    const id = sourceId(f.path, f.hash);
    named.add(id);
    const before = held.get(id);
    if (before?.hash === f.hash) continue;
    plan.upsert.push({ sourceId: id, path: f.path, hash: f.hash });
    after.set(id, { path: f.path, hash: f.hash });
    // A source that changed from a known hash makes its model relations stale; one new to the root has none to mark.
    if (before && !f.hash.startsWith('~')) plan.stale.push({ sourceRef: srcRef(pack.rootId, f.path) as `src:${string}`, currentHash: f.hash });
  }
  const removed = new Set(pack.deletes?.files ?? []);
  for (const id of removed) {
    const before = held.get(id);
    plan.remove.push(id);
    after.delete(id);
    if (before && !id.startsWith('~')) plan.stale.push({ sourceRef: srcRef(pack.rootId, id) as `src:${string}`, currentHash: '' });
  }
  if (migrated) {
    // The root has no leaves: the server is reconciling its own legacy state, so what the pack does not name is gone.
    for (const [id, s] of held) {
      if (named.has(id) || removed.has(id)) continue;
      plan.remove.push(id);
      plan.legacyPaths.push(s.path);
      after.delete(id);
    }
  }
  plan.after = [...after.values()];
  return plan;
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
  if (!Array.isArray(assembled)) return assembled.staged;
  try {
    // The generation is read from the frame: a stale pack is refused before a byte of it is inflated.
    const head = peekGuarded(assembled);
    checkRootId(head.rootId);
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
    // A root an older version synced (a generation from `sync.json`, no leaves) is reconciled by its first pack.
    const migrated = state.generation > 0 && !(await deps.ledger.leaves.any(root));
    // Whoever may delete any fact is decided once, outside the transaction (it can call out).
    const admin = (pack.deletes?.facts.length ?? 0) > 0 || migrated ? (await factViewer(deps.env, { userId: deps.userId, role: deps.actorRole })).canAdmin : false;

    // Objects and lookups that must not sit inside the transaction: the bodies as one bundle, the held sources.
    const { bodies, basis, lost } = await buildBodies(deps.extracted, deps.ledger, pack.extracted ?? [], pack.files ?? [], root);
    const bundle = bodies.length > 0 ? buildBundle(deps.tenantId, bodies) : undefined;
    const plan = planSources(pack, await deps.sync.sources(root), migrated);
    if (bundle) await deps.sync.putBundle(bundle);

    const atomically = deps.atomically ?? defaultAtomically(deps);
    const done = await atomically(async (unit) => {
      // FIRST statement: serialise packs of this project. Everything below that reads "who else names this" or merges a body is then true.
      await unit.ledger.lock();
      // A full pack (generation 0) IS the root's whole state: leaves and bucket digests left by an earlier, rolled-back or
      // deleted root would otherwise sit in buckets this pack never touches and wedge the root on digest_mismatch forever.
      if (head.baseGeneration === 0) {
        await unit.ledger.leaves.clear(root);
        await unit.ledger.buckets.clear(root);
      }
      await ensureBuckets(unit.ledger, root);
      // The skipped bodies are re-checked under the lock: the pre-check above ran before it, and the sweep (which takes the
      // same lock per project) may have removed a hash's index row in between.
      await verifyBodies(deps, pack, unit.ledger);
      if (bundle) {
        const now = new Map((await unit.ledger.index.locate(bundle.locs.map((l) => l.hash))).map((l) => [l.hash, l.bundleKey] as const));
        const moved = bundle.locs.filter((l) => (now.get(l.hash) ?? null) !== (basis.get(l.hash) ?? null)).map((l) => l.hash);
        if (moved.length > 0) throw bodyConflict(moved);
        if (await unit.ledger.index.upsert(bundle.locs, basis) !== bundle.locs.length) throw bodyConflict(bundle.locs.map((l) => l.hash));
      }
      const legacy = await reconcileLegacyRows(deps, unit, pack, plan.legacyPaths, admin);
      const tomb = await applyTombstones(deps, unit, pack, admin);
      await unit.ledger.sources.upsert(root, plan.upsert);
      await unit.ledger.sources.mark(root, plan.remove);
      if (plan.stale.length > 0) await unit.store.markRelationsStaleMany(plan.stale);
      const written = await writeRows(deps, unit, pack, input.measured);
      // The digest of THIS ROOT'S leaves, from the stored bucket digests with only the touched buckets recomputed.
      const committed = await commitLeaves(unit.ledger, root, {
        leaves: leavesOf(pack), touched: [...tomb.keys, ...legacy.leafKeys], base: head.baseGeneration,
        verify: (digest) => {
          if (pack.targetDigest !== ZERO_DIGEST && digest !== pack.targetDigest) {
            throw new KnowledgeSyncError(409, 'digest_mismatch', 'the server did not reach the pack’s digest; reconcile', { generation: state.generation, digest });
          }
        },
      });
      if (committed.generation === null) throw new KnowledgeSyncError(409, 'generation_mismatch', 'another pack reached this root first', { generation: state.generation });
      let { generation, digest } = { generation: committed.generation, digest: committed.digest };
      // A body healed from this pack: every root that shared it — this one included, for its paths the pack did not re-supply — sends it
      // again on its next sync. After this root's own advance, so its pack asserted its digest before any leaf was invalidated.
      let reconcile = false;
      for (const inv of lost.length > 0 ? await invalidateLostBodies(unit.ledger, lost, [root]) : []) {
        if (inv.root === root) { generation = inv.generation; digest = inv.digest; reconcile = true; }
      }
      return { written, tomb, legacy, generation, digest, reconcile };
    });

    // After the commit: objects and calls the transaction must not hold open. A legacy delete that fails here is harmless
    // (the removal markers hide the object) and the sweep retries it.
    await deps.sync.deleteLegacySources(root, plan.remove).catch(reportedFallback(undefined, { source: SOURCE, operation: 'deleteLegacySources', context: { root } }));
    if (pack.scope?.lastDigest) await deps.sync.snapshotReview(root, pack.scope.lastDigest, plan.after).catch(reportedFallback(undefined, { source: SOURCE, operation: 'snapshotReview', context: { root } }));
    await bumpKnowledgeVersion(deps.env, deps.tenantId, deps.projectId);
    if (analysis) await putAnalysisSnapshot(deps, analysis.sha, root, analysis.snapshot);
    return {
      applied: true, ...(done.reconcile ? { reconcile: true as const } : {}), generation: done.generation, digest: done.digest, files: plan.upsert.length + plan.remove.length, extracted: bodies.length,
      facts: done.written.facts, relations: done.written.relations, deleted: done.tomb.deleted + done.legacy.deleted, skipped: [...done.tomb.skipped, ...done.legacy.skipped],
    };
  } finally {
    if (input.syncId && (input.parts ?? 1) > 1) await deps.sync.dropStaged(actorOf(deps), input.syncId).catch(reportedFallback(undefined, { source: SOURCE, operation: 'dropStaged' }));
  }
}

/**
 * applyKnowledgePack — `POST …/knowledge/sync` (PRD 41 A11 rules 3-4): one BFKP pack in, the root's rows
 * brought to the pack's state, `{ generation, digest }` out.
 *
 * Guards, before any row is touched: compressed body ≤ 8 MB; parts staged by `syncId` (expire in 1 h)
 * and applied only when the last arrives; the shared codec checks the magic, the CRC-32, the 64 MB
 * inflate cap and the string/row counts (413 `pack_too_large`, 422 `bad_pack`); the pack's
 * `baseGeneration` must be 0 (a full pack) or the root's current generation (else 409 `generation_mismatch`).
 *
 * Apply goes through the code the `write` route runs, never a second writer:
 *   extracted bodies   `putExtracted` (diffs expanded against the prior the server holds)
 *   facts, relations   `writeKnowledge`, in chunks of its row bound (relations are one multi-row upsert each)
 *   sources            `writeKnowledge` stale marks for sources that changed; a source new to the root only registers
 *   tombstones         exact relation rows, fact keys (`deleteKnowledgeFact`'s rules), source removals
 *   scope              `writeKnowledge` last, so no digest is recorded before its rows
 * The knowledge version is bumped once. Then the root digest is recomputed from the server's rows with the
 * codec's `manifestTree`; it must equal the pack's `targetDigest` or the answer is 409 `digest_mismatch`
 * and the generation is NOT advanced, so the client reconciles instead of trusting the apply.
 */
import { joinParts, type Pack, type PackExtr } from '@seanhogg/builderforce-memory/knowledge/pack';
import { applyEntryDiffs, ZERO_DIGEST } from '@seanhogg/builderforce-memory/knowledge/pack';
import { srcRef, type Extracted } from '@seanhogg/builderforce-memory/knowledge';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import type { ExtractedCachePort, KnowledgeStorePort } from '../knowledgePorts';
import { KNOWLEDGE_HASH_PATTERN, MAX_ANALYSIS_SNAPSHOT_BYTES, putAnalysisSnapshot, putExtracted } from '../knowledgePerception';
import { bumpKnowledgeVersion } from '../knowledgeVersion';
import { deleteKnowledgeFact } from '../deleteKnowledgeFact';
import { MAX_KNOWLEDGE_WRITE_ROWS, writeKnowledge, type KnowledgeFactInput, type KnowledgeStaleMark } from '../writeKnowledge';
import { decodeGuarded } from './decodeGuarded';
import { KnowledgeSyncError, MAX_SYNC_BODY_BYTES, MAX_SYNC_PARTS, SYNC_ID_PATTERN, type KnowledgeSyncPort } from './knowledgeSyncPorts';
import { serverManifest } from './knowledgeSyncManifest';

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

/** Parks a part; returns the whole pack's bytes once the last part arrived, else null. */
async function assemble(deps: ApplyDeps, input: ApplyInput): Promise<Uint8Array | { staged: ApplyResult }> {
  const { syncId, part, parts } = input;
  if (!parts || parts <= 1) return input.body;
  if (!syncId || !SYNC_ID_PATTERN.test(syncId) || part === undefined || !Number.isInteger(part) || !Number.isInteger(parts)
    || part < 0 || part >= parts || parts > MAX_SYNC_PARTS) {
    throw new KnowledgeSyncError(400, 'bad_parts', 'a multi-part pack names a syncId, a part within 0..parts-1 and at most 64 parts');
  }
  await deps.sync.sweepStaged().catch(() => undefined);
  await deps.sync.stagePart(syncId, part, input.body);
  if (part !== parts - 1) return { staged: { applied: false, syncId, received: part + 1, parts } };
  const all = await deps.sync.stagedParts(syncId, parts);
  if (!all) throw new KnowledgeSyncError(409, 'parts_missing', 'a part of this pack is missing or expired; send the pack again', { syncId });
  return joinParts(all);
}

/**
 * A file whose body the client skipped (the project already held that hash) must still be named by the object it
 * points at: the object is per hash, its entries per source. Any that is not is a 409 `extracted_missing` naming the hashes,
 * and the client sends those bodies. Checked BEFORE anything is written.
 */
async function verifyBodies(deps: ApplyDeps, pack: Pack): Promise<void> {
  const shipped = new Set((pack.extracted ?? []).map((x) => x.hash));
  const owed = (pack.files ?? []).filter((f) => !shipped.has(f.hash));
  const missing = new Set<string>();
  await mapBounded(owed, CONCURRENCY, async (f) => {
    const entries = await deps.extracted.get(f.hash);
    if (!entries?.some((e) => e.sourceRef === srcRef(pack.rootId, f.path))) missing.add(f.hash);
  });
  if (missing.size > 0) throw new KnowledgeSyncError(409, 'extracted_missing', 'the server lacks the extracted output of some files; send those bodies', { hashes: [...missing] });
}

async function applyAnalysis(deps: ApplyDeps, pack: Pack): Promise<void> {
  const a = pack.analysis as { sha?: unknown; snapshot?: unknown } | undefined;
  if (!a || typeof a.sha !== 'string' || !KNOWLEDGE_HASH_PATTERN.test(a.sha) || a.snapshot == null) return;
  if (JSON.stringify(a.snapshot).length > MAX_ANALYSIS_SNAPSHOT_BYTES) throw new KnowledgeSyncError(413, 'payload_too_large', 'the analysis snapshot is over 2 MB');
  await putAnalysisSnapshot(deps, a.sha, pack.rootId, a.snapshot);
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

/** Source changes: a changed source marks its model relations stale; a source new to the root only registers. */
async function applySources(deps: ApplyDeps, pack: Pack, held: ReadonlyMap<string, string>): Promise<number> {
  const root = pack.rootId;
  const marks = new Map<string, string>();
  for (const f of pack.files ?? []) if (!f.hash.startsWith('~')) marks.set(f.path, f.hash);
  const prefix = `src:${root}::`;
  for (const s of pack.stale ?? []) if (s.sourceRef.startsWith(prefix)) marks.set(s.sourceRef.slice(prefix.length), s.hash);
  const changed: KnowledgeStaleMark[] = [];
  const fresh: Array<[string, string]> = [];
  for (const [path, hash] of marks) {
    const before = held.get(path);
    if (before === hash) continue;
    if (before === undefined && hash !== '') fresh.push([path, hash]);
    else changed.push({ sourceRef: srcRef(root, path), currentHash: hash });
  }
  for (const f of pack.deletes?.files ?? []) if (!f.startsWith('~') && held.has(f)) changed.push({ sourceRef: srcRef(root, f), currentHash: '' });
  await mapBounded(fresh, CONCURRENCY, ([path, hash]) => deps.extracted.setSource(srcRef(root, path), hash));
  for (let i = 0; i < changed.length; i += MAX_KNOWLEDGE_WRITE_ROWS) {
    await writeRows(deps, root, { stale: changed.slice(i, i + MAX_KNOWLEDGE_WRITE_ROWS) });
  }
  return marks.size + (pack.deletes?.files.length ?? 0);
}

const writeRows = (deps: ApplyDeps, root: string, rows: Parameters<typeof writeKnowledge>[1]) =>
  writeKnowledge(
    { env: deps.env, db: deps.db, tenantId: deps.tenantId, projectId: deps.projectId, store: deps.store, blobs: deps.extracted, userId: deps.userId, actorRole: deps.actorRole },
    { root, ...rows },
  );

async function applyRows(deps: ApplyDeps, pack: Pack): Promise<{ facts: number; relations: number }> {
  const root = pack.rootId;
  const facts = (pack.facts ?? []) as KnowledgeFactInput[];
  const relations = pack.relations ?? [];
  let written = { facts: 0, relations: 0 };
  // Facts first, then relations: a relation to a fact never lands before the fact.
  for (let i = 0; i < facts.length; i += MAX_KNOWLEDGE_WRITE_ROWS) {
    written.facts += (await writeRows(deps, root, { facts: facts.slice(i, i + MAX_KNOWLEDGE_WRITE_ROWS) })).factsWritten;
  }
  for (let i = 0; i < relations.length; i += MAX_KNOWLEDGE_WRITE_ROWS) {
    written.relations += (await writeRows(deps, root, { relations: relations.slice(i, i + MAX_KNOWLEDGE_WRITE_ROWS) })).relationsWritten;
  }
  return written;
}

async function applyTombstones(deps: ApplyDeps, pack: Pack): Promise<number> {
  const d = pack.deletes;
  if (!d) return 0;
  let removed = 0;
  if (d.relations.length > 0) {
    // A person's edge is only removed by a person.
    const human = deps.userId ? new Set<string>() : await deps.store.humanRelationKeys(d.relations);
    const rows = d.relations.filter((r) => !human.has(`${r.from}\u0000${r.to}\u0000${r.kind}`));
    removed += await deps.store.deleteRelationRows(rows);
  }
  for (const key of d.facts) {
    const r = await deleteKnowledgeFact(deps, { userId: deps.userId, role: deps.actorRole }, key);
    if (r.ok && r.removed) removed += 1;
  }
  return removed + d.files.length;
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
    const held = new Map((await deps.sync.sources(root)).map((s) => [s.path, s.hash] as const));

    const extracted = pack.extracted ?? [];
    await mapBounded(extracted, CONCURRENCY, async (x) => {
      await putExtracted(deps, x.hash, await expand(deps, x), { deferVersionBump: true, skipStaleMarks: true });
    });
    const files = await applySources(deps, pack, held);
    const written = await applyRows(deps, pack);
    const deleted = await applyTombstones(deps, pack);
    if (pack.scope) await writeRows(deps, root, { scope: pack.scope });
    await applyAnalysis(deps, pack);
    await bumpKnowledgeVersion(deps.env, deps.tenantId, deps.projectId);

    const { tree } = await serverManifest(deps, root);
    if (pack.targetDigest !== ZERO_DIGEST && tree.root !== pack.targetDigest) {
      throw new KnowledgeSyncError(409, 'digest_mismatch', 'the server did not reach the pack’s digest; reconcile', { generation: state.generation, digest: tree.root });
    }
    const next = { generation: state.generation + 1, digest: tree.root };
    await deps.sync.saveState(root, next);
    return { applied: true, ...next, files, extracted: extracted.length, facts: written.facts, relations: written.relations, deleted };
  } finally {
    if (input.syncId && (input.parts ?? 1) > 1) await deps.sync.dropStaged(input.syncId).catch(() => undefined);
  }
}

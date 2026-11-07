/**
 * packRows — what a pack does to the project's shared fact and relation tables, inside its transaction (PRD 41 A11
 * rule 4b): the rows it sets, the rows its tombstones remove, and the one-time reconcile of a root that was synced by an
 * older version (a generation row from `sync.json`, but no leaves).
 *
 * Nothing here deletes a row because THIS root stopped naming it: `removeRows` keeps a row some OTHER root's leaves
 * still name, and a relation of any origin but `model` — a person's or an agent's edge — is never a pack's to delete.
 * Whatever is kept is returned in `skipped`, never hidden. It runs under the project's sync lock, so "no other root
 * names it" is true when it is acted on.
 */
import { factDigest, factLeafKey, fileLeafKey, parseRelationLeafKey, relationDigest, relationLeafKey, type Pack } from '@seanhogg/builderforce-memory/knowledge/pack';
import type { ExtractedCachePort } from '../knowledgePorts';
import type { LeafRow } from '../knowledgeLedger';
import { MAX_KNOWLEDGE_WRITE_ROWS, writeKnowledge, type KnowledgeFactInput } from '../writeKnowledge';
import type { ApplyDeps, PackUnit, SkippedTombstone } from './applyKnowledgePack';
import { KnowledgeSyncError } from './knowledgeSyncPorts';
import { tombstoneKeys } from './packValidation';

/** The leaves a pack sets: the digests of its own rows, by the codec's functions, so they are the client's digests. */
export function leavesOf(pack: Pack): LeafRow[] {
  return [
    ...(pack.files ?? []).map((f) => ({ key: fileLeafKey(f.path, f.hash), digest: f.hash })),
    ...(pack.facts ?? []).map((f) => ({ key: factLeafKey(f.key), digest: factDigest(f) })),
    ...(pack.relations ?? []).map((r) => ({ key: relationLeafKey(r), digest: relationDigest(r) })),
  ];
}

/** Facts, relations and the scope, through the single writer, on the transaction's handle. */
export async function writeRows(deps: ApplyDeps, unit: PackUnit, pack: Pack): Promise<{ facts: number; relations: number }> {
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

type Triple = { from: string; to: string; kind: string };

/**
 * Removes the rows `root` no longer names — facts by key, relations by identity — except:
 *   - a row some OTHER root's leaves name (`other_root`);
 *   - a fact the author rule keeps (`not_permitted`);
 *   - a relation whose origin is not `model` (a person's or an agent's edge is theirs).
 * Deleting a fact removes only the MODEL relations that touch it and that no other root names; the rest stay.
 */
export async function removeRows(
  deps: ApplyDeps, unit: PackUnit, root: string, rows: { factKeys: readonly string[]; relations: readonly Triple[] }, admin: boolean,
): Promise<{ deleted: number; skipped: SkippedTombstone[] }> {
  const skipped: SkippedTombstone[] = [];
  let deleted = 0;
  const namedElsewhere = await unit.ledger.leaves.namedByOthers(root, [...rows.factKeys.map(factLeafKey), ...rows.relations.map(relationLeafKey)]);
  for (const k of rows.factKeys) if (namedElsewhere.has(factLeafKey(k))) skipped.push({ key: factLeafKey(k), reason: 'other_root' });
  for (const r of rows.relations) if (namedElsewhere.has(relationLeafKey(r))) skipped.push({ key: relationLeafKey(r), reason: 'other_root' });

  const factKeys = rows.factKeys.filter((k) => !namedElsewhere.has(factLeafKey(k)));
  const relations = new Map<string, Triple>(rows.relations.filter((r) => !namedElsewhere.has(relationLeafKey(r))).map((r) => [relationLeafKey(r), r]));
  if (factKeys.length > 0) {
    const gone = await unit.store.deleteFactsByKeys(factKeys, { userId: deps.userId, admin }, { keepRelations: true });
    const goneSet = new Set(gone);
    deleted += gone.length;
    for (const k of factKeys) if (!goneSet.has(k)) skipped.push({ key: factLeafKey(k), reason: 'not_permitted' });
    // The deleted facts' relations: only the model ones that no other root names go with them.
    const touching = gone.length > 0 ? await unit.store.relationsTouching(gone.map((k) => `fact:${k}`)) : [];
    const cascaded = touching.filter((r) => r.origin === 'model');
    const others = await unit.ledger.leaves.namedByOthers(root, cascaded.map(relationLeafKey));
    for (const r of cascaded) {
      const key = relationLeafKey(r);
      if (others.has(key)) skipped.push({ key, reason: 'other_root' }); else relations.set(key, { from: r.from, to: r.to, kind: r.kind });
    }
  }
  if (relations.size > 0) deleted += await unit.store.deleteRelationRows([...relations.values()], { origin: 'model' });
  return { deleted, skipped };
}

/**
 * Tombstones, limited to this root: each must already be a leaf of the root (else 422 `not_owned`, nothing written); each
 * removes its leaf; its fact or relation row goes only through `removeRows`. The caller recomputes the buckets of `keys`.
 */
export async function applyTombstones(
  deps: ApplyDeps, unit: PackUnit, pack: Pack, admin: boolean,
): Promise<{ deleted: number; skipped: SkippedTombstone[]; keys: string[] }> {
  const keys = tombstoneKeys(pack);
  if (keys.all.length === 0) return { deleted: 0, skipped: [], keys: [] };
  const root = pack.rootId;
  const owned = await unit.ledger.leaves.existing(root, keys.all);
  const stray = keys.all.filter((k) => !owned.has(k));
  if (stray.length > 0) throw new KnowledgeSyncError(422, 'not_owned', 'a tombstone names a key this root never synced', { keys: stray.slice(0, 50) });

  const relations = keys.relations.flatMap((k) => { const r = parseRelationLeafKey(k); return r ? [r] : []; });
  const removed = await removeRows(deps, unit, root, { factKeys: keys.facts.map((k) => k.slice(2)), relations }, admin);
  await unit.ledger.leaves.remove(root, keys.all);
  return { deleted: removed.deleted + keys.files.length, skipped: removed.skipped, keys: keys.all };
}

/**
 * The first pack to a root an older version synced (a generation row, no leaves): the server is reconciling its OWN
 * legacy state, so the sources the pack does not name were removed on the client. Their model facts (anchored ONLY to
 * those sources) and model relations (an end under one of them) go through `removeRows`, which still spares what another
 * root names. The sources themselves are marked removed by the caller.
 */
export async function reconcileLegacyRows(
  deps: ApplyDeps, unit: PackUnit, pack: Pack, removedPaths: readonly string[], admin: boolean,
): Promise<{ deleted: number; skipped: SkippedTombstone[] }> {
  if (removedPaths.length === 0) return { deleted: 0, skipped: [] };
  const root = pack.rootId;
  const gone = new Set(removedPaths);
  const named = new Set((pack.facts ?? []).map((f) => f.key));
  const facts = (await unit.store.facts(gone)).filter((f) => f.origin === 'model' && !named.has(f.key) && f.fileAnchors.every((a) => gone.has(a.path)));
  const underRemoved = (ref: string): boolean => {
    const prefix = `src:${root}::`;
    if (!ref.startsWith(prefix)) return false;
    const rest = ref.slice(prefix.length);
    const hash = rest.indexOf('#');
    return gone.has(hash < 0 ? rest : rest.slice(0, hash));
  };
  const packRelations = new Set((pack.relations ?? []).map(relationLeafKey));
  const relations = (await unit.store.relations(root, new Set(facts.map((f) => `fact:${f.key}`))))
    .filter((r) => r.origin === 'model' && (underRemoved(r.from) || underRemoved(r.to)) && !packRelations.has(relationLeafKey(r)))
    .map((r) => ({ from: r.from, to: r.to, kind: r.kind }));
  return removeRows(deps, unit, root, { factKeys: facts.map((f) => f.key), relations }, admin);
}

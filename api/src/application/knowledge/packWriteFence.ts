/**
 * packWriteFence — what an uploaded PACK's write may touch beyond its own rows (PRD 40, OD-2):
 *
 *   • relations: kept only when at least one end is the pack's own — a `src:<root>::` ref, or a
 *     `fact:` key the pack owns (stored under it already, or written by this call). An edge
 *     between two FOREIGN facts is refused, and an existing HUMAN edge is never overwritten;
 *   • scope: a pack write with no scope in the call still records the pack (a stub row carrying
 *     the uploader), so an upload that stops after its first chunk is listed and removable.
 */
import type { StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeStorePort } from './knowledgePorts';

const FACT_PREFIX = 'fact:';
const triple = (r: Pick<StoredRelation, 'from' | 'to' | 'kind'>): string => `${r.from}\u0000${r.to}\u0000${r.kind}`;

export async function fencePackRelations(
  store: Pick<KnowledgeStorePort, 'factSources' | 'humanRelationKeys'>,
  packRoot: string,
  ownedKeys: ReadonlySet<string>,
  relations: readonly StoredRelation[],
): Promise<{ keep: StoredRelation[]; skipped: string[] }> {
  if (relations.length === 0) return { keep: [], skipped: [] };
  const srcPrefix = `src:${packRoot}::`;
  const owned = new Set(ownedKeys);
  // Fact ends the pack wrote in an earlier chunk of the same upload: owned by their stored source.
  const unknown = new Set<string>();
  for (const r of relations) {
    for (const end of [r.from as string, r.to as string]) {
      if (end.startsWith(FACT_PREFIX) && !owned.has(end.slice(FACT_PREFIX.length))) unknown.add(end.slice(FACT_PREFIX.length));
    }
  }
  if (unknown.size > 0) {
    for (const [key, source] of await store.factSources([...unknown])) if (source === packRoot) owned.add(key);
  }
  const ownsEnd = (end: string): boolean =>
    end.startsWith(srcPrefix) || (end.startsWith(FACT_PREFIX) && owned.has(end.slice(FACT_PREFIX.length)));

  const skipped: string[] = [];
  const label = (r: StoredRelation): string => `${r.from} -> ${r.to} (${r.kind})`;
  const own = relations.filter((r) => (ownsEnd(r.from) || ownsEnd(r.to)) ? true : (skipped.push(label(r)), false));
  const human = own.length > 0 ? await store.humanRelationKeys(own) : new Set<string>();
  const keep = own.filter((r) => (human.has(triple(r)) ? (skipped.push(label(r)), false) : true));
  return { keep, skipped };
}

/** Records a pack that a write names only by `root` (no scope in the call): a stub row, never replacing an existing scope. */
export async function ensurePackScope(
  store: Pick<KnowledgeStorePort, 'scope' | 'upsertScope'>,
  packRoot: string,
  userId: string | null,
  scopeInCall: unknown,
): Promise<void> {
  if (scopeInCall || (await store.scope(packRoot))) return;
  await store.upsertScope({ rootId: packRoot, title: packRoot, packs: [], ...(userId ? { provenance: { uploadedBy: userId } } : {}) });
}

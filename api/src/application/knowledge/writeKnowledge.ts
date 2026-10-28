/**
 * writeKnowledge — the ONE writer of stored knowledge (PRD 38 §4.2): facts, relations,
 * a scope's digest and stale marks, for one (tenant, project), in one bounded call.
 *
 *   • facts      reuse `upsertProjectFact` (the platform's one fact upsert: replace by key,
 *                embedding, provenance, anchor hash stamping). Knowledge facts never run
 *                its single-subject anchor sweep — many claims share one file.
 *   • relations  upsert on (tenant, project, from, to, kind).
 *   • stale      `markStale(sourceRef, currentHash)` from a host's review, done HERE (a write
 *                of zero facts and relations): model relations judged from another hash get
 *                `stale_at`, and the source's own R2 object records its current
 *                hash ('' = the file was removed). Model FACTS need no mark: their staleness
 *                is derived at graph build from anchor hash vs the source's current hash.
 *   • scope      `knowledge_scopes` row (packs, last digest; a new digest moves the old one
 *                to `previous_digest`). A recorded digest also gets its review snapshot —
 *                the root's sources at that digest, one immutable R2 object written once —
 *                written BEFORE the scope row, so no digest is ever recorded without the
 *                snapshot Compare builds its baseline from.
 *
 * `origin: 'extracted'` is refused — perception is recomputed, never stored — and a call
 * carries at most {@link MAX_KNOWLEDGE_WRITE_ROWS} rows.
 *
 * Provenance is the SERVER's call, never the caller's word ({@link originAllowed}):
 *   • `human`  only from a person (a tenant JWT with a user) — the fact's author is them;
 *   • `agent`  only from a machine caller (an agent-host key, a machine token);
 *   • `model`  from either: a review a person runs in the browser or VS Code writes the
 *              model's judgement under their JWT, exactly as an on-prem host does with its key.
 * Absent, a fact's origin is the writer's kind (person → `human`, machine → `agent`). A row
 * claiming an origin its writer cannot hold is refused with 400 `origin_mismatch`. The knowledge version is bumped
 * ONCE per call, which is what invalidates every cached graph of the project.
 */
import type { NodeRef, ScopeRecord, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { upsertProjectFact } from '../llm/projectFactsWrite';
import type { FactOriginCost } from '../llm/projectFactsStore';
import type { ExtractedCachePort, KnowledgeStorePort } from './knowledgePorts';
import { bumpKnowledgeVersion } from './knowledgeVersion';

/** Rows (facts + relations + stale marks) one call may carry. */
export const MAX_KNOWLEDGE_WRITE_ROWS = 500;

export class KnowledgeWriteError extends Error {
  constructor(readonly status: 400 | 413, readonly code: string, message: string) {
    super(message);
    this.name = 'KnowledgeWriteError';
  }
}

/** A fact to write. `importance` is scored from the content and `origin` defaults to the
 *  writer's kind when absent (a person → `human`, a machine → `agent`). */
export type KnowledgeFactInput = Omit<StoredFact, 'importance' | 'origin' | 'createdBy' | 'updatedAt'> & {
  importance?: number;
  origin?: StoredFact['origin'];
};

export interface KnowledgeStaleMark {
  sourceRef: NodeRef;
  currentHash: string;
}

export interface KnowledgeWriteInput {
  scope?: ScopeRecord;
  facts?: readonly KnowledgeFactInput[];
  relations?: readonly StoredRelation[];
  stale?: readonly KnowledgeStaleMark[];
}

export interface WriteKnowledgeDeps {
  env: Env;
  db: Db;
  tenantId: number;
  projectId: number;
  store: KnowledgeStorePort;
  blobs: ExtractedCachePort;
  /** The person writing (a JWT's user), or null for an agent host / machine token. Decides
   *  which origins the call may write, and is recorded as a human fact's author. */
  userId: string | null;
  /**
   * The single-fact facts route keeps its long-standing semantics: provenance from the
   * chat/execution, and the single-subject anchor sweep (a fact about one file corrects an
   * older one about the same file). Absent for knowledge writes.
   */
  legacyFact?: { originExecutionId?: number | null; origin?: FactOriginCost | null; retireByAnchor: true };
}

export interface KnowledgeWriteResult {
  factsWritten: number;
  relationsWritten: number;
  staleMarked: number;
}

type WrittenOrigin = StoredFact['origin'] | StoredRelation['origin'];

/** Whether a writer (`userId` = the person, null = a machine) may record `origin`. */
export function originAllowed(origin: WrittenOrigin, userId: string | null): boolean {
  if (origin === 'human') return userId != null;
  if (origin === 'agent') return userId == null;
  return origin === 'model';
}

function assertWritable(input: KnowledgeWriteInput, userId: string | null): void {
  const rows = (input.facts?.length ?? 0) + (input.relations?.length ?? 0) + (input.stale?.length ?? 0);
  if (rows > MAX_KNOWLEDGE_WRITE_ROWS) {
    throw new KnowledgeWriteError(413, 'too_many_rows', `a knowledge write carries at most ${MAX_KNOWLEDGE_WRITE_ROWS} rows (got ${rows})`);
  }
  const extracted = [...(input.facts ?? []), ...(input.relations ?? [])].some((x) => (x.origin as string | undefined) === 'extracted');
  if (extracted) {
    throw new KnowledgeWriteError(400, 'extracted_not_stored', "origin 'extracted' is perception: it is recomputed from sources and never stored");
  }
  const claimed = [...(input.facts ?? []), ...(input.relations ?? [])]
    .map((x) => x.origin)
    .find((origin): origin is WrittenOrigin => origin != null && !originAllowed(origin, userId));
  if (claimed) {
    const who = userId ? 'a person' : 'a machine caller';
    throw new KnowledgeWriteError(400, 'origin_mismatch', `origin '${claimed}' cannot be written by ${who}`);
  }
}

export async function writeKnowledge(deps: WriteKnowledgeDeps, input: KnowledgeWriteInput): Promise<KnowledgeWriteResult> {
  assertWritable(input, deps.userId);
  const { env, db, tenantId, projectId, store, blobs, userId } = deps;
  const result: KnowledgeWriteResult = { factsWritten: 0, relationsWritten: 0, staleMarked: 0 };
  const defaultOrigin: StoredFact['origin'] = userId ? 'human' : 'agent';

  try {
    for (const f of input.facts ?? []) {
      const origin = f.origin ?? defaultOrigin;
      const ok = await upsertProjectFact(env, db, tenantId, projectId, f.key, f.content, f.source || 'knowledge', {
        ...(f.importance != null ? { importance: f.importance } : {}),
        ...(f.fileAnchors?.length ? { fileAnchors: f.fileAnchors } : {}),
        factOrigin: origin,
        createdBy: origin === 'human' ? userId : null,
        retireByAnchor: deps.legacyFact?.retireByAnchor ?? false,
        deferVersionBump: true,
        ...(deps.legacyFact?.originExecutionId != null ? { originExecutionId: deps.legacyFact.originExecutionId } : {}),
        ...(deps.legacyFact?.origin ? { origin: deps.legacyFact.origin } : {}),
      });
      if (ok) result.factsWritten += 1;
    }

    result.relationsWritten = await store.upsertRelations(input.relations ?? [], userId);

    for (const mark of input.stale ?? []) {
      result.staleMarked += await store.markRelationsStale(mark.sourceRef, mark.currentHash);
      await blobs.setSource(mark.sourceRef, mark.currentHash);
    }

    if (input.scope?.lastDigest) await blobs.snapshotReview(input.scope.rootId, input.scope.lastDigest);
    if (input.scope) await store.upsertScope(input.scope);
  } finally {
    // One bump for the whole call — also when it failed part-way, since what landed before
    // the failure must not be hidden behind a cached graph.
    await bumpKnowledgeVersion(env, tenantId, projectId);
  }
  return result;
}

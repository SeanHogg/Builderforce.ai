/**
 * Uploaded PERCEPTION (PRD 38 §4.8): a host's extracted output by content hash, and the
 * code pack's analyzer snapshot by commit. Both are immutable per key and never memory —
 * but both change what a root's graph draws, so each upload bumps the knowledge version
 * (a cached graph keyed on the old token is never served again).
 */
import type { Extracted } from '@seanhogg/builderforce-memory/knowledge';
import type { Env } from '../../env';
import { r2AnalysisSnapshots } from './knowledgeBlobs';
import type { ExtractedCachePort, KnowledgeStorePort } from './knowledgePorts';
import { clampExtracted } from './knowledgePrivacy';
import { KnowledgeWriteError } from './knowledgeWriteError';
import { bumpKnowledgeVersion } from './knowledgeVersion';

/** Bytes an analysis snapshot may take (`PUT …/code-analysis/:sha`). */
export const MAX_ANALYSIS_SNAPSHOT_BYTES = 2 * 1024 * 1024;
/** Bytes one hash's extracted output may take (`PUT …/knowledge/extracted/:hash`). */
export const MAX_EXTRACTED_BYTES = 1024 * 1024;

/** A content hash (hex, or a root-level `~tag:hash`) or a commit sha. */
export const KNOWLEDGE_HASH_PATTERN = /^~?[A-Za-z0-9._:-]{1,160}$/;

interface Scope { env: Env; tenantId: number; projectId: number }

/**
 * Stores a host's extracted output. The SERVER marks staleness itself (§5.2): the output
 * names each source's new hash, so model relations judged from that source at another,
 * known hash get `stale_at` here rather than trusting a host to say so.
 *
 * The object at `hash` is replaced WHOLE, so two things keep one file's upload from
 * touching another's relations:
 *   • every entry must itself be at `hash` (400 `source_hash_mismatch` otherwise) — the
 *     route's hash IS the content hash the entries were extracted at;
 *   • only a source NEW to the object is marked: one the object already held at this hash
 *     is unchanged by a re-upload (files sharing a hash — e.g. several empty files — share
 *     the object, and a later file joining it says nothing about the earlier ones).
 * A root-level output (`~tag:…`) is not a source's content, so nothing is marked for it.
 * Node labels are reduced to one line first — extracted output is structure, never source text.
 */
export async function putExtracted(
  deps: Scope & { extracted: ExtractedCachePort; store: Pick<KnowledgeStorePort, 'markRelationsStale'> },
  hash: string,
  extracted: readonly Extracted[],
): Promise<void> {
  const stray = extracted.find((e) => e.sourceHash !== hash);
  if (stray) {
    throw new KnowledgeWriteError(
      400, 'source_hash_mismatch',
      `extracted output for ${stray.sourceRef} is at hash '${stray.sourceHash}', not the '${hash}' it was uploaded under`,
    );
  }
  const held = new Set(((await deps.extracted.get(hash)) ?? []).map((e) => e.sourceRef));
  await deps.extracted.put(hash, clampExtracted(extracted));
  try {
    if (hash.startsWith('~')) return;
    for (const entry of extracted) {
      if (!held.has(entry.sourceRef)) await deps.store.markRelationsStale(entry.sourceRef, hash);
    }
  } finally {
    await bumpKnowledgeVersion(deps.env, deps.tenantId, deps.projectId);
  }
}

export async function putAnalysisSnapshot(deps: Scope, sha: string, rootId: string, snapshot: unknown): Promise<void> {
  await r2AnalysisSnapshots(deps.env, deps.tenantId, deps.projectId).put(sha, rootId, snapshot);
  await bumpKnowledgeVersion(deps.env, deps.tenantId, deps.projectId);
}

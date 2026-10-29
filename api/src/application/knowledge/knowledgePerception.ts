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
 * known hash get `stale_at` here rather than trusting a host to say so. Node labels are
 * reduced to one line first — extracted output is structure, never source text.
 */
export async function putExtracted(
  deps: Scope & { extracted: ExtractedCachePort; store: Pick<KnowledgeStorePort, 'markRelationsStale'> },
  hash: string,
  extracted: readonly Extracted[],
): Promise<void> {
  await deps.extracted.put(hash, clampExtracted(extracted));
  try {
    for (const entry of extracted) {
      await deps.store.markRelationsStale(entry.sourceRef, entry.sourceHash);
    }
  } finally {
    await bumpKnowledgeVersion(deps.env, deps.tenantId, deps.projectId);
  }
}

export async function putAnalysisSnapshot(deps: Scope, sha: string, rootId: string, snapshot: unknown): Promise<void> {
  await r2AnalysisSnapshots(deps.env, deps.tenantId, deps.projectId).put(sha, rootId, snapshot);
  await bumpKnowledgeVersion(deps.env, deps.tenantId, deps.projectId);
}

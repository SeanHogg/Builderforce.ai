/**
 * Uploaded PERCEPTION (PRD 38 §4.8): the code pack's analyzer snapshot by commit, and the limits and hash rule of the
 * extracted-output read routes. Extracted output itself arrives only through pack sync (`sync/`), which sanitises and
 * clamps it (`knowledgePrivacy.ts`). The snapshot is immutable per key and never memory — but it changes what a root's
 * graph draws, so each upload bumps the knowledge version (a cached graph keyed on the old token is never served again).
 */
import type { Env } from '../../env';
import { r2AnalysisSnapshots } from './knowledgeBlobs';
import { bumpKnowledgeVersion } from './knowledgeVersion';

/** Bytes an analysis snapshot may take (`PUT …/code-analysis/:sha`). */
export const MAX_ANALYSIS_SNAPSHOT_BYTES = 2 * 1024 * 1024;
/** Bytes one hash's extracted output may take (the bulk read's budget is a multiple of it). */
export const MAX_EXTRACTED_BYTES = 1024 * 1024;

/** A content hash (hex, or a root-level `~tag:hash`) or a commit sha. */
export const KNOWLEDGE_HASH_PATTERN = /^~?[A-Za-z0-9._:-]{1,160}$/;

interface Scope { env: Env; tenantId: number; projectId: number }

export async function putAnalysisSnapshot(deps: Scope, sha: string, rootId: string, snapshot: unknown): Promise<void> {
  await r2AnalysisSnapshots(deps.env, deps.tenantId, deps.projectId).put(sha, rootId, snapshot);
  await bumpKnowledgeVersion(deps.env, deps.tenantId, deps.projectId);
}

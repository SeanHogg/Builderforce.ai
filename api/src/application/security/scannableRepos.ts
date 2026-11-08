/**
 * scannableRepos — the connected repositories a "Run scan" action may target: this workspace's own
 * repos with a linked credential whose segment IS the caller's segment (a repo with no segment is not
 * offered: it is nobody's to scan from here). Nothing else is offered, which is what keeps the
 * scanner least-privilege over "the Segment's connected repos only" (PRD 08 §10).
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projectRepositories } from '../../infrastructure/database/schema';

export async function listScannableRepos(db: Db, scope: { tenantId: number; segmentId: string }) {
  return db
    .select({
      id: projectRepositories.id,
      provider: projectRepositories.provider,
      owner: projectRepositories.owner,
      repo: projectRepositories.repo,
      defaultBranch: projectRepositories.defaultBranch,
    })
    .from(projectRepositories)
    .where(and(
      eq(projectRepositories.tenantId, scope.tenantId),
      eq(projectRepositories.segmentId, scope.segmentId),
      isNotNull(projectRepositories.credentialId),
    ))
    .limit(200);
}

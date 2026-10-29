/**
 * retireFacts — what a SYSTEM removal of project facts (the expiry purge) owes the knowledge
 * graph (PRD 38 §8.3): the relations that name the removed facts go with them, and each
 * affected project's knowledge version is bumped so no cached graph keeps drawing them.
 * A person's delete goes through `deleteKnowledgeFact` instead (it also applies the
 * author/admin rule); both share the same store step, `deleteRelationsOf`.
 */
import { factRef } from '@seanhogg/builderforce-memory/knowledge';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { bumpKnowledgeVersion } from './knowledgeVersion';
import { knowledgeWritePortsFor } from './knowledgeWritePorts';

export interface RemovedFact { tenantId: number; projectId: number; key: string }

/** Best-effort per project: one failing project must not leave later ones with dangling edges. */
export async function retireRelationsOfRemovedFacts(env: Env, db: Db, removed: readonly RemovedFact[]): Promise<void> {
  const byProject = new Map<string, { tenantId: number; projectId: number; keys: string[] }>();
  for (const r of removed) {
    const id = `${r.tenantId}:${r.projectId}`;
    const entry = byProject.get(id) ?? { tenantId: r.tenantId, projectId: r.projectId, keys: [] };
    entry.keys.push(r.key);
    byProject.set(id, entry);
  }
  for (const { tenantId, projectId, keys } of byProject.values()) {
    try {
      const { store } = knowledgeWritePortsFor(env, db, tenantId, projectId);
      await store.deleteRelationsOf(keys.map(factRef));
    } catch (error) {
      reportCaughtError(error, { source: 'knowledge/retireFacts', operation: 'delete-relations', level: 'error', context: { tenantId, projectId } });
    }
    await bumpKnowledgeVersion(env, tenantId, projectId).catch((error: unknown) => {
      reportCaughtError(error, { source: 'knowledge/retireFacts', operation: 'bump-version', level: 'warning', context: { tenantId, projectId } });
    });
  }
}

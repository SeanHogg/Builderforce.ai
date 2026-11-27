/**
 * A repo-less cloud run's working tree: the project's IDE workspace (ticket 3089).
 *
 * A Brain / zero-setup project has no git, so the repo tools have nothing to commit to.
 * The IDE workspace (R2, `ide/r2WorkspaceFs.ts`) IS that project's working tree, and
 * the run reads, searches and writes it through the same shared tool definitions — only
 * the backing changes. Every write takes the same implicit coordination lease a repo
 * write takes (`guardRepoWrite`), keyed on the workspace, so two runs on one project
 * cannot silently revert each other.
 *
 * This backing used to exist only in the container image's `write` op, so a durable run
 * on a repo-less project was told to paste its deliverable into the summary instead. The
 * one engine now backs every run the same way.
 */
import type { CapabilityProvider } from '@builderforce/agent-tools';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { guardRepoWrite } from '../../coordination/coordinationCapability';
import type { LeaseHolder } from '../../coordination/leaseService';
import { coordinationScopeKey } from '../../../domain/coordination/resourceKey';
import { recordCloudToolEvent } from '../cloudToolEvents';
import { recordWrittenHash, type WrittenFileHashes } from './writtenFileHashes';
import { notifyExecutionSubscribers } from '../executionEvents';
import type { IdeWorkspaceRun } from './ideWorkspaceCoding';
import { r2Capabilities, r2WorkspaceFs } from '../../ide/r2WorkspaceFs';
import { applyTaskWorkspaceChanges } from '../../ide/taskWorkspaceTarget';

export interface IdeWorkspaceRunRef {
  tenantId: number;
  taskId: number;
  executionId: number;
  agentLabel: string;
  cloudAgentRef?: string;
  /** The run's live set of written paths (the verify / finalize tail reads it). */
  writtenPaths: Set<string>;
  /** Content hash per written file; set for a full write (an edit's resulting text isn't returned, so it falls back). */
  writtenHashes?: WrittenFileHashes;
}

/** `provider` with its repo read/write backed by the IDE workspace. */
export function withIdeWorkspace(
  provider: CapabilityProvider,
  ide: IdeWorkspaceRun,
  run: IdeWorkspaceRunRef,
  deps: { env: Env; db: Db },
): CapabilityProvider {
  const { db } = deps;
  // The shared coding provider over this project's R2 workspace; writes keep the store's path/content
  // contract, history and the ticket's file-change record through `applyTaskWorkspaceChanges`.
  const { repoRead, repoWrite } = r2Capabilities(r2WorkspaceFs(ide.bucket, ide.projectId, {
    applyChanges: (changes) => applyTaskWorkspaceChanges(db, ide.bucket, {
      tenantId: run.tenantId, taskId: run.taskId, executionId: run.executionId, agent: run.agentLabel,
      projectId: ide.projectId, changes,
    }),
  }));
  /** Hash what the run left: read back, so an edit (or an EOL-conformed write) hashes the stored text. */
  const recordLeft = async (path: string): Promise<void> => {
    if (!run.writtenHashes) return;
    const left = await repoRead.readFile(path);
    if (left.ok && typeof left.content === 'string') await recordWrittenHash(run.writtenHashes, path, left.content);
    // Unreadable: drop any earlier hash rather than keep a stale one.
    else run.writtenHashes.delete(path);
  };
  const changed = (path: string, change: 'created' | 'modified' | 'deleted') => {
    if (change === 'deleted') { run.writtenPaths.delete(path); run.writtenHashes?.delete(path); } else run.writtenPaths.add(path);
    notifyExecutionSubscribers(run.executionId, { type: 'file_change', executionId: run.executionId, path, change, ts: new Date().toISOString() });
  };
  const holder: LeaseHolder = {
    tenantId: run.tenantId, executionId: run.executionId, label: run.agentLabel, taskId: run.taskId,
    repoSlug: `workspace:${ide.projectId}`, branch: 'workspace', scopeKey: coordinationScopeKey(run.taskId),
  };
  return {
    ...provider,
    repoRead,
    repoWrite: guardRepoWrite({
      async writeFile(path, content) {
        const r = await repoWrite.writeFile(path, content);
        if (r.ok) {
          changed(path, r.change ?? 'modified');
          await recordLeft(path);
        }
        return r;
      },
      async editFile(path, oldString, newString, replaceAll) {
        const r = await repoWrite.editFile(path, oldString, newString, replaceAll);
        if (r.ok) {
          changed(path, 'modified');
          await recordLeft(path);
        }
        return r;
      },
      async deleteFile(path) {
        const r = await repoWrite.deleteFile(path);
        if (r.ok && r.deleted) changed(path, 'deleted');
        return r;
      },
    }, {
      ...deps,
      holder,
      onRefused: (path, heldBy) => {
        void recordCloudToolEvent(db, {
          tenantId: run.tenantId, cloudAgentRef: run.cloudAgentRef, executionId: run.executionId,
          toolName: 'coordination.refused', category: 'tool',
          detail: { path, heldBy }, result: `write to '${path}' refused — held by ${heldBy}`,
        }).catch(() => undefined);
      },
    }),
  };
}

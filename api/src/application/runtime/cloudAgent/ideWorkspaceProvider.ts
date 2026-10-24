/**
 * A repo-less cloud run's working tree: the project's IDE workspace (ticket 3089).
 *
 * A Brain / zero-setup project has no git, so the repo tools have nothing to commit to.
 * The IDE workspace (R2, `ideWorkspaceCoding.ts`) IS that project's working tree, and
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
import { notifyExecutionSubscribers } from '../executionEvents';
import {
  deleteIdeWorkspaceFile, editIdeWorkspaceFile, listIdeWorkspaceFiles, readIdeWorkspaceFile, searchIdeWorkspace,
  writeIdeWorkspaceFile, type IdeWorkspaceRun,
} from './ideWorkspaceCoding';

export interface IdeWorkspaceRunRef {
  tenantId: number;
  taskId: number;
  executionId: number;
  agentLabel: string;
  cloudAgentRef?: string;
  /** The run's live set of written paths (the verify / finalize tail reads it). */
  writtenPaths: Set<string>;
}

/** `provider` with its repo read/write backed by the IDE workspace. */
export function withIdeWorkspace(
  provider: CapabilityProvider,
  ide: IdeWorkspaceRun,
  run: IdeWorkspaceRunRef,
  deps: { env: Env; db: Db },
): CapabilityProvider {
  const { db } = deps;
  const who = { tenantId: run.tenantId, taskId: run.taskId, executionId: run.executionId, agent: run.agentLabel };
  const changed = (path: string, change: 'created' | 'modified' | 'deleted') => {
    if (change === 'deleted') run.writtenPaths.delete(path); else run.writtenPaths.add(path);
    notifyExecutionSubscribers(run.executionId, { type: 'file_change', executionId: run.executionId, path, change, ts: new Date().toISOString() });
  };
  const holder: LeaseHolder = {
    tenantId: run.tenantId, executionId: run.executionId, label: run.agentLabel, taskId: run.taskId,
    repoSlug: `workspace:${ide.projectId}`, branch: 'workspace', scopeKey: coordinationScopeKey(run.taskId),
  };
  return {
    ...provider,
    repoRead: {
      listFiles: (subdir, glob) => listIdeWorkspaceFiles(ide.bucket, ide.projectId, subdir, glob),
      readFile: (path) => readIdeWorkspaceFile(ide.bucket, ide.projectId, path),
      searchCode: (query, scope) => searchIdeWorkspace(ide.bucket, ide.projectId, query, scope),
    },
    repoWrite: guardRepoWrite({
      async writeFile(path, content) {
        const r = await writeIdeWorkspaceFile(db, ide, { ...who, path, content });
        if (r.ok) changed(path, r.change ?? 'modified');
        return r;
      },
      async editFile(path, oldString, newString, replaceAll) {
        const r = await editIdeWorkspaceFile(db, ide, { ...who, path, oldString, newString, ...(replaceAll !== undefined ? { replaceAll } : {}) });
        if (r.ok) changed(path, 'modified');
        return r;
      },
      async deleteFile(path) {
        const r = await deleteIdeWorkspaceFile(db, ide, { ...who, path });
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

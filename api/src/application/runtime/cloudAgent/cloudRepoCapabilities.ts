/**
 * The cloud run's repo capabilities: the git remote (`repos/gitRemoteFs.ts`) behind the ONE coding
 * provider (`@builderforce/agent-tools/workspace`), wrapped in what only a cloud run does around it.
 *
 * Around reads: the credential gate, the repeat-read memo, the context-contribution record.
 * Around writes: the credential gate, the outbound-secret inspection, the written-path and hash
 * bookkeeping, the repo-set router (a task bound to 2+ repos routes each write to the repo whose
 * path globs claim it), the `task_file_changes` row and the live `file_change` event. The coordination
 * lease (`guardRepoWrite`) wraps the returned `repoWrite` in `cloudProvider.ts`.
 */
import type { RepoReadCapability, RepoWriteCapability } from '@builderforce/agent-tools';
import { createRepoCapabilities, WorkspaceError, type WorkspaceFs } from '@builderforce/agent-tools/workspace';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { integrationCredentialSecret } from '../../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import type { TicketRepoContext } from '../../repos/commitFileAsPendingChange';
import { gitRemoteFs, type GitRemoteFs } from '../../repos/gitRemoteFs';
import { editRefusalForTruncated } from '../../repos/truncationMessages';
import { recordRepoWrite, resolveTaskRepoRouter, type TaskRepoRouter } from '../../repos/taskRepoSet';
import { inspectOutboundContent, recordContextContribution } from '../../trust/trustService';
import { withListingSignal } from '../../workspaceFs/flatListing';
import { notifyExecutionSubscribers } from '../executionEvents';
import { agentCommitMessage, recordTaskFileChange } from './prd';
import { recordWrittenHash, type WrittenFileHashes } from './writtenFileHashes';

const NO_CREDENTIAL = 'repository credential delegation is absent, expired, or revoked';

export interface CloudRepoArgs {
  env: Env;
  db: Db;
  tenantId: number;
  executionId: number;
  taskRow: { id: number };
  agentLabel: string;
  repoCtx: TicketRepoContext | null;
  repoMiss: string;
  /** Live set of paths written this run (mutated by write/delete). */
  writtenPaths: Set<string>;
  /** Content hash of each written file as the run left it (mutated alongside `writtenPaths`). */
  writtenHashes?: WrittenFileHashes;
  /** The ref reads come from: the base before the first write, the ticket branch after (or a replay's pin). */
  readRef: () => string;
  credentialAllowed: (scope: 'repository:read' | 'repository:write') => Promise<boolean>;
}

type Remote = { fs: GitRemoteFs; repoRead: RepoReadCapability; repoWrite: RepoWriteCapability };

export function buildCloudRepoCapabilities(a: CloudRepoArgs): { repoRead: RepoReadCapability; repoWrite: RepoWriteCapability } {
  const { env, db, tenantId, executionId, taskRow, agentLabel, repoCtx, repoMiss, writtenPaths, writtenHashes } = a;
  // Every commit names its RUN as well as its task (PRD 41 §D1): the per-run marker is what
  // teardown/revert authorship and the run's commit attribution at finalize match on.
  const commitRun = { taskId: taskRow.id, executionId };
  const noRepo = (suffix = ''): string => `no repo bound to this task (${repoMiss})${suffix}`;
  /** null = proceed; a string = refuse with it. */
  const gate = async (scope: 'repository:read' | 'repository:write', noRepoSuffix = ''): Promise<string | null> =>
    !repoCtx ? noRepo(noRepoSuffix) : (await a.credentialAllowed(scope)) ? null : NO_CREDENTIAL;

  // ── REPEAT-READ GUARD ──────────────────────────────────────────────────────
  // A model that re-reads a file it already holds pays for it twice: a git-API round trip here and
  // a `recordContextContribution` row per repeat. An identical repeat is served from the first
  // result, keyed by (ref, path): the base-to-branch switch is a different key, every write to a
  // path drops its entries, and a FAILED read is never memoized. Only `read_file` consults it; the
  // probe a write or edit makes goes straight to the remote, because it must see the CURRENT bytes.
  // It saves the read's I/O and DB cost, not the model's context tokens, and lives as long as this
  // provider (one tick): carrying it across ticks would need file CONTENT in `CloudLoopState`.
  const readMemo = new Map<string, { path: string; content: string; truncated?: boolean }>();
  const forgetReads = (path: string): void => {
    for (const [key, cached] of readMemo) if (cached.path === path) readMemo.delete(key);
  };

  // MULTI-REPO SPANNING (0956). `repoCtx` is the task's PRIMARY repo. The router is resolved LAZILY
  // and exactly once per run: a single-repo task pays one indexed read on its first write and gets
  // `forPath() === repoCtx`.
  let routerPromise: Promise<TaskRepoRouter> | null = null;
  const repoFor = async (path: string): Promise<TicketRepoContext> => {
    if (!repoCtx) throw new WorkspaceError('io', noRepo());
    routerPromise ??= resolveTaskRepoRouter(db, integrationCredentialSecret(env), tenantId, taskRow.id, { ctx: repoCtx, reason: repoMiss });
    const router = await routerPromise.catch((error) => {
      reportCaughtError(error, { source: 'application/runtime/cloudAgent/cloudRepoCapabilities.ts', operation: 'repoFor', context: { logMessage: '[cloud-write] repo-set resolution failed — routing to the primary repo', details: { tenantId, taskId: taskRow.id, error } } });
      return null;
    });
    return router?.forPath(path) ?? repoCtx;
  };

  // What the commit message needs beyond the path: an edit says "Edit", a delete carries the model's reason.
  const intent = new Map<string, { edit?: true; reason?: string }>();
  const message = (op: 'write' | 'delete', path: string): string => {
    const i = intent.get(path);
    if (op === 'delete') return agentCommitMessage('Remove', path, commitRun, agentLabel, i?.reason ? ` — ${i.reason}` : '');
    return agentCommitMessage(writtenPaths.has(path) ? 'Update' : i?.edit ? 'Edit' : 'Add', path, commitRun, agentLabel);
  };

  // One adapter (and one cached tree) per repo of the set. The primary reads at `readRef()`; another
  // repo's ticket branch may not exist yet, so it reads its branch and falls back to its base.
  const remotes = new Map<string, Remote>();
  const remoteFor = (target: TicketRepoContext): Remote => {
    const key = `${target.owner}/${target.repo}`;
    const known = remotes.get(key);
    if (known) return known;
    const primary = !!repoCtx && key === `${repoCtx.owner}/${repoCtx.repo}`;
    const git = gitRemoteFs(target, { readRef: primary ? a.readRef : () => target.branch, ...(primary ? {} : { fallbackRef: target.base }), message });
    // Outbound content is inspected for secrets before ANY commit: a write's body or an edit's result.
    const fs: WorkspaceFs = {
      ...git,
      async write(path, content) {
        const inspection = await inspectOutboundContent(db, { tenantId, executionId, seam: 'repository_write', target: path, content });
        if (!inspection.ok) throw new WorkspaceError('io', `Outbound content blocked: ${inspection.reasons.join(', ')}. Remove credential material; never commit secrets.`);
        return git.write(path, content);
      },
    };
    const caps = createRepoCapabilities(fs);
    const remote: Remote = { fs: git, repoRead: withListingSignal(caps.repoRead, { incomplete: git.listingIncomplete, ref: a.readRef }), repoWrite: caps.repoWrite };
    remotes.set(key, remote);
    return remote;
  };
  const primaryRemote = (): Remote => remoteFor(repoCtx!);

  /** The run's bookkeeping after a commit landed in `target`. */
  const landed = async (remote: Remote, target: TicketRepoContext, path: string, change: 'created' | 'modified' | 'deleted'): Promise<{ branch: string; commitUrl?: string }> => {
    const commit = remote.fs.takeCommit(path);
    if (change === 'deleted') { writtenPaths.delete(path); writtenHashes?.delete(path); } else {
      writtenPaths.add(path);
      if (writtenHashes && commit?.content !== undefined) await recordWrittenHash(writtenHashes, path, commit.content);
    }
    // The run just changed this path: a memoized read of it would hand the model bytes from before its own edit.
    forgetReads(path);
    await recordRepoWrite(db, tenantId, taskRow.id, target);
    await recordTaskFileChange(db, tenantId, taskRow.id, executionId, path, change, agentLabel, commit?.commitSha);
    notifyExecutionSubscribers(executionId, { type: 'file_change', executionId, path, change, ts: new Date().toISOString() });
    return { branch: target.branch, ...(commit?.commitUrl ? { commitUrl: commit.commitUrl } : {}) };
  };

  const repoRead: RepoReadCapability = {
    async listFiles(sub, glob, listOpts) {
      const refused = await gate('repository:read');
      return refused ? { ok: false, error: refused } : primaryRemote().repoRead.listFiles(sub, glob, listOpts);
    },
    async readFile(path) {
      const refused = await gate('repository:read');
      if (refused) return { ok: false, error: refused };
      const ref = a.readRef();
      const memoKey = `${ref}\u0000${path}`;
      const memo = readMemo.get(memoKey);
      if (memo) return { ok: true, path: memo.path, content: memo.content, truncated: memo.truncated };
      const rf = await primaryRemote().repoRead.readFile(path);
      if (rf.ok && typeof rf.content === 'string') {
        readMemo.set(memoKey, { path: rf.path ?? path, content: rf.content, ...(rf.truncated === true ? { truncated: true } : {}) });
        await recordContextContribution(db, { tenantId, executionId, sourceKind: 'repository_file', sourceRef: `${repoCtx!.owner}/${repoCtx!.repo}:${path}`, trustTier: 'repository', content: rf.content });
      }
      return rf;
    },
    async searchCode(query, scope, searchOpts) {
      const refused = await gate('repository:read');
      return refused ? { ok: false, error: refused } : primaryRemote().repoRead.searchCode(query, scope, searchOpts);
    },
  };

  const repoWrite: RepoWriteCapability = {
    async writeFile(path, content, _summary) {
      const refused = await gate('repository:write', '; include the file contents in your final summary instead');
      if (refused) return { ok: false, error: refused };
      const target = await repoFor(path);
      const remote = remoteFor(target);
      const r = await remote.repoWrite.writeFile(path, content);
      // created vs modified is whether the path pre-existed on the branch, not first-write-this-run.
      return r.ok ? { ...r, ...(await landed(remote, target, path, r.change ?? 'modified')) } : r;
    },
    async editFile(path, oldString, newString, replaceAll) {
      const refused = await gate('repository:write');
      if (refused) return { ok: false, error: refused };
      // The edit reads from the repo the write will land in, so a spanning task edits the file it is about to commit.
      const target = await repoFor(path);
      const remote = remoteFor(target);
      intent.set(path, { edit: true });
      const r = await remote.repoWrite.editFile(path, oldString, newString, replaceAll).finally(() => intent.delete(path));
      if (r.ok) return { ...r, ...(await landed(remote, target, path, 'modified')) };
      if (r.code === 'too_large') return { ...r, error: editRefusalForTruncated(path, remote.fs.truncationReason(path)) };
      return r.code === 'io' ? r : { ...r, error: `cannot edit '${path}': ${r.error}` };
    },
    async deleteFile(path, reason) {
      const refused = await gate('repository:write');
      if (refused) return { ok: false, error: refused };
      const target = await repoFor(path);
      const remote = remoteFor(target);
      intent.set(path, { ...(reason?.trim() ? { reason: reason.trim() } : {}) });
      const r = await remote.repoWrite.deleteFile(path).finally(() => intent.delete(path));
      return r.ok && r.deleted ? { ...r, ...(await landed(remote, target, path, 'deleted')) } : r;
    },
  };

  return { repoRead, repoWrite };
}

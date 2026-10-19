/**
 * Ticket 3089 runtime half — cloud/board durable + container runs write the
 * IDE workspace when no git repo is bound.
 *
 * Create-time routing lives in `ensureProjectCodingTarget`. Host dispatch already
 * uses `taskWorkspaceTarget`. The remaining hole was the cloud tool loop: when
 * `resolveTicketRepoContext` missed, `write_file` told the model to dump the
 * deliverable in its summary. Scratch-repo-at-create is rejected (Brain tenants
 * have no git provider). This module is the R2 working-tree substitute.
 */
import { matchGlobInScope, isUnderScopeDir, normalizeScopeDir, emptyGlobListingNote, applyStringEdit, editFacts } from '@builderforce/agent-tools';
import type {
  RepoListResult, RepoReadResult, RepoSearchResult, RepoWriteResult, RepoDeleteResult, RepoEditResult,
} from '@builderforce/agent-tools';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { ensureProjectCodingTarget } from '../../project/ensureProjectCodingTarget';
import { applyTaskWorkspaceChanges, resolveTaskWorkspaceTarget } from '../../ide/taskWorkspaceTarget';
import { listWorkspaceFiles, readWorkspaceFile, workspacePrefix } from '../../ide/workspaceStore';

/** The R2 workspace a repo-less cloud run writes into. */
export interface IdeWorkspaceRun {
  bucket: R2Bucket;
  projectId: number;
  projectName: string;
}

/** Prompt-facing view of the bound coding target (git, IDE workspace, or neither). */
export interface WorkspacePromptView {
  repo: { owner: string; repo: string; base: string } | null;
  ide?: { projectId: number; projectName: string };
  reason?: string;
  topLevel: string[];
  fileCount: number;
  truncated: boolean;
}

/**
 * Resolve the IDE workspace for a cloud/board run, or null when there is no
 * R2 bucket / no task. Best-effort binds `ide_projects` for older Brain
 * projects that skipped create-time routing (idempotent).
 */
export async function resolveIdeWorkspaceForRun(
  env: Env,
  db: Db,
  tenantId: number,
  taskId: number,
): Promise<IdeWorkspaceRun | null> {
  const bucket = env.UPLOADS;
  if (!bucket) return null;
  const target = await resolveTaskWorkspaceTarget(db, tenantId, taskId);
  if (!target) return null;
  await ensureProjectCodingTarget(db, tenantId, { id: target.projectId }).catch((error) => {
    reportCaughtError(error, {
      source: 'application/runtime/cloudAgent/ideWorkspaceCoding.ts',
      operation: 'ensureProjectCodingTarget',
    });
  });
  return { bucket, projectId: target.projectId, projectName: target.projectName };
}

/** Compact listing the prompt shows so a wrong/empty workspace is visible before any LLM spend. */
export async function snapshotIdeWorkspace(run: IdeWorkspaceRun): Promise<{
  ide: { projectId: number; projectName: string };
  topLevel: string[];
  fileCount: number;
  truncated: boolean;
}> {
  const entries = await listWorkspaceFiles(run.bucket, run.projectId);
  const unique = [...new Set(entries.map((e) => {
    const i = e.path.indexOf('/');
    return i === -1 ? e.path : `${e.path.slice(0, i)}/`;
  }))].sort();
  return {
    ide: { projectId: run.projectId, projectName: run.projectName },
    topLevel: unique.slice(0, 40),
    fileCount: entries.length,
    truncated: unique.length > 40,
  };
}

/** Trust / timeline label for the bound coding target. */
export function workspaceSourceRef(workspace: WorkspacePromptView): string {
  if (workspace.repo) return `${workspace.repo.owner}/${workspace.repo.repo}`;
  if (workspace.ide) return `workspace:${workspace.ide.projectName}`;
  return 'unbound workspace';
}

/**
 * The `## Repository / workspace` prompt block. An IDE workspace is a real
 * working tree — do not tell the model there are "no files to edit".
 */
export function describeWorkspaceBlock(workspace: WorkspacePromptView): string {
  const listing = workspace.topLevel.length
    ? workspace.topLevel.map((p) => `- \`${p}\``).join('\n')
    : '_(empty)_';
  const count = `${workspace.fileCount}${workspace.truncated ? '+' : ''}`;
  if (workspace.repo) {
    const repoLabel = `${workspace.repo.owner}/${workspace.repo.repo}`;
    return `## Repository / workspace\n\n`
      + `Your changes run against **${repoLabel}** (base \`${workspace.repo.base}\`), which currently contains ${count} file(s). Top-level entries:\n\n`
      + listing
      + `\n\nIf these files are clearly UNRELATED to what the task asks for (e.g. the task is about a website but this repo holds none of its code), do NOT invent a conceptual answer or edit unrelated files — say so plainly in your summary, name the bound repository (${repoLabel}), and state that the correct repo must be bound. Explore with list_files / search_code before concluding.`;
  }
  if (workspace.ide) {
    return `## Repository / workspace\n\n`
      + `No git repository is bound. Your working tree is the **IDE workspace** for **${workspace.ide.projectName}**, which currently contains ${count} file(s). `
      + `write_file / edit_file / delete_file land here and appear in the Designer immediately — there is no branch and no pull request. Do NOT dump file contents in your final summary.\n\n`
      + listing;
  }
  return `## Repository / workspace\n\n`
    + `⚠ No repository is bound to this task${workspace.reason ? ` (${workspace.reason})` : ''}, so there are no files to edit. Return the complete deliverable in your final summary and state that a repository must be bound before code can ship.`;
}

/** Closing sentence of the core-tooling prompt: write files, or dump prose only as last resort. */
export function codingTargetToolingLine(workspace: WorkspacePromptView): string {
  if (workspace.ide && !workspace.repo) {
    return 'No git repository is bound. Write files into the IDE workspace with write_file / edit_file — they appear in the Designer immediately. Do NOT dump file contents in your final summary. Make explicit, reasonable assumptions where specifics are unknown.';
  }
  if (workspace.repo) {
    return 'Make explicit, reasonable assumptions where specifics are unknown.';
  }
  return 'If no repository and no IDE workspace is bound, return the complete deliverable in your final summary instead. Make explicit, reasonable assumptions where specifics are unknown.';
}

/** Match cap for a globbed IDE listing. Counts matches, not raw R2 keys, so a
 *  file past the first page is not hidden and then reported as missing. */
const IDE_LIST_MATCH_CAP = 5_000;

export async function listIdeWorkspaceFiles(
  bucket: R2Bucket,
  projectId: number,
  sub?: string,
  glob?: string,
): Promise<RepoListResult> {
  const keyPrefix = workspacePrefix(projectId);
  const scope = normalizeScopeDir(sub);
  const pattern = glob?.trim() ? glob.trim() : undefined;
  const paths: string[] = [];
  let cursor: string | undefined;
  let truncated = false;
  let finished = false;
  const seenCursors = new Set<string>();
  // Page until R2 says the listing is complete. `listWorkspaceFiles` reads one
  // page and drops `truncated`, which made an empty glob look like absence.
  // A repeated cursor or the page budget means the listing never finished —
  // that must stay truncated so an empty glob is not reported as absence.
  for (let pageNo = 0; pageNo < 200; pageNo++) {
    if (cursor) {
      if (seenCursors.has(cursor)) break;
      seenCursors.add(cursor);
    }
    const page = await bucket.list({ prefix: keyPrefix, ...(cursor ? { cursor } : {}) });
    for (const obj of page.objects ?? []) {
      if (!obj.key?.startsWith(keyPrefix)) continue;
      const rel = obj.key.slice(keyPrefix.length);
      if (!rel || rel.endsWith('/')) continue;
      if (scope && !isUnderScopeDir(rel, scope)) continue;
      if (pattern && !matchGlobInScope(rel, pattern, scope)) continue;
      if (paths.length >= IDE_LIST_MATCH_CAP) {
        truncated = true;
        break;
      }
      paths.push(rel);
    }
    if (truncated) break;
    if (!page.truncated || !page.cursor) { finished = true; break; }
    cursor = page.cursor;
  }
  if (!finished) truncated = true;
  paths.sort((a, b) => a.localeCompare(b));
  const note = pattern && paths.length === 0 ? emptyGlobListingNote(pattern, scope, truncated) : undefined;
  return { ok: true, ref: 'workspace', paths, truncated, ...(note ? { note } : {}) };
}

export async function readIdeWorkspaceFile(
  bucket: R2Bucket,
  projectId: number,
  path: string,
): Promise<RepoReadResult> {
  const content = await readWorkspaceFile(bucket, projectId, path);
  if (content === null) return { ok: false, error: `file not found: ${path}` };
  return { ok: true, path, content };
}

export async function searchIdeWorkspace(
  bucket: R2Bucket,
  projectId: number,
  query: string,
  scope?: string,
): Promise<RepoSearchResult> {
  const q = query.trim();
  if (!q) return { ok: false, error: 'query is required' };
  const entries = await listWorkspaceFiles(bucket, projectId);
  const scopeDir = scope?.replace(/\/+$/, '') ?? '';
  const matches: Array<{ path: string; fragments: string[] }> = [];
  let truncated = false;
  const max = 30;
  const needle = q.toLowerCase();
  for (const entry of entries) {
    if (scopeDir && entry.path !== scopeDir && !entry.path.startsWith(`${scopeDir}/`)) continue;
    const content = await readWorkspaceFile(bucket, projectId, entry.path);
    if (content === null) continue;
    const hits: string[] = [];
    for (const line of content.split('\n')) {
      if (line.toLowerCase().includes(needle)) hits.push(line.trim().slice(0, 200));
      if (hits.length >= 3) break;
    }
    if (hits.length === 0) continue;
    if (matches.length >= max) { truncated = true; break; }
    matches.push({ path: entry.path, fragments: hits });
  }
  return { ok: true, query: q, total: matches.length, truncated, matches };
}

export async function writeIdeWorkspaceFile(
  db: Db,
  run: IdeWorkspaceRun,
  args: {
    tenantId: number;
    taskId: number;
    executionId: number;
    agent: string;
    path: string;
    content: string;
  },
): Promise<RepoWriteResult> {
  const existed = (await readWorkspaceFile(run.bucket, run.projectId, args.path)) !== null;
  const applied = await applyTaskWorkspaceChanges(db, run.bucket, {
    tenantId: args.tenantId,
    taskId: args.taskId,
    projectId: run.projectId,
    executionId: args.executionId,
    agent: args.agent,
    changes: { writes: [{ path: args.path, content: args.content }] },
  });
  if (applied.rejected.length) return { ok: false, error: applied.rejected[0]!.reason };
  return {
    ok: true,
    branch: 'workspace',
    change: existed ? 'modified' : 'created',
    note: `wrote to IDE workspace ${run.projectName}`,
  };
}

export async function editIdeWorkspaceFile(
  db: Db,
  run: IdeWorkspaceRun,
  args: {
    tenantId: number;
    taskId: number;
    executionId: number;
    agent: string;
    path: string;
    oldString: string;
    newString: string;
    replaceAll?: boolean;
  },
): Promise<RepoEditResult> {
  const content = await readWorkspaceFile(run.bucket, run.projectId, args.path);
  if (content === null) return { ok: false, error: `cannot edit '${args.path}': file not found` };
  const edit = applyStringEdit(content, args.oldString, args.newString, args.replaceAll);
  if (!edit.ok || edit.content == null) {
    return { ok: false, ...editFacts(edit), error: `cannot edit '${args.path}': ${edit.error ?? 'old_string not found'}` };
  }
  const write = await writeIdeWorkspaceFile(db, run, { ...args, content: edit.content });
  if (!write.ok) return { ok: false, error: write.error };
  return { ok: true, branch: 'workspace', change: 'modified', ...editFacts(edit), note: write.note };
}

export async function deleteIdeWorkspaceFile(
  db: Db,
  run: IdeWorkspaceRun,
  args: {
    tenantId: number;
    taskId: number;
    executionId: number;
    agent: string;
    path: string;
  },
): Promise<RepoDeleteResult> {
  const existed = (await readWorkspaceFile(run.bucket, run.projectId, args.path)) !== null;
  if (!existed) {
    return { ok: true, deleted: false, note: `'${args.path}' is not in the workspace, so there is nothing to delete.` };
  }
  const applied = await applyTaskWorkspaceChanges(db, run.bucket, {
    tenantId: args.tenantId,
    taskId: args.taskId,
    projectId: run.projectId,
    executionId: args.executionId,
    agent: args.agent,
    changes: { deletes: [args.path] },
  });
  if (applied.rejected.length) return { ok: false, error: applied.rejected[0]!.reason };
  return { ok: true, deleted: true, branch: 'workspace', note: `deleted from IDE workspace ${run.projectName}` };
}

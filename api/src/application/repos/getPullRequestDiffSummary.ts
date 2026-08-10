import { and, desc, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { pullRequests, taskFileChanges } from '../../infrastructure/database/schema';
import { isDocumentationPath } from '../delivery/deliverableEvidence';
import { isResolveError, resolveRepoCredential } from './resolveRepoCredential';

export type DiffFileCategory = 'code' | 'test' | 'docs' | 'config' | 'migration' | 'asset' | 'other';

export interface ProviderDiffFile {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  previous_filename?: string;
}

export interface CategorizedDiffFile {
  path: string;
  previousPath: string | null;
  status: string;
  category: DiffFileCategory;
  additions: number | null;
  deletions: number | null;
  changes: number | null;
}

const CODE_EXT = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|kts|swift|php|cs|cpp|cc|cxx|c|h|hpp|scala|vue|svelte)$/i;
const CONFIG_EXT = /\.(?:json|jsonc|ya?ml|toml|ini|conf|config|properties)$/i;
const ASSET_EXT = /\.(?:png|jpe?g|gif|webp|svg|ico|avif|mp[34]|wav|ogg|woff2?|ttf|otf|pdf)$/i;

export function classifyDiffPath(path: string): DiffFileCategory {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  if (/(^|\/)(?:__tests__|tests?|test|spec)(\/|$)/.test(normalized)
    || /\.(?:test|spec)\.[^.]+$/i.test(normalized)) return 'test';
  if (/(^|\/)(?:migrations?|db\/migrate)(\/|$)/.test(normalized) || /\.sql$/i.test(normalized)) return 'migration';
  if (isDocumentationPath(normalized)) return 'docs';
  if (CONFIG_EXT.test(normalized)
    || /(^|\/)(?:dockerfile|makefile|wrangler\.toml|tsconfig(?:\.[^/]+)?\.json|package-lock\.json|pnpm-lock\.yaml)$/i.test(normalized)
    || normalized.startsWith('.github/workflows/')) return 'config';
  if (ASSET_EXT.test(normalized)) return 'asset';
  if (CODE_EXT.test(normalized)) return 'code';
  return 'other';
}

export function summarizeDiffFiles(files: ProviderDiffFile[]) {
  const categorized: CategorizedDiffFile[] = files.map((file) => ({
    path: file.filename,
    previousPath: file.previous_filename ?? null,
    status: file.status ?? 'modified',
    category: classifyDiffPath(file.filename),
    additions: file.additions ?? null,
    deletions: file.deletions ?? null,
    changes: file.changes ?? null,
  }));
  const counts: Record<DiffFileCategory, number> = {
    code: 0, test: 0, docs: 0, config: 0, migration: 0, asset: 0, other: 0,
  };
  let additions = 0;
  let deletions = 0;
  for (const file of categorized) {
    counts[file.category] += 1;
    additions += file.additions ?? 0;
    deletions += file.deletions ?? 0;
  }
  const implementationCategories: DiffFileCategory[] = ['code', 'test', 'config', 'migration'];
  return {
    files: categorized,
    totals: { files: categorized.length, additions, deletions, byCategory: counts },
    docsOnly: categorized.length > 0 && categorized.every((file) => file.category === 'docs'),
    codeChanged: categorized.some((file) => implementationCategories.includes(file.category)),
  };
}

const githubApiBase = (host: string | null): string =>
  !host || host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;

async function fetchGithubFiles(
  token: string,
  host: string | null,
  owner: string,
  repo: string,
  number: number,
  fetchFn: typeof fetch,
): Promise<{ files: ProviderDiffFile[]; truncated: boolean }> {
  const files: ProviderDiffFile[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await fetchFn(`${githubApiBase(host)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files?per_page=100&page=${page}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'BuilderForce-PR-Diff-Summary/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error(`GitHub pull-request files returned HTTP ${response.status}`);
    const pageFiles = await response.json() as ProviderDiffFile[];
    files.push(...pageFiles);
    if (pageFiles.length < 100) return { files, truncated: false };
  }
  return { files, truncated: true };
}

export async function getPullRequestDiffSummary(
  db: Db,
  env: Env,
  args: { tenantId: number; taskId?: number; prNumber?: number; projectId?: number },
  fetchFn: typeof fetch = fetch,
) {
  if (!args.taskId && !args.prNumber) throw new Error('taskId or prNumber is required');
  const filters = [eq(pullRequests.tenantId, args.tenantId)];
  if (args.taskId) filters.push(eq(pullRequests.taskId, args.taskId));
  if (args.prNumber) filters.push(eq(pullRequests.number, args.prNumber));
  if (args.projectId) filters.push(eq(pullRequests.projectId, args.projectId));

  const [pr] = await db.select({
    id: pullRequests.id,
    taskId: pullRequests.taskId,
    projectId: pullRequests.projectId,
    repoId: pullRequests.repoId,
    number: pullRequests.number,
    url: pullRequests.url,
    branchName: pullRequests.branchName,
  }).from(pullRequests).where(and(...filters)).orderBy(desc(pullRequests.updatedAt)).limit(1);

  // A task can have a branch before its PR is opened. Its run-attributed file ledger
  // still provides the categorized signal; line totals are unavailable in this mode.
  if (!pr || !pr.repoId || !pr.number) {
    if (!args.taskId) throw new Error('No recorded pull request matched the request');
    const recorded = await db.select({ path: taskFileChanges.path, change: taskFileChanges.change })
      .from(taskFileChanges)
      .where(and(eq(taskFileChanges.tenantId, args.tenantId), eq(taskFileChanges.taskId, args.taskId)))
      .orderBy(desc(taskFileChanges.createdAt));
    if (recorded.length === 0) throw new Error('No pull request or recorded branch changes were found for the task');
    return {
      source: 'task_file_changes' as const,
      taskId: args.taskId,
      projectId: pr?.projectId ?? args.projectId ?? null,
      prNumber: pr?.number ?? null,
      prUrl: pr?.url ?? null,
      branchName: pr?.branchName ?? null,
      truncated: false,
      ...summarizeDiffFiles(recorded.map((file) => ({ filename: file.path, status: file.change }))),
    };
  }

  const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
  const resolved = await resolveRepoCredential(db, secret, args.tenantId, pr.repoId);
  if (isResolveError(resolved)) throw new Error(resolved.error);
  if (resolved.repo.provider !== 'github') throw new Error(`Diff summary is not implemented for provider '${resolved.repo.provider}'`);
  const fetched = await fetchGithubFiles(
    resolved.token, resolved.repo.host, resolved.repo.owner, resolved.repo.repo, pr.number, fetchFn,
  );
  return {
    source: 'github' as const,
    taskId: pr.taskId,
    projectId: pr.projectId,
    prNumber: pr.number,
    prUrl: pr.url,
    branchName: pr.branchName,
    truncated: fetched.truncated,
    ...summarizeDiffFiles(fetched.files),
  };
}

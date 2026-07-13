/**
 * repoBridge — connects the Designer's R2 workspace to a real git repo.
 *
 * R2 stays the authoritative working store for EVERY project (repo-linked or not).
 * A repo link is optional sync on top, built entirely on the existing cloud-native
 * (server-side, GitHub/GitLab/Bitbucket REST) helpers — no on-prem agent host:
 *
 *   • importRepoToWorkspace — clone a repo's files into R2 so an existing repo-mapped
 *     project opens in the Designer like VS Code.
 *   • commitWorkspaceToRepo — push R2 edits back as a branch + PR (or straight to the
 *     default branch for the initial push of a freshly-created repo).
 *   • createRemoteRepo — create a clean remote repo for a project that has none, bind
 *     it, and push the current workspace as the initial commit.
 *
 * Reuses: resolveRepoCredential (repo coords + decrypted token), createRepoSource
 * (tree/content reads), commitFileToRepo/deleteFileFromRepo + createPullRequest
 * (writes). Tenant scoping is the caller's responsibility (routes check
 * projectInTenant); repo/credential lookups here are additionally tenant-scoped.
 */
import { and, eq } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { IDE_PREFIX } from '../project/projectTemplate';
import { resolveRepoCredential, isResolveError } from '../repos/resolveRepoCredential';
import { createRepoSource, makeRepoFetch, isExcludedPath, isBinaryPath, isSecretPath } from '../repos/sources/RepoSource';
import { commitFileToRepo, deleteFileFromRepo } from '../repos/commitFileToRepo';
import { createPullRequest } from '../repos/createPullRequest';
import { decryptCredentials } from '../integrations/credentialCrypto';
import {
  projectRepositories,
  integrationCredentials,
  pullRequests,
  repoBranches,
} from '../../infrastructure/database/schema';
import { buildGitApiBaseUrl } from '../repos/gitProxy';

/** Same precedence the cloud agent path uses for the integration-encryption secret. */
function gitSecret(env: Env): string {
  return (env as { INTEGRATION_ENCRYPTION_SECRET?: string }).INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
}

/** R2 key prefix for a project's Designer workspace. */
function workspacePrefix(projectId: number): string {
  return `${IDE_PREFIX}projects/${projectId}/`;
}

/** Cap how many files we pull from a repo into the workspace (token/subrequest budget). */
const MAX_IMPORT_FILES = 800;
/** Cap how many files a single commit touches (provider call budget). */
const MAX_COMMIT_FILES = 600;

const designerBranch = (projectId: number) => `builderforce/designer-${projectId}`;

export type RepoBridgeResult<T> = { ok: true } & T | { ok: false; status: number; error: string };

/** List every workspace file path + content from R2. */
async function listWorkspace(env: Env, projectId: number): Promise<Array<{ path: string; content: string }>> {
  const bucket = env.UPLOADS;
  if (!bucket) return [];
  const prefix = workspacePrefix(projectId);
  const out: Array<{ path: string; content: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    for (const obj of page.objects ?? []) {
      const path = obj.key!.replace(prefix, '');
      if (!path) continue;
      const body = await bucket.get(obj.key!);
      out.push({ path, content: body ? await body.text() : '' });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/**
 * Import a repo's files into the project's R2 workspace so it opens in the Designer.
 * Skips vendored/binary/secret paths. Stamps the import baseline on the repo row.
 */
export async function importRepoToWorkspace(
  env: Env,
  tenantId: number,
  projectId: number,
  repoId: string,
  ref?: string,
): Promise<RepoBridgeResult<{ imported: number; ref: string; truncated: boolean }>> {
  const db = buildDatabase(env);
  const resolved = await resolveRepoCredential(db, gitSecret(env), tenantId, repoId);
  if (isResolveError(resolved)) return { ok: false, status: resolved.status, error: resolved.error };
  const { repo, token } = resolved;
  if (repo.projectId !== projectId) return { ok: false, status: 400, error: 'Repository is not bound to this project' };

  const src = createRepoSource(repo.provider, { owner: repo.owner, repo: repo.repo, host: repo.host, token }, makeRepoFetch());
  const targetRef = ref?.trim() || repo.defaultBranch || (await src.getDefaultBranch().catch(() => 'main'));

  const tree = await src.getTree(targetRef).catch(() => null);
  if (!tree) return { ok: false, status: 502, error: 'Failed to read repository tree' };

  const files = tree.entries
    .filter((e) => e.type === 'file' && !isExcludedPath(e.path) && !isBinaryPath(e.path) && !isSecretPath(e.path))
    .slice(0, MAX_IMPORT_FILES);

  const bucket = env.UPLOADS;
  if (!bucket) return { ok: false, status: 503, error: 'Storage not configured' };
  const prefix = workspacePrefix(projectId);
  let imported = 0;
  for (const f of files) {
    const content = await src.getFileContent(f.path, targetRef).catch(() => null);
    if (content == null) continue; // oversize/binary/unreadable — skip, don't fail the whole import
    await bucket.put(`${prefix}${f.path}`, content);
    imported += 1;
  }

  await db
    .update(projectRepositories)
    .set({ lastSyncedRef: targetRef, lastSyncedAt: new Date() })
    .where(and(eq(projectRepositories.id, repoId), eq(projectRepositories.tenantId, tenantId)));

  return { ok: true, imported, ref: targetRef, truncated: tree.truncated || files.length >= MAX_IMPORT_FILES };
}

/**
 * Push the R2 workspace back to the repo. Adds/updates every workspace file and
 * deletes repo files no longer present, onto `branch` (default the project's
 * designer branch), then opens/refreshes a PR — UNLESS `branch === base`, in which
 * case it commits straight to the default branch (used for a new repo's first push).
 */
export async function commitWorkspaceToRepo(
  env: Env,
  tenantId: number,
  projectId: number,
  repoId: string,
  opts: { message?: string; branch?: string },
): Promise<RepoBridgeResult<{ branch: string; committed: number; deleted: number; prNumber: number | null; prUrl: string | null }>> {
  const db = buildDatabase(env);
  const resolved = await resolveRepoCredential(db, gitSecret(env), tenantId, repoId);
  if (isResolveError(resolved)) return { ok: false, status: resolved.status, error: resolved.error };
  const { repo, token } = resolved;
  if (repo.projectId !== projectId) return { ok: false, status: 400, error: 'Repository is not bound to this project' };

  const src = createRepoSource(repo.provider, { owner: repo.owner, repo: repo.repo, host: repo.host, token }, makeRepoFetch());
  const base = repo.defaultBranch || (await src.getDefaultBranch().catch(() => 'main'));
  const branch = opts.branch?.trim() || designerBranch(projectId);
  const message = opts.message?.trim() || `Designer: update from IDE workspace`;
  const directToBase = branch === base;

  const workspace = await listWorkspace(env, projectId);
  if (workspace.length === 0) return { ok: false, status: 400, error: 'Workspace is empty — nothing to commit' };
  const workspacePaths = new Set(workspace.map((f) => f.path));

  // Adds / updates.
  let committed = 0;
  for (const f of workspace.slice(0, MAX_COMMIT_FILES)) {
    const res = await commitFileToRepo({
      provider: repo.provider, host: repo.host, owner: repo.owner, repo: repo.repo, token,
      branch, base, path: f.path, content: f.content, message,
    });
    if (res.ok) committed += 1;
  }

  // Deletions: files on the base tree the workspace no longer has (skip vendored/etc).
  let deleted = 0;
  const baseTree = await src.getTree(base).catch(() => null);
  if (baseTree) {
    const gone = baseTree.entries.filter(
      (e) => e.type === 'file' && !workspacePaths.has(e.path)
        && !isExcludedPath(e.path) && !isBinaryPath(e.path) && !isSecretPath(e.path),
    );
    for (const e of gone.slice(0, MAX_COMMIT_FILES)) {
      const res = await deleteFileFromRepo({
        provider: repo.provider, host: repo.host, owner: repo.owner, repo: repo.repo, token,
        branch, path: e.path, message: `Designer: remove ${e.path}`,
      });
      if (res.ok) deleted += 1;
    }
  }

  // Open a PR for a feature branch; an initial push straight to default has no PR.
  let prNumber: number | null = null;
  let prUrl: string | null = null;
  if (!directToBase && committed + deleted > 0) {
    const pr = await createPullRequest({
      provider: repo.provider, host: repo.host, owner: repo.owner, repo: repo.repo, token,
      head: branch, base, title: `Designer changes — project ${projectId}`,
      body: `Changes pushed from the BuilderForce Designer (IDE) workspace.\n\n${committed} file(s) updated, ${deleted} removed.`,
    });
    if (pr.ok) {
      prNumber = pr.number;
      prUrl = pr.url;
      // Record the branch + PR so the PR panel links to it (best-effort, never blocks).
      const now = new Date();
      await db.insert(repoBranches).values({
        tenantId, segmentId: repo.segmentId ?? null, repoId: repo.id, taskId: null,
        name: branch, baseBranch: base, createdBy: 'designer', createdAt: now,
      }).catch(() => { /* best-effort */ });
      await db.insert(pullRequests).values({
        tenantId, segmentId: repo.segmentId ?? null, projectId, repoId: repo.id, taskId: null,
        provider: repo.provider, branchName: branch, baseBranch: base, status: 'open',
        number: prNumber, url: prUrl, createdAt: now, updatedAt: now,
      }).catch(() => { /* best-effort */ });
    }
  }

  await db
    .update(projectRepositories)
    .set({ lastSyncedRef: directToBase ? base : branch, lastSyncedAt: new Date() })
    .where(and(eq(projectRepositories.id, repoId), eq(projectRepositories.tenantId, tenantId)));

  return { ok: true, branch, committed, deleted, prNumber, prUrl };
}

/** Decrypt the git token for a tenant integration credential by id. */
async function tokenForCredential(env: Env, tenantId: number, credentialId: string): Promise<string | null> {
  const db = buildDatabase(env);
  const [cred] = await db
    .select()
    .from(integrationCredentials)
    .where(and(eq(integrationCredentials.id, credentialId), eq(integrationCredentials.tenantId, tenantId)));
  if (!cred) return null;
  const creds = await decryptCredentials(cred.credentialsEnc, cred.iv, gitSecret(env), tenantId);
  return (creds?.accessToken as string | undefined) ?? (creds?.apiToken as string | undefined) ?? (creds?.token as string | undefined) ?? null;
}

interface CreatedRemoteRepo { owner: string; repo: string; defaultBranch: string; cloneUrl: string | null; host: string | null }

/** Create a clean remote repo via the provider API (GitHub today). `auto_init`
 *  gives it a default branch so the initial workspace push can commit onto it. */
async function createProviderRepo(
  provider: string,
  host: string | null,
  token: string,
  name: string,
  isPrivate: boolean,
): Promise<{ ok: true; repo: CreatedRemoteRepo } | { ok: false; error: string }> {
  if (provider !== 'github') {
    return { ok: false, error: `Creating a repo is not yet implemented for provider '${provider}'` };
  }
  const apiBase = buildGitApiBaseUrl(provider, host);
  const res = await fetch(`${apiBase}/user/repos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'BuilderForce-IDE/1.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, private: isPrivate, auto_init: true }),
  }).catch(() => null);
  if (!res) return { ok: false, error: 'Repo-create request failed (network)' };
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `GitHub ${res.status}: ${t.slice(0, 200)}` };
  }
  const body = (await res.json().catch(() => null)) as
    | { name?: string; owner?: { login?: string }; default_branch?: string; clone_url?: string } | null;
  if (!body?.owner?.login || !body.name) return { ok: false, error: 'GitHub returned an unexpected repo payload' };
  return {
    ok: true,
    repo: { owner: body.owner.login, repo: body.name, defaultBranch: body.default_branch ?? 'main', cloneUrl: body.clone_url ?? null, host },
  };
}

/**
 * Create a clean remote repo for a project that has none, bind it (default if
 * first), and push the current R2 workspace as the initial commit on its default
 * branch. The "go live with a real codebase" on-ramp.
 */
export async function createRemoteRepo(
  env: Env,
  tenantId: number,
  projectId: number,
  input: { provider?: string; name: string; private?: boolean; credentialId: string },
): Promise<RepoBridgeResult<{ repoId: string; owner: string; repo: string; committed: number }>> {
  const provider = input.provider?.trim() || 'github';
  const name = input.name.trim();
  if (!name) return { ok: false, status: 400, error: 'Repository name is required' };

  const token = await tokenForCredential(env, tenantId, input.credentialId);
  if (!token) return { ok: false, status: 400, error: 'Credential not found or has no usable token' };

  const created = await createProviderRepo(provider, null, token, name, input.private ?? true);
  if (!created.ok) return { ok: false, status: 502, error: created.error };

  const db = buildDatabase(env);
  const existing = await db
    .select({ id: projectRepositories.id })
    .from(projectRepositories)
    .where(and(eq(projectRepositories.projectId, projectId), eq(projectRepositories.tenantId, tenantId)));

  const [row] = await db
    .insert(projectRepositories)
    .values({
      tenantId,
      projectId,
      provider,
      host: created.repo.host ?? 'github.com',
      owner: created.repo.owner,
      repo: created.repo.repo,
      defaultBranch: created.repo.defaultBranch,
      cloneUrlHttps: created.repo.cloneUrl,
      isDefault: existing.length === 0,
      credentialId: input.credentialId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return { ok: false, status: 409, error: 'A repository with this owner/name is already bound to the project' };

  // Initial push: commit straight to the default branch (branch === base ⇒ no PR).
  const push = await commitWorkspaceToRepo(env, tenantId, projectId, row.id, {
    branch: created.repo.defaultBranch,
    message: 'Initial commit from BuilderForce Designer',
  });
  const committed = push.ok ? push.committed : 0;

  return { ok: true, repoId: row.id, owner: created.repo.owner, repo: created.repo.repo, committed };
}

/** Linked-repo status for the IDE — the default repo + import baseline, or unlinked. */
export async function getRepoStatus(
  env: Env,
  tenantId: number,
  projectId: number,
): Promise<{ linked: boolean; repoId?: string; owner?: string; repo?: string; provider?: string; lastSyncedRef?: string | null; lastSyncedAt?: string | null }> {
  const db = buildDatabase(env);
  const repos = await db
    .select()
    .from(projectRepositories)
    .where(and(eq(projectRepositories.projectId, projectId), eq(projectRepositories.tenantId, tenantId)));
  const def = repos.find((r) => r.isDefault) ?? repos[0];
  if (!def) return { linked: false };
  return {
    linked: true,
    repoId: def.id,
    owner: def.owner,
    repo: def.repo,
    provider: def.provider,
    lastSyncedRef: def.lastSyncedRef,
    lastSyncedAt: def.lastSyncedAt ? def.lastSyncedAt.toISOString() : null,
  };
}

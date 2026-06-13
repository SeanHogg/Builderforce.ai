/**
 * commitFileToRepo — create a branch and commit a single file to it via the
 * provider REST API (GitHub), server-side with the tenant's decrypted token.
 *
 * Used to land an agent-authored `PRD.md` as a real **pending change** on a
 * dedicated branch even when no local git runtime is available (the cloud path
 * runs in a Cloudflare Worker with no filesystem). GitHub + GitLab are
 * implemented; Bitbucket Cloud's `/src` write API (form-encoded, deletion via a
 * `files` field) is the remaining provider and returns `unsupported` for now, so
 * callers degrade gracefully.
 */
import { buildGitApiBaseUrl } from './gitProxy';

export interface CommitFileInput {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
  token: string;
  /** Branch to create/commit on. Created off `base` if it doesn't exist. */
  branch: string;
  /** Base branch the new branch forks from (repo default). */
  base: string;
  /** Repo-relative path, e.g. "PRD.md". */
  path: string;
  content: string;
  message: string;
}

export type CommitFileResult =
  | { ok: true; branch: string; commitUrl: string | null; existed: boolean }
  | { ok: false; code: 'unsupported' | 'provider_error'; reason: string };

/** UTF-8-safe base64 (Workers `btoa` is latin1-only). */
function toBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** GitLab path — Repository Files API (plain-text content; branch auto-forked
 *  off `base`). POST creates, PUT updates; existence is probed first so the
 *  `existed` (created-vs-modified) signal is authoritative. */
async function gitlabCommit(input: CommitFileInput): Promise<CommitFileResult> {
  let apiBase: string;
  try { apiBase = buildGitApiBaseUrl('gitlab', input.host); } catch (e) { return { ok: false, code: 'unsupported', reason: e instanceof Error ? e.message : 'unsupported host' }; }
  const proj = `${apiBase}/projects/${encodeURIComponent(`${input.owner}/${input.repo}`)}`;
  const headers = { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'BuilderForce-PRD/1.0' };
  const encPath = encodeURIComponent(input.path);

  // Create the branch off base (ignore "already exists").
  await fetch(`${proj}/repository/branches?branch=${encodeURIComponent(input.branch)}&ref=${encodeURIComponent(input.base)}`, { method: 'POST', headers }).catch(() => null);

  // Probe existence on the branch → POST (create) vs PUT (update).
  const probe = await fetch(`${proj}/repository/files/${encPath}?ref=${encodeURIComponent(input.branch)}`, { headers }).catch(() => null);
  const existed = !!probe && probe.ok;

  const res = await fetch(`${proj}/repository/files/${encPath}`, {
    method: existed ? 'PUT' : 'POST',
    headers,
    body: JSON.stringify({ branch: input.branch, content: input.content, commit_message: input.message }),
  }).catch(() => null);
  if (!res) return { ok: false, code: 'provider_error', reason: 'commit request failed (network)' };
  if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, code: 'provider_error', reason: `GitLab ${res.status}: ${t.slice(0, 200)}` }; }
  return { ok: true, branch: input.branch, commitUrl: null, existed };
}

export async function commitFileToRepo(input: CommitFileInput): Promise<CommitFileResult> {
  if (input.provider === 'gitlab') return gitlabCommit(input);
  if (input.provider !== 'github') {
    return { ok: false, code: 'unsupported', reason: `commit not implemented for provider '${input.provider}'` };
  }
  const apiBase = buildGitApiBaseUrl(input.provider, input.host);
  const repoBase = `${apiBase}/repos/${input.owner}/${input.repo}`;
  const headers = {
    Authorization: `Bearer ${input.token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'BuilderForce-PRD/1.0',
    'Content-Type': 'application/json',
  };

  // 1. Resolve the base branch head sha.
  const baseRef = await fetch(`${repoBase}/git/ref/heads/${encodeURIComponent(input.base)}`, { headers });
  if (!baseRef.ok) {
    const t = await baseRef.text().catch(() => '');
    return { ok: false, code: 'provider_error', reason: `base ref ${baseRef.status}: ${t.slice(0, 200)}` };
  }
  const baseSha = ((await baseRef.json().catch(() => null)) as { object?: { sha?: string } } | null)?.object?.sha;
  if (!baseSha) return { ok: false, code: 'provider_error', reason: 'base ref has no sha' };

  // 2. Create the branch (ignore 422 = already exists).
  const create = await fetch(`${repoBase}/git/refs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: baseSha }),
  });
  if (!create.ok && create.status !== 422) {
    const t = await create.text().catch(() => '');
    return { ok: false, code: 'provider_error', reason: `create branch ${create.status}: ${t.slice(0, 200)}` };
  }

  // 3. Existing file sha on the branch (so a re-commit updates rather than 422s).
  // The branch forks from base, so a present sha also means the path already
  // existed in the repo — the authoritative created-vs-modified signal callers
  // use to label the change (don't trust a caller-supplied "isNew" hint).
  const existing = await fetch(`${repoBase}/contents/${encodeURIComponent(input.path)}?ref=${encodeURIComponent(input.branch)}`, { headers });
  const existingSha = existing.ok
    ? ((await existing.json().catch(() => null)) as { sha?: string } | null)?.sha
    : undefined;

  // 4. Commit the file onto the branch.
  const put = await fetch(`${repoBase}/contents/${encodeURIComponent(input.path)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: input.message,
      content: toBase64Utf8(input.content),
      branch: input.branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });
  if (!put.ok) {
    const t = await put.text().catch(() => '');
    return { ok: false, code: 'provider_error', reason: `commit ${put.status}: ${t.slice(0, 200)}` };
  }
  const commitUrl = ((await put.json().catch(() => null)) as { commit?: { html_url?: string } } | null)?.commit?.html_url ?? null;
  return { ok: true, branch: input.branch, commitUrl, existed: Boolean(existingSha) };
}

export interface DeleteFileInput {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
  token: string;
  /** Branch to delete the file from. */
  branch: string;
  /** Repo-relative path to remove, e.g. "src/utils/email.ts". */
  path: string;
  message: string;
}

export type DeleteFileResult =
  | { ok: true; branch: string; commitUrl: string | null }
  | { ok: false; code: 'unsupported' | 'not_found' | 'provider_error'; reason: string };

/**
 * Remove a single file from the ticket branch via the provider REST API — the
 * deletion counterpart to {@link commitFileToRepo}. Used so the cloud agent can
 * clean up dead/stub files a prior pass left on the branch (so they don't ship in
 * the PR), not just append. GitHub-only; never throws. A missing file returns a
 * typed `not_found` so the loop can tell the model "nothing to delete" instead of
 * surfacing it as an error.
 */
/** GitLab path — Repository Files API DELETE. A 404 maps to `not_found`. */
async function gitlabDelete(input: DeleteFileInput): Promise<DeleteFileResult> {
  let apiBase: string;
  try { apiBase = buildGitApiBaseUrl('gitlab', input.host); } catch (e) { return { ok: false, code: 'unsupported', reason: e instanceof Error ? e.message : 'unsupported host' }; }
  const proj = `${apiBase}/projects/${encodeURIComponent(`${input.owner}/${input.repo}`)}`;
  const headers = { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'BuilderForce-PRD/1.0' };
  const res = await fetch(`${proj}/repository/files/${encodeURIComponent(input.path)}`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ branch: input.branch, commit_message: input.message }),
  }).catch(() => null);
  if (!res) return { ok: false, code: 'provider_error', reason: 'delete request failed (network)' };
  if (res.status === 404) return { ok: false, code: 'not_found', reason: `file not on branch ${input.branch}: ${input.path}` };
  if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, code: 'provider_error', reason: `GitLab ${res.status}: ${t.slice(0, 200)}` }; }
  return { ok: true, branch: input.branch, commitUrl: null };
}

export async function deleteFileFromRepo(input: DeleteFileInput): Promise<DeleteFileResult> {
  if (input.provider === 'gitlab') return gitlabDelete(input);
  if (input.provider !== 'github') {
    return { ok: false, code: 'unsupported', reason: `delete not implemented for provider '${input.provider}'` };
  }
  const apiBase = buildGitApiBaseUrl(input.provider, input.host);
  const repoBase = `${apiBase}/repos/${input.owner}/${input.repo}`;
  const headers = {
    Authorization: `Bearer ${input.token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'BuilderForce-PRD/1.0',
    'Content-Type': 'application/json',
  };

  // GitHub's delete-contents API needs the file's current blob sha on the branch.
  const existing = await fetch(`${repoBase}/contents/${encodeURIComponent(input.path)}?ref=${encodeURIComponent(input.branch)}`, { headers });
  if (existing.status === 404) {
    return { ok: false, code: 'not_found', reason: `file not on branch ${input.branch}: ${input.path}` };
  }
  if (!existing.ok) {
    const t = await existing.text().catch(() => '');
    return { ok: false, code: 'provider_error', reason: `lookup ${existing.status}: ${t.slice(0, 200)}` };
  }
  const existingSha = ((await existing.json().catch(() => null)) as { sha?: string } | null)?.sha;
  if (!existingSha) return { ok: false, code: 'provider_error', reason: 'existing file has no sha' };

  const del = await fetch(`${repoBase}/contents/${encodeURIComponent(input.path)}`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ message: input.message, sha: existingSha, branch: input.branch }),
  });
  if (!del.ok) {
    const t = await del.text().catch(() => '');
    return { ok: false, code: 'provider_error', reason: `delete ${del.status}: ${t.slice(0, 200)}` };
  }
  const commitUrl = ((await del.json().catch(() => null)) as { commit?: { html_url?: string } } | null)?.commit?.html_url ?? null;
  return { ok: true, branch: input.branch, commitUrl };
}

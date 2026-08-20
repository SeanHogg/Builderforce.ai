/**
 * commitFileToRepo — create a branch and commit a single file to it via the
 * provider REST API (GitHub), server-side with the tenant's decrypted token.
 *
 * Used to land an agent-authored `PRD.md` as a real **pending change** on a
 * dedicated branch even when no local git runtime is available (the cloud path
 * runs in a Cloudflare Worker with no filesystem).
 *
 * GitHub, GitLab, Bitbucket Cloud (`/src`, form-encoded, deletion via a `files`
 * field) and Bitbucket Server (`PUT /browse/{path}`, multipart) all commit. Only
 * DELETION on Bitbucket Server still refuses: `/rest/api/1.0` has no delete-file
 * endpoint at all — see `bitbucketServerDelete` for the concrete gap — so that one
 * refusal is real rather than an artefact of the base URL being unknown.
 */
import { buildGitApiBaseUrl } from './gitProxy';
import { resolveRepoApiTarget, type RepoApiTarget } from './repoApiTarget';

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

export async function resolveRepoRefSha(input: Pick<CommitFileInput, 'provider' | 'host' | 'owner' | 'repo' | 'token'>, ref: string): Promise<string | null> {
  try {
    const api = resolveRepoApiTarget(input);
    const headers = { Authorization: `Bearer ${input.token}`, Accept: 'application/json', 'User-Agent': 'BuilderForce-Agent/1.0' };
    if (api.flavor === 'github') {
      const res = await fetch(`${api.repoBase}/git/ref/heads/${encodeURIComponent(ref)}`, { headers });
      return res.ok ? ((await res.json()) as { object?: { sha?: string } }).object?.sha ?? null : null;
    }
    if (api.flavor === 'gitlab') {
      const res = await fetch(`${api.branches()}/${encodeURIComponent(ref)}`, { headers });
      return res.ok ? ((await res.json()) as { commit?: { id?: string } }).commit?.id ?? null : null;
    }
    if (api.flavor === 'bitbucket-cloud') {
      const res = await fetch(`${api.branches()}/${encodeURIComponent(ref)}`, { headers });
      return res.ok ? ((await res.json()) as { target?: { hash?: string } }).target?.hash ?? null : null;
    }
    if (api.flavor === 'bitbucket-server') return bitbucketServerBranchHead(api, ref, headers);
    return null;
  } catch { return null; }
}

/**
 * Bitbucket Server has no "get branch by name" resource — `/branches` is a SEARCH,
 * and `filterText` is a substring match, so `main` also returns `maintenance`.
 * The exact `displayId` must therefore be picked out of the page rather than
 * trusting the first hit; returning the wrong branch's head here would make a
 * commit fork from the wrong place. Null means "no such branch" (which the commit
 * path reads as "create it"), never "lookup failed silently".
 */
async function bitbucketServerBranchHead(
  api: RepoApiTarget,
  ref: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const res = await fetch(`${api.branches()}?filterText=${encodeURIComponent(ref)}&limit=100`, { headers }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    values?: Array<{ displayId?: string; id?: string; latestCommit?: string }>;
  } | null;
  const exact = (body?.values ?? []).find(
    (b) => b.displayId === ref || b.id === `refs/heads/${ref}`,
  );
  return exact?.latestCommit ?? null;
}

/** UTF-8-safe base64 (Workers `btoa` is latin1-only). */
function toBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * The web URL of a commit, for the two providers whose write APIs do not return one.
 *
 * GitHub's contents API hands back `commit.html_url` directly; GitLab's Repository
 * Files API and Bitbucket's `/src` endpoint do not, so every non-GitHub commit came
 * back with `commitUrl: null` and the product had no link to the change it had just
 * made on those providers. Both are one cheap read away:
 *   - GitLab    `GET /projects/:id/repository/branches/:branch` → `commit.web_url`
 *   - Bitbucket the `Location` header of the `/src` POST names the commit resource;
 *               its hash builds the Cloud web URL.
 *
 * Best-effort by construction — a failure here must never turn a SUCCESSFUL commit
 * into a failed one, so every path returns null rather than throwing.
 */
async function gitlabBranchCommitUrl(
  proj: string,
  branch: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const res = await fetch(`${proj}/repository/branches/${encodeURIComponent(branch)}`, { headers }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = (await res.json().catch(() => null)) as { commit?: { web_url?: string } } | null;
  return body?.commit?.web_url ?? null;
}

/** Bitbucket Cloud: `Location: …/repositories/{o}/{r}/commit/{hash}` → the web URL. */
function bitbucketCommitUrlFromLocation(
  location: string | null,
  owner: string,
  repo: string,
): string | null {
  const hash = /\/commit\/([0-9a-f]{7,40})/i.exec(location ?? '')?.[1];
  return hash ? `https://bitbucket.org/${owner}/${repo}/commits/${hash}` : null;
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
  return { ok: true, branch: input.branch, commitUrl: await gitlabBranchCommitUrl(proj, input.branch, headers), existed };
}

/** Bitbucket Cloud path — create the branch off base (needs the base commit
 *  `hash`), then commit via the form-encoded `/src` API (create-or-update auto).
 *  Existence is probed for the `existed` signal. */
async function bitbucketCommit(input: CommitFileInput): Promise<CommitFileResult> {
  let api: RepoApiTarget;
  try { api = resolveRepoApiTarget(input); } catch (e) { return { ok: false, code: 'unsupported', reason: e instanceof Error ? e.message : 'unsupported host' }; }
  if (api.flavor === 'bitbucket-server') return bitbucketServerCommit(input, api);
  const repoBase = api.repoBase;
  const jsonHeaders = { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'BuilderForce-PRD/1.0' };
  const encPath = input.path.split('/').map(encodeURIComponent).join('/');

  // Resolve base head + create the branch off it (ignore "already exists").
  const baseRef = await fetch(`${repoBase}/refs/branches/${encodeURIComponent(input.base)}`, { headers: jsonHeaders }).catch(() => null);
  const baseHash = baseRef && baseRef.ok ? ((await baseRef.json().catch(() => null)) as { target?: { hash?: string } } | null)?.target?.hash : undefined;
  if (baseHash) {
    await fetch(`${repoBase}/refs/branches`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: input.branch, target: { hash: baseHash } }) }).catch(() => null);
  }

  // Existence probe on the branch (authoritative created-vs-modified signal).
  const probe = await fetch(`${repoBase}/src/${encodeURIComponent(input.branch)}/${encPath}`, { headers: jsonHeaders }).catch(() => null);
  const existed = !!probe && probe.ok;

  // Commit via the form-encoded /src endpoint: branch + message + <path>=<content>.
  const form = new URLSearchParams();
  form.set('branch', input.branch);
  form.set('message', input.message);
  form.set(input.path, input.content);
  const res = await fetch(api.fileWrite(input.path), {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'BuilderForce-PRD/1.0' },
    body: form.toString(),
  }).catch(() => null);
  if (!res) return { ok: false, code: 'provider_error', reason: 'commit request failed (network)' };
  if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, code: 'provider_error', reason: `Bitbucket ${res.status}: ${t.slice(0, 200)}` }; }
  return {
    ok: true,
    branch: input.branch,
    commitUrl: bitbucketCommitUrlFromLocation(res.headers.get('location'), input.owner, input.repo),
    existed,
  };
}

/**
 * Bitbucket SERVER path - `PUT /rest/api/1.0/.../browse/{path}`, multipart.
 *
 * Nothing about Cloud's `/src` flow transfers. Server writes ONE file per request
 * with a multipart form, and its optimistic-locking field is what decides between
 * create and update:
 *   - `sourceCommitId` - the branch's current head. REQUIRED to modify an existing
 *     file; sending a stale one is how Server tells you someone else committed
 *     first (409), which is exactly the protection we want.
 *   - `sourceBranch` - the branch to FORK FROM when `branch` does not exist yet.
 *     This is why there is no separate create-branch call here (unlike Cloud, which
 *     needs one): Server creates the branch as part of the same commit.
 * A file's existence is probed through the raw endpoint on the branch, so `existed`
 * stays the authoritative created-vs-modified signal it is on the other providers.
 */
async function bitbucketServerCommit(input: CommitFileInput, api: RepoApiTarget): Promise<CommitFileResult> {
  const authHeaders = { Authorization: `Bearer ${input.token}`, Accept: 'application/json', 'User-Agent': 'BuilderForce-PRD/1.0' };
  const branchHead = await bitbucketServerBranchHead(api, input.branch, authHeaders);

  let existed = false;
  if (branchHead) {
    const probe = await fetch(api.fileContent(input.path, input.branch), { headers: authHeaders }).catch(() => null);
    existed = !!probe && probe.ok;
  }

  // multipart/form-data - the boundary must be generated by the runtime, so the
  // Content-Type header is deliberately NOT set here (setting it strips the boundary
  // and Server rejects the body as malformed).
  const form = new FormData();
  form.set('content', input.content);
  form.set('message', input.message);
  form.set('branch', input.branch);
  if (branchHead) form.set('sourceCommitId', branchHead);
  else form.set('sourceBranch', input.base);

  const res = await fetch(api.fileWrite(input.path), { method: 'PUT', headers: authHeaders, body: form }).catch(() => null);
  if (!res) return { ok: false, code: 'provider_error', reason: 'commit request failed (network)' };
  if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, code: 'provider_error', reason: `Bitbucket Server ${res.status}: ${t.slice(0, 200)}` }; }
  const commit = (await res.json().catch(() => null)) as { id?: string } | null;
  return {
    ok: true,
    branch: input.branch,
    commitUrl: bitbucketServerCommitUrl(input.host, input.owner, input.repo, commit?.id),
    existed,
  };
}

/** Server's web URL for a commit - `/projects/{KEY}/repos/{slug}/commits/{id}`. The
 *  write response carries the new commit id but no link, exactly like Cloud's. */
function bitbucketServerCommitUrl(
  host: string | null,
  owner: string,
  repo: string,
  id: string | undefined,
): string | null {
  const h = (host ?? '').trim();
  if (!h || !id) return null;
  return `https://${h}/projects/${encodeURIComponent(owner)}/repos/${encodeURIComponent(repo)}/commits/${id}`;
}

export async function commitFileToRepo(input: CommitFileInput): Promise<CommitFileResult> {
  if (input.provider === 'gitlab') return gitlabCommit(input);
  if (input.provider === 'bitbucket') return bitbucketCommit(input);
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
  return { ok: true, branch: input.branch, commitUrl: await gitlabBranchCommitUrl(proj, input.branch, headers) };
}

/** Bitbucket Cloud path — delete via the form-encoded `/src` API: a `files`
 *  field names the path(s) to remove (no per-path content). 404 probe → not_found. */
async function bitbucketDelete(input: DeleteFileInput): Promise<DeleteFileResult> {
  let api: RepoApiTarget;
  try { api = resolveRepoApiTarget(input); } catch (e) { return { ok: false, code: 'unsupported', reason: e instanceof Error ? e.message : 'unsupported host' }; }
  if (api.flavor === 'bitbucket-server') {
    // A REAL capability gap, not a missing base URL: `/rest/api/1.0` has a
    // single-file WRITE (`PUT /browse/{path}`) and no delete counterpart of any
    // kind - no `files` field like Cloud's `/src`, no DELETE verb on `/browse`.
    // The only server-side removal is a push, which this Worker cannot do. The
    // refusal is therefore kept, and named, so the caller records the residue.
    return {
      ok: false,
      code: 'unsupported',
      reason: 'Bitbucket Server exposes no delete-file REST endpoint (/rest/api/1.0/.../browse/{path} is write-only) - remove the file with a push and re-run',
    };
  }
  const repoBase = api.repoBase;
  const encPath = input.path.split('/').map(encodeURIComponent).join('/');
  const probe = await fetch(`${repoBase}/src/${encodeURIComponent(input.branch)}/${encPath}`, { headers: { Authorization: `Bearer ${input.token}`, Accept: 'application/json', 'User-Agent': 'BuilderForce-PRD/1.0' } }).catch(() => null);
  if (probe && probe.status === 404) return { ok: false, code: 'not_found', reason: `file not on branch ${input.branch}: ${input.path}` };
  const form = new URLSearchParams();
  form.set('branch', input.branch);
  form.set('message', input.message);
  form.set('files', input.path);
  const res = await fetch(api.fileWrite(input.path), {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'BuilderForce-PRD/1.0' },
    body: form.toString(),
  }).catch(() => null);
  if (!res) return { ok: false, code: 'provider_error', reason: 'delete request failed (network)' };
  if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, code: 'provider_error', reason: `Bitbucket ${res.status}: ${t.slice(0, 200)}` }; }
  return {
    ok: true,
    branch: input.branch,
    commitUrl: bitbucketCommitUrlFromLocation(res.headers.get('location'), input.owner, input.repo),
  };
}

export async function deleteFileFromRepo(input: DeleteFileInput): Promise<DeleteFileResult> {
  if (input.provider === 'gitlab') return gitlabDelete(input);
  if (input.provider === 'bitbucket') return bitbucketDelete(input);
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

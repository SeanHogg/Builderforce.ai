/**
 * commitFileToRepo — create a branch and commit a single file to it via the
 * provider REST API (GitHub), server-side with the tenant's decrypted token.
 *
 * Used to land an agent-authored `PRD.md` as a real **pending change** on a
 * dedicated branch even when no local git runtime is available (the cloud path
 * runs in a Cloudflare Worker with no filesystem). GitHub-only; other providers
 * return a typed `unsupported` result so callers degrade gracefully.
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
  | { ok: true; branch: string; commitUrl: string | null }
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

export async function commitFileToRepo(input: CommitFileInput): Promise<CommitFileResult> {
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
  return { ok: true, branch: input.branch, commitUrl };
}

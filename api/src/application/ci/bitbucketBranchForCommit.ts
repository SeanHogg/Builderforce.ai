/**
 * bitbucketBranchForCommit — recover the BRANCH a Bitbucket commit status belongs to
 * when the payload didn't name one.
 *
 * Bitbucket only puts `refname` on a commit status when the build was branch-scoped;
 * a status posted against a bare commit hash normalizes to `branch: null`, which
 * drops the event out of the pre-merge (ticket-branch) path and into post-merge sha
 * correlation — so a red PR-branch build on such a repo never triggers an auto-fix.
 * Asking the refs API which branch points at that hash restores the correlation.
 *
 * Two reads, cheapest first: the server-side `q=target.hash=…` filter, then a
 * most-recently-updated branch page scanned locally (older/self-managed responses
 * ignore the filter and return everything). Both go through the canonical
 * read-through cache — the branch head for a given sha is stable once the build has
 * concluded, and one build fans out several status posts that would otherwise each
 * re-query.
 *
 * Best-effort: never throws. A null result simply leaves `branch` null, so the event
 * falls back to post-merge sha correlation exactly as before.
 */
import { and, eq } from 'drizzle-orm';
import { projectRepositories } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { resolveRepoCredential, isResolveError } from '../repos/resolveRepoCredential';
import { buildGitApiBaseUrl } from '../repos/gitProxy';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export interface BitbucketRefCoords {
  host: string | null;
  owner: string;
  repo: string;
  token: string;
  sha: string;
}

interface BbBranch { name?: string; target?: { hash?: string } }

async function getBranches(url: string, token: string): Promise<BbBranch[]> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  const body = (await res.json().catch(() => null)) as { values?: BbBranch[] } | null;
  return body?.values ?? [];
}

/** A commit status may carry a short hash — match either direction by prefix. */
function hashMatches(head: string | undefined, sha: string): boolean {
  if (!head) return false;
  return head.startsWith(sha) || sha.startsWith(head);
}

async function fetchUncached(coords: BitbucketRefCoords): Promise<string | null> {
  let apiBase: string;
  try { apiBase = buildGitApiBaseUrl('bitbucket', coords.host); } catch { return null; }
  const repoBase = `${apiBase}/repositories/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}/refs/branches`;

  const filtered = await getBranches(
    `${repoBase}?q=${encodeURIComponent(`target.hash="${coords.sha}"`)}&pagelen=10`,
    coords.token,
  );
  const exact = filtered.find((b) => hashMatches(b.target?.hash, coords.sha));
  if (exact?.name) return exact.name;

  // The filter isn't honoured everywhere (and matches only full hashes) — scan the
  // most recently updated branches, which is where a just-built head will be.
  const recent = await getBranches(`${repoBase}?sort=-target.date&pagelen=100`, coords.token);
  return recent.find((b) => hashMatches(b.target?.hash, coords.sha))?.name ?? null;
}

/** Cached branch lookup for a commit hash. */
export async function fetchBitbucketBranchForCommit(env: Env, coords: BitbucketRefCoords): Promise<string | null> {
  return getOrSetCached(
    env,
    `bb-branch-for-sha:${coords.owner}/${coords.repo}:${coords.sha}`,
    () => fetchUncached(coords),
    { kvTtlSeconds: 3600, l1TtlMs: 60_000 },
  );
}

function splitFullName(fullName: string): { owner: string; repo: string } | null {
  const slash = fullName.indexOf('/');
  if (slash <= 0 || slash === fullName.length - 1) return null;
  return { owner: fullName.slice(0, slash), repo: fullName.slice(slash + 1) };
}

/**
 * Resolve the branch for `sha` in the connected Bitbucket repo `fullName`
 * (`workspace/repo_slug`), using that repo's linked credential. Returns null when
 * the repo isn't connected, has no usable token, or no branch points at the commit.
 */
export async function resolveBitbucketBranchForCommit(
  db: Db,
  env: Env,
  secret: string,
  fullName: string,
  sha: string,
): Promise<string | null> {
  try {
    const parts = splitFullName(fullName);
    if (!parts) return null;
    const [row] = await db
      .select({ id: projectRepositories.id, tenantId: projectRepositories.tenantId })
      .from(projectRepositories)
      .where(and(
        eq(projectRepositories.provider, 'bitbucket'),
        eq(projectRepositories.owner, parts.owner),
        eq(projectRepositories.repo, parts.repo),
      ))
      .limit(1);
    if (!row) return null;

    const resolved = await resolveRepoCredential(db, secret, row.tenantId, row.id);
    if (isResolveError(resolved)) return null;

    return await fetchBitbucketBranchForCommit(env, {
      host: resolved.repo.host, owner: resolved.repo.owner, repo: resolved.repo.repo,
      token: resolved.token, sha,
    });
  } catch {
    return null; // a webhook must always 200 — an unresolved branch just degrades
  }
}

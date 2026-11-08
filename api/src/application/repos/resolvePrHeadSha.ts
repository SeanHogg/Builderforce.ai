/**
 * resolvePrHeadSha - the head commit of a pull request, on every provider, through ONE function.
 *
 * The security merge gate is keyed on the PR's head commit, so it must be able to ask any provider
 * "what is the head of this PR right now?". It reads the provider's own PR/MR resource (fresh - never
 * through the detail cache, whose 30s TTL could hand back a superseded commit):
 *
 *   GitHub / GHES          GET /repos/:o/:r/pulls/:n                     -> head.sha
 *   GitLab                 GET /projects/:id/merge_requests/:iid         -> sha
 *   Bitbucket Cloud        GET /repositories/:w/:r/pullrequests/:id      -> source.commit.hash
 *   Bitbucket Server / DC  GET .../pull-requests/:id                     -> fromRef.latestCommit
 *
 * URL shapes come from `repoApiTarget` (the one place that knows each dialect), so this module holds
 * only the per-dialect RESPONSE mapping, which is pure and unit-tested. Never throws.
 */
import { resolveRepoApiTarget, type RepoApiCoords } from './repoApiTarget';
import type { GitApiFlavor } from './gitProxy';
import { resolveRepoCommitSha } from './readRepoContents';

export interface PrHeadCoords extends RepoApiCoords { token: string; number: number }

export type HeadShaResult = { ok: true; sha: string } | { ok: false; reason: string };

const SHA = /^[0-9a-f]{7,64}$/i;

/** The head commit out of a provider's PR/MR response body. PURE. */
export function parsePrHeadSha(flavor: GitApiFlavor, body: unknown): string | null {
  const b = (body ?? {}) as Record<string, any>;
  const raw: unknown =
    flavor === 'gitlab' ? (b.sha ?? b.diff_refs?.head_sha)
    : flavor === 'bitbucket-cloud' ? b.source?.commit?.hash
    : flavor === 'bitbucket-server' ? b.fromRef?.latestCommit
    : b.head?.sha;
  return typeof raw === 'string' && SHA.test(raw) ? raw.toLowerCase() : null;
}

/** Ask the provider for the PR's head commit RIGHT NOW. */
export async function resolvePrHeadSha(input: PrHeadCoords, fetchFn: typeof fetch = fetch): Promise<HeadShaResult> {
  let target: ReturnType<typeof resolveRepoApiTarget>;
  try {
    target = resolveRepoApiTarget(input);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : `head lookup not implemented for provider '${input.provider}'` };
  }
  const res = await fetchFn(target.pullRequest(input.number), {
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: target.flavor === 'github' ? 'application/vnd.github+json' : 'application/json',
      'User-Agent': 'BuilderForce-PR-Head/1.0',
    },
  }).catch(() => null);
  if (!res) return { ok: false, reason: 'head lookup failed (network)' };
  if (!res.ok) return { ok: false, reason: `${input.provider} ${res.status} reading the pull request head` };
  const sha = parsePrHeadSha(target.flavor, await res.json().catch(() => null));
  return sha ? { ok: true, sha } : { ok: false, reason: `${input.provider} returned no head commit for the pull request` };
}

/**
 * The head to key a PR's scans on: the PR resource's head when the PR has a provider number (every
 * provider), else the branch's commit (GitHub only - the one provider whose branch-commit lookup exists).
 */
export async function resolveHeadSha(
  coords: RepoApiCoords & { token: string },
  pr: { number: number | null; branch: string | null },
  fetchFn: typeof fetch = fetch,
): Promise<HeadShaResult> {
  if (pr.number != null) return resolvePrHeadSha({ ...coords, number: pr.number }, fetchFn);
  if (!pr.branch) return { ok: false, reason: 'the PR has neither a provider number nor a branch' };
  const head = await resolveRepoCommitSha({ ...coords, ref: pr.branch });
  return head.ok ? { ok: true, sha: head.sha } : { ok: false, reason: head.reason };
}

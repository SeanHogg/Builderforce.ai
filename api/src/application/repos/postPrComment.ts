/**
 * postPrComment — write the platform's PROSE back onto a GitHub pull request.
 *
 * WHY THIS EXISTS
 * The platform already opens PRs (`openTaskPullRequest`, `finalizeCloudRun`) and
 * merges them, and publishCheckRun puts a verdict in the merge box. What was
 * missing is the middle register: the narrative. A check run answers "green or
 * red"; it cannot say "I changed these 14 files, here is why, and none of it was
 * verified in-agent." That belongs in the PR conversation, which is where humans
 * actually read and reply. Without it, every agent finding lived in the
 * Builderforce UI and the reviewer on github.com saw an unexplained diff.
 *
 * ── Two endpoints, deliberately ──────────────────────────────────────────────
 * GitHub exposes PR commentary through two unrelated APIs, and picking the wrong
 * one is the classic mistake here:
 *
 *   `POST /issues/{n}/comments`  → the PR CONVERSATION timeline. PRs are issues
 *     for this endpoint. No commit or file is required, so it is the only option
 *     for a summary that isn't anchored to a line of code.
 *   `POST /pulls/{n}/reviews`    → INLINE comments anchored to file+line, which
 *     is what a per-finding review needs.
 *
 * The review path posts ONE review carrying every inline comment rather than N
 * calls to `/pulls/{n}/comments`. That is not a micro-optimisation: N separate
 * comments send N notification emails, fragment the reviewer's thread, and burn
 * N units of a secondary rate limit that GitHub enforces aggressively on comment
 * creation. One review is one notification and one request.
 *
 * ── Idempotency is mandatory, not defensive ──────────────────────────────────
 * Every caller of this module sits behind something that legitimately re-fires:
 * GitHub redelivers webhooks, `finalizeCloudRun` is the terminal chokepoint for
 * three surfaces (Worker loop, DO tick, container finalize) and can be reached
 * twice on a retry, and humans re-run agents. GitHub has no upsert for comments —
 * a second POST is simply a second comment. So a hidden HTML marker is embedded
 * in every body and existing comments are scanned for it before posting. HTML
 * comments render as nothing on github.com, so the marker is invisible to
 * reviewers while remaining an exact, greppable identity for us.
 *
 * Tagged results throughout, never throws — matching githubClient/publishCheckRun.
 * Annotating a PR must never fail the run that produced the annotation.
 */
import { githubRequest, repoPath, resolveRepoAuth, type ResolvedRepoAuth } from './githubClient';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * Marker kinds. These are IDENTITIES, not labels: changing a string makes every
 * already-posted comment of that kind invisible to the dedupe scan, so a re-run
 * would duplicate it. Treat them as stable.
 */
export type PrCommentKind = 'agent-run' | 'qa' | 'security' | 'review';

export type PostCommentResult =
  | { ok: true; id: number | null; skipped: boolean }
  | { ok: false; code: string; reason: string };

/**
 * The dedupe token. Scoped by an optional discriminator so the same kind can be
 * posted once per run/execution rather than once per PR — a PR that an agent
 * touches three times should carry three run summaries, not one.
 */
export function commentMarker(kind: PrCommentKind, scope?: string | number): string {
  return scope === undefined || scope === null || scope === ''
    ? `<!-- builderforce:${kind} -->`
    : `<!-- builderforce:${kind}:${scope} -->`;
}

/** Append the marker to a body. Trailing position keeps it out of the excerpt
 *  GitHub shows in notification emails. */
export function withMarker(body: string, kind: PrCommentKind, scope?: string | number): string {
  const marker = commentMarker(kind, scope);
  return body.includes(marker) ? body : `${body}\n\n${marker}`;
}

export function hasMarker(body: string | null | undefined, marker: string): boolean {
  return typeof body === 'string' && body.includes(marker);
}

/**
 * How many pages of existing comments to scan for the marker. A PR with more
 * than 300 comments is pathological, and the cost of a false "not found" there
 * is one duplicate comment — cheap next to unbounded pagination inside a Worker
 * with a hard subrequest budget.
 */
const DEDUPE_PAGE_SIZE = 100;
const DEDUPE_MAX_PAGES = 3;

interface IssueComment {
  id: number;
  body?: string | null;
}

/**
 * True when a comment carrying `marker` already exists on the PR. A failure to
 * LIST is reported as "not found": the caller's choice then is post-and-risk-a-
 * duplicate versus stay-silent, and a duplicate summary is strictly less harmful
 * than a missing one.
 */
export async function prCommentExists(
  auth: ResolvedRepoAuth,
  prNumber: number,
  marker: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  for (let page = 1; page <= DEDUPE_MAX_PAGES; page++) {
    const res = await githubRequest<IssueComment[]>({
      coords: auth.coords,
      token: auth.token,
      path: repoPath(auth.coords, `/issues/${prNumber}/comments?per_page=${DEDUPE_PAGE_SIZE}&page=${page}`),
      fetchFn,
    });
    if (!res.ok || !Array.isArray(res.data)) return false;
    if (res.data.some((c) => hasMarker(c.body, marker))) return true;
    // A short page is the last page.
    if (res.data.length < DEDUPE_PAGE_SIZE) return false;
  }
  return false;
}

/**
 * Post a comment on the PR's conversation timeline.
 *
 * `scope` discriminates repeat postings of the same kind (pass the execution id
 * for a per-run summary). Returns `skipped: true` when an identical marker is
 * already present — that is a SUCCESS, not an error: the desired end state holds.
 */
export async function postPrIssueComment(
  auth: ResolvedRepoAuth,
  prNumber: number,
  body: string,
  opts?: { kind?: PrCommentKind; scope?: string | number; fetchFn?: typeof fetch },
): Promise<PostCommentResult> {
  const fetchFn = opts?.fetchFn ?? fetch;
  if (auth.repo.provider !== 'github') {
    return { ok: false, code: 'unsupported', reason: `pr comments not supported for provider '${auth.repo.provider}'` };
  }

  const kind = opts?.kind;
  const finalBody = kind ? withMarker(body, kind, opts?.scope) : body;

  if (kind) {
    const marker = commentMarker(kind, opts?.scope);
    if (await prCommentExists(auth, prNumber, marker, fetchFn)) {
      return { ok: true, id: null, skipped: true };
    }
  }

  const res = await githubRequest<{ id: number }>({
    coords: auth.coords,
    token: auth.token,
    // PRs ARE issues for this endpoint — there is no `/pulls/{n}/comments`
    // equivalent that accepts an unanchored comment.
    path: repoPath(auth.coords, `/issues/${prNumber}/comments`),
    method: 'POST',
    fetchFn,
    body: { body: finalBody },
  });

  if (!res.ok) return { ok: false, code: res.code, reason: res.reason };
  return { ok: true, id: res.data?.id ?? null, skipped: false };
}

export interface PrInlineComment {
  /** Repo-relative path, exactly as it appears in the PR diff. */
  path: string;
  /** Line number in the file AFTER the change (GitHub's `RIGHT` side). */
  line: number;
  body: string;
}

/**
 * Post ONE review containing every inline comment.
 *
 * `commitSha` must be the PR's current head: GitHub rejects (422) comments
 * anchored to a commit that is no longer the tip, and silently orphans anchors
 * on lines the newer diff no longer touches. Callers resolve the head fresh —
 * see publishTaskVerdict for the cache-busting pattern.
 *
 * `event: 'COMMENT'` rather than 'REQUEST_CHANGES' is deliberate. The platform is
 * not a required reviewer; blocking a human's merge on an unverified automated
 * pass would train people to dismiss it, which is worse than not posting at all.
 *
 * A comment whose `path`/`line` is not in the diff fails the WHOLE review with a
 * 422, so callers must only anchor to lines they know are in the change set.
 */
export async function postPrReviewComments(
  auth: ResolvedRepoAuth,
  prNumber: number,
  commitSha: string,
  comments: PrInlineComment[],
  opts?: { body?: string; fetchFn?: typeof fetch },
): Promise<PostCommentResult> {
  const fetchFn = opts?.fetchFn ?? fetch;
  if (auth.repo.provider !== 'github') {
    return { ok: false, code: 'unsupported', reason: `pr reviews not supported for provider '${auth.repo.provider}'` };
  }
  // An empty review body with no comments is a 422; treat "nothing to say" as a
  // no-op success so callers don't have to guard every call site.
  if (comments.length === 0 && !opts?.body) return { ok: true, id: null, skipped: true };

  const res = await githubRequest<{ id: number }>({
    coords: auth.coords,
    token: auth.token,
    path: repoPath(auth.coords, `/pulls/${prNumber}/reviews`),
    method: 'POST',
    fetchFn,
    body: {
      commit_id: commitSha,
      event: 'COMMENT',
      ...(opts?.body ? { body: opts.body } : {}),
      comments: comments.map((c) => ({
        path: c.path,
        line: c.line,
        // Without an explicit side, GitHub defaults to RIGHT for `line` but the
        // behaviour differs for multi-line and deleted-line anchors; pinning it
        // keeps every anchor pointing at the post-change file.
        side: 'RIGHT',
        body: c.body,
      })),
    },
  });

  if (!res.ok) return { ok: false, code: res.code, reason: res.reason };
  return { ok: true, id: res.data?.id ?? null, skipped: false };
}

/**
 * Convenience for the common caller shape: "I know the repo row and the PR
 * number, put this on the PR." Resolves the App-first credential itself and
 * swallows every failure into a tagged result, so a call site can be a plain
 * best-effort `await …catch(() => {})` without a resolution dance.
 */
export async function postRepoPrComment(
  env: Env,
  db: Db,
  tenantId: number,
  repoId: string,
  prNumber: number,
  body: string,
  opts?: { kind?: PrCommentKind; scope?: string | number; fetchFn?: typeof fetch },
): Promise<PostCommentResult> {
  try {
    // Mirrors publishTaskVerdict's credentialSecret: INTEGRATION_ENCRYPTION_SECRET
    // is the real key, JWT_SECRET the legacy fallback for older deployments.
    const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';
    const auth = await resolveRepoAuth(env, db, secret, tenantId, repoId);
    if (!auth.ok) return { ok: false, code: 'unauthorized', reason: auth.error };
    return await postPrIssueComment(auth.auth, prNumber, body, opts);
  } catch (e) {
    return { ok: false, code: 'provider_error', reason: (e as Error).message };
  }
}

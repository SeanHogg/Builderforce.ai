import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * revertMergedPullRequest — undo work that ALREADY LANDED on the base branch.
 *
 * The rest of the rollback story ({@link ../runtime/runRollback}) only ever closes
 * a pull request and deletes the run's branch. That is enough while the work is
 * still on a branch, and it is exactly nothing once the PR has been merged: the
 * commits are on `main`, so closing the (already-closed) PR and deleting the branch
 * changes no code. That case previously refused outright with `pull_request_merged`.
 *
 * This module is the missing path: it opens a NEW pull request that reverses the
 * merge, against the same base.
 *
 * HARD RULES, and they are the whole reason this is a separate module:
 *   • NEVER force-push. Nothing here rewrites history.
 *   • NEVER push to the base/default branch. The revert lands on its OWN branch and
 *     goes through review like any other change — an autonomous system that can
 *     write to `main` unreviewed is a bigger hazard than the bad merge it is undoing.
 *   • NEVER revert on partial evidence. If anything touched the merge's files after
 *     it landed, the revert would silently discard that newer work, so we refuse
 *     (`conflict`) and let a human resolve it.
 *
 * Provider support follows the same convention as the rest of this directory: a
 * pure builder per documented endpoint, a `{ ok: true … } | { ok: false; code;
 * reason }` result, and NEVER a throw.
 *
 * NO provider has a server-side "revert this PR" call — GitLab is the only one with
 * even a commit-level revert. What decides whether an edition can be served is
 * therefore whether the revert can be SYNTHESISED, which needs two things: reading
 * the pre-merge content of each file the merge touched, and writing a multi-file
 * commit onto a new branch.
 *   • GitHub      — Git Data API (tree → commit → ref). Supported.
 *   • GitLab      — first-class `/repository/commits/:sha/revert`, with real
 *                    conflict detection. Supported.
 *   • Bitbucket Cloud  — `/src` writes a whole multi-file commit in ONE form POST
 *                    (`files=` deletes, `<path>=<content>` restores) and
 *                    `/src/{sha}/{path}` reads the pre-merge bytes. Supported.
 *   • Bitbucket Server — REFUSED, and this is the one real vendor limitation:
 *                    `/rest/api/1.0` writes exactly ONE file per request
 *                    (`PUT /browse/{path}`) and has NO delete-file endpoint at all,
 *                    so a revert touching N files cannot be expressed as one commit
 *                    and a revert that removes a file cannot be expressed at all.
 */
import { resolveGitApiFlavor } from './gitProxy';
import { resolveRepoApiTarget, type RepoApiTarget } from './repoApiTarget';
import { createPullRequest } from './createPullRequest';

export interface RevertMergedPrInput {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
  token: string;
  /** The MERGED pull request whose landed commits are to be reversed. */
  number: number;
  /** The branch it merged into — the revert PR targets this. */
  base: string;
  /** Branch name to create for the revert (never an existing working branch). */
  revertBranch: string;
  title: string;
  body: string;
}

export type RevertMergedPrResult =
  | { ok: true; number: number; url: string; branch: string; revertedSha: string }
  | {
      ok: false;
      code: 'unsupported' | 'not_found' | 'not_merged' | 'conflict' | 'provider_error';
      reason: string;
    };

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'BuilderForce-Revert-Merge/1.0',
    'Content-Type': 'application/json',
  };
}

/** Read a JSON body, or null on any parse/transport failure. Never throws. */
async function getJson(url: string, token: string): Promise<{ status: number; body: unknown } | null> {
  const res = await fetch(url, { headers: headers(token) }).catch(() => null);
  if (!res) return null;
  return { status: res.status, body: res.ok ? await res.json().catch(() => null) : await res.text().catch(() => '') };
}

async function postJson(url: string, token: string, body: unknown): Promise<{ status: number; ok: boolean; body: unknown } | null> {
  const res = await fetch(url, { method: 'POST', headers: headers(token), body: JSON.stringify(body) }).catch(() => null);
  if (!res) return null;
  return { status: res.status, ok: res.ok, body: res.ok ? await res.json().catch(() => null) : await res.text().catch(() => '') };
}

const fail = (code: Exclude<RevertMergedPrResult, { ok: true }>['code'], reason: string): RevertMergedPrResult =>
  ({ ok: false, code, reason });

// ── GitHub ────────────────────────────────────────────────────────────────────

/** Blob entries a GitHub tree write needs: a sha to restore, or null to delete. */
interface TreeEntry { path: string; mode: string; type: 'blob'; sha: string | null }

/**
 * Reverse a merged GitHub PR by rebuilding the merged files at their PRE-merge
 * blobs on top of the current base head, then opening a PR for that commit.
 *
 * GitHub has no REST "revert" (the button is UI-only), and the Git Data API cannot
 * do a three-way merge — so the revert is expressed as a content restore, which is
 * what `git revert -m 1` resolves to whenever nothing else has touched the same
 * files. The "nothing else touched them" precondition is therefore CHECKED, not
 * assumed, and a violation refuses as `conflict`.
 */
async function revertGithub(input: RevertMergedPrInput): Promise<RevertMergedPrResult> {
  const api = resolveRepoApiTarget(input);
  const { repoBase } = api;
  const { token } = input;

  // 1 — the PR must actually be merged, and we need the commit it merged as.
  const pr = await getJson(api.pullRequest(input.number), token);
  if (!pr) return fail('provider_error', 'PR lookup failed (network)');
  if (pr.status === 404) return fail('not_found', `pull request #${input.number} not found`);
  if (pr.status < 200 || pr.status >= 300) return fail('provider_error', `GitHub ${pr.status}: ${String(pr.body).slice(0, 200)}`);
  const prBody = (pr.body ?? {}) as { merged?: boolean; merge_commit_sha?: string };
  if (!prBody.merged) return fail('not_merged', `pull request #${input.number} is not merged — close it instead of reverting`);
  const mergeSha = prBody.merge_commit_sha;
  if (!mergeSha) return fail('provider_error', `pull request #${input.number} is merged but reports no merge commit`);

  // 2 — the merge commit: its first parent is the base as it stood BEFORE the
  //     merge, and its file list is exactly what the merge changed.
  const merge = await getJson(`${repoBase}/commits/${mergeSha}`, token);
  if (!merge || merge.status < 200 || merge.status >= 300) {
    return fail('provider_error', `could not read merge commit ${mergeSha.slice(0, 7)}`);
  }
  const mergeBody = (merge.body ?? {}) as {
    parents?: Array<{ sha?: string }>;
    files?: Array<{ filename?: string; status?: string }>;
  };
  const parentSha = mergeBody.parents?.[0]?.sha;
  if (!parentSha) return fail('provider_error', `merge commit ${mergeSha.slice(0, 7)} has no parent to restore from`);
  const mergedPaths = (mergeBody.files ?? []).map((f) => f.filename).filter((p): p is string => !!p);
  if (mergedPaths.length === 0) return fail('provider_error', `merge commit ${mergeSha.slice(0, 7)} reports no changed files`);

  // 3 — conflict guard. Anything landing on these paths AFTER the merge would be
  //     silently discarded by a content restore, so refuse and let a human decide.
  const since = await getJson(`${repoBase}/compare/${mergeSha}...${encodeURIComponent(input.base)}`, token);
  if (!since || since.status < 200 || since.status >= 300) {
    return fail('provider_error', `could not check for changes landed after the merge`);
  }
  const sinceBody = (since.body ?? {}) as { files?: Array<{ filename?: string }> };
  const touchedSince = new Set((sinceBody.files ?? []).map((f) => f.filename).filter((p): p is string => !!p));
  const clashes = mergedPaths.filter((p) => touchedSince.has(p));
  if (clashes.length > 0) {
    return fail('conflict', `${clashes.length} file(s) changed on '${input.base}' after the merge (${clashes.slice(0, 3).join(', ')}) — refusing to revert over newer work`);
  }

  // 4 — current base head + its tree, which the revert commit is built on top of.
  const ref = await getJson(`${repoBase}/git/ref/heads/${input.base.split('/').map(encodeURIComponent).join('/')}`, token);
  const headSha = ((ref?.body ?? {}) as { object?: { sha?: string } }).object?.sha;
  if (!headSha) return fail('provider_error', `could not resolve the head of '${input.base}'`);
  const headCommit = await getJson(`${repoBase}/git/commits/${headSha}`, token);
  const headTree = ((headCommit?.body ?? {}) as { tree?: { sha?: string } }).tree?.sha;
  if (!headTree) return fail('provider_error', `could not resolve the tree of '${input.base}'`);

  // 5 — the pre-merge blob (and mode) for each merged path. A path absent from the
  //     parent tree was ADDED by the merge, so reverting it means deleting it.
  const parentTree = await getJson(`${repoBase}/git/trees/${parentSha}?recursive=1`, token);
  const parentBody = (parentTree?.body ?? {}) as { tree?: Array<{ path?: string; mode?: string; type?: string; sha?: string }>; truncated?: boolean };
  if (parentBody.truncated) {
    // A truncated tree cannot distinguish "added by the merge" from "too big to
    // list", and guessing there means deleting files at random. Refuse instead.
    return fail('provider_error', `the pre-merge tree of ${parentSha.slice(0, 7)} is too large for GitHub to list in full — cannot revert safely`);
  }
  const byPath = new Map((parentBody.tree ?? [])
    .filter((e) => e.type === 'blob' && e.path)
    .map((e) => [e.path as string, e]));
  const entries: TreeEntry[] = mergedPaths.map((path) => {
    const prev = byPath.get(path);
    return prev?.sha
      ? { path, mode: prev.mode ?? '100644', type: 'blob' as const, sha: prev.sha }
      : { path, mode: '100644', type: 'blob' as const, sha: null };
  });

  // 6 — write tree → commit → branch → PR. Only the FIRST of these is destructive
  //     in any sense, and none of them touches `input.base`.
  const tree = await postJson(`${repoBase}/git/trees`, token, { base_tree: headTree, tree: entries });
  const treeSha = ((tree?.body ?? {}) as { sha?: string }).sha;
  if (!tree?.ok || !treeSha) return fail('provider_error', `could not create the revert tree: ${String(tree?.body ?? 'network').slice(0, 200)}`);

  const commit = await postJson(`${repoBase}/git/commits`, token, {
    message: input.title,
    tree: treeSha,
    parents: [headSha],
  });
  const commitSha = ((commit?.body ?? {}) as { sha?: string }).sha;
  if (!commit?.ok || !commitSha) return fail('provider_error', `could not create the revert commit: ${String(commit?.body ?? 'network').slice(0, 200)}`);

  const branchRef = await postJson(`${repoBase}/git/refs`, token, { ref: `refs/heads/${input.revertBranch}`, sha: commitSha });
  if (!branchRef?.ok) {
    return fail('provider_error', `could not create branch '${input.revertBranch}': ${String(branchRef?.body ?? 'network').slice(0, 200)}`);
  }

  return openRevertPr(input, mergeSha);
}

// ── GitLab ────────────────────────────────────────────────────────────────────

/**
 * Reverse a merged GitLab MR using GitLab's own commit-revert API, which performs
 * a real revert (with real conflict detection) server-side. The revert is applied
 * to a fresh branch cut from the base; a conflict leaves that branch unused, so it
 * is cleaned up before returning.
 */
async function revertGitlab(input: RevertMergedPrInput): Promise<RevertMergedPrResult> {
  const api = resolveRepoApiTarget(input);
  const projectBase = api.repoBase;
  const { token } = input;

  const mr = await getJson(api.pullRequest(input.number), token);
  if (!mr) return fail('provider_error', 'MR lookup failed (network)');
  if (mr.status === 404) return fail('not_found', `merge request !${input.number} not found`);
  if (mr.status < 200 || mr.status >= 300) return fail('provider_error', `GitLab ${mr.status}: ${String(mr.body).slice(0, 200)}`);
  const mrBody = (mr.body ?? {}) as { state?: string; merge_commit_sha?: string | null; squash_commit_sha?: string | null };
  if (mrBody.state !== 'merged') return fail('not_merged', `merge request !${input.number} is not merged — close it instead of reverting`);
  // A squashed MR lands as `squash_commit_sha`; it is the commit to reverse.
  const landedSha = mrBody.merge_commit_sha || mrBody.squash_commit_sha;
  if (!landedSha) return fail('provider_error', `merge request !${input.number} is merged but reports no landed commit`);

  const branch = await postJson(
    `${projectBase}/repository/branches?branch=${encodeURIComponent(input.revertBranch)}&ref=${encodeURIComponent(input.base)}`,
    token, {},
  );
  if (!branch?.ok) {
    return fail('provider_error', `could not create branch '${input.revertBranch}': ${String(branch?.body ?? 'network').slice(0, 200)}`);
  }

  const revert = await postJson(`${projectBase}/repository/commits/${landedSha}/revert`, token, { branch: input.revertBranch });
  if (!revert?.ok) {
    // Best-effort cleanup: leaving an empty branch behind after a refusal is the
    // residue this whole subsystem exists to avoid.
    await fetch(`${projectBase}/repository/branches/${encodeURIComponent(input.revertBranch)}`, {
      method: 'DELETE', headers: headers(token),
    }).catch((error) => { /* best-effort */ 
      reportCaughtError(error, { source: "application/repos/revertMergedPullRequest.ts", operation: "revertGitlab" });
    });
    const text = String(revert?.body ?? 'network');
    // GitLab's conflict answer is prose, not a code: "Sorry, we cannot revert this
    // commit automatically… a more recent commit may have updated some of its
    // content." That is a conflict, not an outage, and must not read as one.
    if (revert && (revert.status === 400 || revert.status === 409)
      && /conflict|cannot (be )?revert|already been reverted|empty/i.test(text)) {
      return fail('conflict', `GitLab could not revert ${landedSha.slice(0, 7)} onto '${input.base}': ${text.slice(0, 200)}`);
    }
    return fail('provider_error', `revert of ${landedSha.slice(0, 7)} failed: ${text.slice(0, 200)}`);
  }

  return openRevertPr(input, landedSha);
}

// ── Bitbucket Cloud ───────────────────────────────────────────────

/**
 * Reverse a merged Bitbucket CLOUD pull request by restoring each merged file to its
 * PRE-merge content on a new branch, then opening a PR for it.
 *
 * Same algorithm as the GitHub path and for the same reason — no provider has a
 * PR-level revert, and neither the Git Data API nor `/src` can do a three-way merge —
 * so the "nothing else has touched these files since" precondition is CHECKED here
 * too, and a violation refuses as `conflict` rather than discarding newer work.
 *
 * The Cloud-specific part is the write: `/src` takes ONE form POST carrying every
 * changed file at once (`<path>=<content>` restores, repeated `files=<path>` deletes)
 * plus `parents` to pin the commit's parent and `branch` to create the branch — so
 * the whole revert is a single atomic commit, with no separate branch-create call.
 */
async function revertBitbucketCloud(input: RevertMergedPrInput, api: RepoApiTarget): Promise<RevertMergedPrResult> {
  const { token } = input;

  // 1 — the PR must be merged, and we need the commit it merged as.
  const pr = await getJson(api.pullRequest(input.number), token);
  if (!pr) return fail('provider_error', 'PR lookup failed (network)');
  if (pr.status === 404) return fail('not_found', `pull request #${input.number} not found`);
  if (pr.status < 200 || pr.status >= 300) return fail('provider_error', `Bitbucket ${pr.status}: ${String(pr.body).slice(0, 200)}`);
  const prBody = (pr.body ?? {}) as { state?: string; merge_commit?: { hash?: string } | null };
  if ((prBody.state ?? '').toUpperCase() !== 'MERGED') {
    return fail('not_merged', `pull request #${input.number} is not merged — close it instead of reverting`);
  }
  const mergeSha = prBody.merge_commit?.hash;
  if (!mergeSha) return fail('provider_error', `pull request #${input.number} is merged but reports no merge commit`);

  // 2 — the merge commit's FIRST parent is the base as it stood before the merge.
  const merge = await getJson(`${api.repoBase}/commit/${encodeURIComponent(mergeSha)}`, token);
  if (!merge || merge.status < 200 || merge.status >= 300) {
    return fail('provider_error', `could not read merge commit ${mergeSha.slice(0, 7)}`);
  }
  const parentSha = ((merge.body ?? {}) as { parents?: Array<{ hash?: string }> }).parents?.[0]?.hash;
  if (!parentSha) return fail('provider_error', `merge commit ${mergeSha.slice(0, 7)} has no parent to restore from`);

  // 3 — what the merge changed. Cloud has no compare, so the diffstat between the
  //     merge and its first parent is the equivalent of GitHub's `commit.files`.
  const merged = await bitbucketChangedPaths(api, parentSha, mergeSha, token);
  if (!merged) return fail('provider_error', `could not list the files changed by ${mergeSha.slice(0, 7)}`);
  if (merged.length === 0) return fail('provider_error', `merge commit ${mergeSha.slice(0, 7)} reports no changed files`);

  // 4 — conflict guard: anything that landed on those paths AFTER the merge would be
  //     silently discarded by a content restore.
  const since = await bitbucketChangedPaths(api, mergeSha, input.base, token);
  if (!since) return fail('provider_error', 'could not check for changes landed after the merge');
  const touchedSince = new Set(since);
  const clashes = merged.filter((p) => touchedSince.has(p));
  if (clashes.length > 0) {
    return fail('conflict', `${clashes.length} file(s) changed on '${input.base}' after the merge (${clashes.slice(0, 3).join(', ')}) — refusing to revert over newer work`);
  }

  // 5 — the head of base (the revert's parent) and the PRE-merge bytes of each path.
  //     A path with no pre-merge content was ADDED by the merge, so reverting it is a
  //     deletion — which on Cloud is a `files=` field rather than a content field.
  const headSha = await bitbucketBranchHead(api, input.base, token);
  if (!headSha) return fail('provider_error', `could not resolve the head of '${input.base}'`);

  const restores: Array<{ path: string; content: string }> = [];
  const deletes: string[] = [];
  for (const path of merged) {
    const res = await fetch(api.fileContent(path, parentSha), { headers: headers(token) }).catch(() => null);
    if (res && res.ok) {
      const content = await res.text().catch(() => null);
      if (content === null) return fail('provider_error', `could not read the pre-merge content of ${path}`);
      restores.push({ path, content });
    } else if (res && res.status === 404) {
      deletes.push(path);
    } else {
      // Anything other than a clean 200/404 means we do not KNOW the pre-merge state,
      // and guessing there writes the wrong content or deletes a live file.
      return fail('provider_error', `could not read the pre-merge content of ${path}${res ? ` (Bitbucket ${res.status})` : ''}`);
    }
  }

  // 6 — one form POST: the revert commit, on its own branch, parented to the current
  //     head of base. Nothing here touches `input.base`.
  const form = new URLSearchParams();
  form.set('branch', input.revertBranch);
  form.set('message', input.title);
  form.set('parents', headSha);
  for (const r of restores) form.set(r.path, r.content);
  for (const d of deletes) form.append('files', d);

  const written = await fetch(api.fileWrite(''), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'BuilderForce-Revert-Merge/1.0',
    },
    body: form.toString(),
  }).catch(() => null);
  if (!written) return fail('provider_error', 'revert-commit request failed (network)');
  if (!written.ok) {
    const text = await written.text().catch(() => '');
    return fail('provider_error', `could not create the revert commit: Bitbucket ${written.status}: ${text.slice(0, 200)}`);
  }

  return openRevertPr(input, mergeSha);
}

/** Paths changed between two refs, via Cloud's `/diffstat/{to}..{from}`. Null means
 *  the listing FAILED (which must never be read as "nothing changed"). */
async function bitbucketChangedPaths(
  api: RepoApiTarget,
  from: string,
  to: string,
  token: string,
): Promise<string[] | null> {
  const url = `${api.repoBase}/diffstat/${encodeURIComponent(to)}..${encodeURIComponent(from)}?pagelen=100`;
  const res = await fetch(url, { headers: headers(token) }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    values?: Array<{ new?: { path?: string } | null; old?: { path?: string } | null }>;
  } | null;
  if (!body || !Array.isArray(body.values)) return null;
  return body.values
    .map((v) => v.new?.path ?? v.old?.path)
    .filter((p): p is string => !!p);
}

/** Current head commit of a branch on Bitbucket Cloud. */
async function bitbucketBranchHead(api: RepoApiTarget, branch: string, token: string): Promise<string | null> {
  const res = await fetch(`${api.branches()}/${encodeURIComponent(branch)}`, { headers: headers(token) }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = (await res.json().catch(() => null)) as { target?: { hash?: string } } | null;
  return body?.target?.hash ?? null;
}

// ── shared tail ───────────────────────────────────────────────────────────────

/** Open the revert PR itself, reusing the one create-PR implementation (and its
 *  idempotency) rather than a second copy of the per-provider create bodies. */
async function openRevertPr(input: RevertMergedPrInput, revertedSha: string): Promise<RevertMergedPrResult> {
  const created = await createPullRequest({
    provider: input.provider,
    host: input.host,
    owner: input.owner,
    repo: input.repo,
    token: input.token,
    head: input.revertBranch,
    base: input.base,
    title: input.title,
    body: input.body,
  });
  if (!created.ok) {
    // The revert branch EXISTS at this point and the reversal is on it — say so,
    // so the operator can open the PR by hand instead of assuming nothing happened.
    return fail(
      created.code === 'unsupported' ? 'unsupported' : 'provider_error',
      `the revert commit was pushed to '${input.revertBranch}' but the pull request could not be opened: ${created.reason}`,
    );
  }
  return { ok: true, number: created.number, url: created.url, branch: input.revertBranch, revertedSha };
}

/**
 * Open a pull request that reverses a MERGED pull request's landed commits.
 *
 * Returns the same structured refusal shape as the rest of this directory for the ONE
 * dialect that genuinely cannot do it (Bitbucket Server) — the caller records that
 * refusal on the run's rollback row and in the audit trail, so "we did not undo this"
 * is a visible fact rather than a silent gap.
 */
export async function revertMergedPullRequest(input: RevertMergedPrInput): Promise<RevertMergedPrResult> {
  let flavor: ReturnType<typeof resolveGitApiFlavor>;
  try {
    flavor = resolveGitApiFlavor(input.provider, input.host);
  } catch (e) {
    return fail('unsupported', e instanceof Error ? e.message : `merge revert not implemented for provider '${input.provider}'`);
  }
  if (!input.revertBranch.trim() || !input.base.trim()) {
    return fail('provider_error', 'a revert needs both a base branch and a branch name to revert on');
  }
  if (input.revertBranch.trim() === input.base.trim()) {
    // The one thing this module must never do, asserted rather than assumed.
    return fail('provider_error', 'refusing to commit a revert directly onto the base branch');
  }

  if (flavor === 'github') return revertGithub(input);
  if (flavor === 'gitlab') return revertGitlab(input);
  if (flavor === 'bitbucket-cloud') return revertBitbucketCloud(input, resolveRepoApiTarget(input));
  // Bitbucket Server ONLY. Named concretely, because a refusal whose reason is just
  // "unsupported" is indistinguishable from one we never looked into.
  return fail(
    'unsupported',
    'Bitbucket Server cannot express a revert: `/rest/api/1.0` writes one file per request '
    + '(`PUT /browse/{path}`) and has no delete-file endpoint, so a multi-file revert cannot be '
    + `one commit and a removal cannot be written at all — revert the merge commit with a push and `
    + `open a pull request against '${input.base}'`,
  );
}

/** The branch a run's merge-revert lands on. Task-scoped so a re-attempt after a
 *  failure collides with (rather than silently duplicating) the previous try. */
export function revertBranchName(taskId: number, prNumber: number): string {
  return `builderforce/revert-task-${taskId}-pr-${prNumber}`;
}

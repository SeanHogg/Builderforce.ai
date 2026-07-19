/**
 * publishReviewToPr — put an acceptance review on the pull request it is about.
 *
 * WHY THIS EXISTS
 * The platform reviews its own work in two ways, and until now neither was
 * visible where the merge decision gets made:
 *
 *   1. The Validator agent re-reads a Done ticket against the codebase and
 *      records a verdict + gaps (`reviews.record` → ValidationService).
 *   2. A human holding the reviewer role signs the ticket off, or requests
 *      changes (`recordSignoff` / the approval decision route).
 *
 * Both wrote only to Builderforce tables. A reviewer looking at the PR on
 * github.com saw an agent's PR with no indication that anything had reviewed it,
 * which is precisely backwards: the review exists to inform the merge, and the
 * merge happens on GitHub.
 *
 * ── Anchored vs unanchored findings ──────────────────────────────────────────
 * A gap with a `path`+`line` is posted as an INLINE comment on that line. A gap
 * without one goes in the review body. That split is not a quality ranking —
 * "no tests were added" is often the most important finding in a review and has
 * nowhere to point. Both are published; only the placement differs.
 *
 * ── The 422 hazard (the load-bearing detail) ─────────────────────────────────
 * GitHub rejects an ENTIRE review with a 422 if ANY inline comment anchors to a
 * path/line outside the PR's diff. A reviewer legitimately commenting on a file
 * the PR did not touch would therefore silently destroy the whole review,
 * including all the valid findings.
 *
 * So anchors are validated against the PR's actual changed files BEFORE posting,
 * and anything outside the diff is demoted into the review body rather than
 * dropped. Losing a finding is not an acceptable failure mode for a review.
 */
import {
  resolveTaskPrTarget,
  CHECK_NAMES,
  type TaskPrTarget,
} from '../checks/publishTaskVerdict';
import { publishCheckRun, type CheckAnnotation, type CheckConclusion } from '../checks/publishCheckRun';
import { postPrReviewComments, postRepoPrComment, type PrInlineComment } from '../repos/postPrComment';
import { githubRequest, repoPath } from '../repos/githubClient';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { ReviewGapInput, ReviewVerdict } from './ValidationService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export interface ReviewToPublish {
  verdict: ReviewVerdict;
  summary: string | null;
  gaps: ReviewGapInput[];
  reviewerRef: string | null;
}

export type PublishReviewOutcome =
  | { published: true; inlineComments: number; demoted: number; via: 'review' | 'comment' }
  | { published: false; reason: string };

/**
 * The PR's changed file paths, cached by head SHA.
 *
 * Keyed on the SHA rather than the PR id because the file set is immutable for a
 * given commit — a new push produces a new SHA and therefore a new key, so this
 * can never serve a stale diff. Worth caching: a review with N anchored gaps
 * would otherwise re-fetch the same list per publish, inside a Worker with a
 * tight subrequest budget.
 */
async function changedPaths(env: Env, target: TaskPrTarget): Promise<Set<string> | null> {
  const key = `pr-files:${target.prId}:${target.headSha}`;
  try {
    const paths = await getOrSetCached<string[]>(
      env,
      key,
      async () => {
        // 300 files is GitHub's practical ceiling for this endpoint without
        // pagination. A PR larger than that is not one anybody reviews line by
        // line, and the demote-to-body path below keeps its findings anyway.
        const res = await githubRequest<Array<{ filename: string }>>({
          coords: target.auth.coords,
          token: target.auth.token,
          path: repoPath(target.auth.coords, `/pulls/${target.prNumber}/files?per_page=300`),
        });
        if (!res.ok) throw new Error(res.reason);
        return res.data.map((f) => f.filename);
      },
      { kvTtlSeconds: 600, l1TtlMs: 60_000 },
    );
    return new Set(paths);
  } catch {
    // Could not determine the diff. Returning null makes the caller demote every
    // anchor to the body — strictly worse presentation, but it cannot 422 away
    // an entire review, which is the outcome that actually loses information.
    return null;
  }
}

interface Partitioned {
  inline: PrInlineComment[];
  body: ReviewGapInput[];
}

/**
 * Split gaps into those that can safely be posted inline and those that must go
 * in the body. `diff === null` means the changed-file list was unavailable, in
 * which case everything is demoted (see changedPaths).
 */
export function partitionByDiffAnchor(gaps: ReviewGapInput[], diff: Set<string> | null): Partitioned {
  const inline: PrInlineComment[] = [];
  const body: ReviewGapInput[] = [];

  for (const gap of gaps) {
    const anchorable =
      diff !== null &&
      typeof gap.path === 'string' &&
      gap.path.length > 0 &&
      typeof gap.line === 'number' &&
      Number.isFinite(gap.line) &&
      gap.line > 0 &&
      diff.has(gap.path);

    if (anchorable) {
      inline.push({
        path: gap.path as string,
        line: gap.line as number,
        body: gap.detail ? `**${gap.title}**\n\n${gap.detail}` : `**${gap.title}**`,
      });
    } else {
      body.push(gap);
    }
  }
  return { inline, body };
}

function renderBody(review: ReviewToPublish, demoted: ReviewGapInput[], inlineCount: number): string {
  const verdictLine =
    review.verdict === 'complete'
      ? '**Verdict: complete** — the delivered code satisfies the ticket.'
      : `**Verdict: gaps** — ${review.gaps.length} gap(s) found.`;

  const parts = [`### Acceptance review\n\n${verdictLine}`];
  if (review.summary) parts.push(review.summary);

  if (demoted.length) {
    // Say WHY these are here rather than inline, otherwise it reads like the
    // reviewer was inconsistent about where it put things.
    const heading = inlineCount
      ? `**Gaps not tied to a changed line** (${demoted.length})`
      : `**Gaps** (${demoted.length})`;
    const items = demoted
      .map((g) => {
        const where = g.path ? ` — \`${g.path}${g.line ? `:${g.line}` : ''}\`` : '';
        return `- **${g.title}**${where}${g.detail ? `\n  ${g.detail}` : ''}`;
      })
      .join('\n');
    parts.push(`${heading}\n${items}`);
  }

  if (inlineCount) parts.push(`_${inlineCount} further gap(s) posted as inline comments on the diff._`);
  if (review.reviewerRef) parts.push(`\n<sub>Reviewed by \`${review.reviewerRef}\`.</sub>`);
  return parts.join('\n\n');
}

function annotationsFrom(inline: PrInlineComment[], gaps: ReviewGapInput[]): CheckAnnotation[] {
  const byPathLine = new Map(gaps.filter((g) => g.path).map((g) => [`${g.path}:${g.line}`, g]));
  return inline.map((c) => {
    const gap = byPathLine.get(`${c.path}:${c.line}`);
    return {
      path: c.path,
      startLine: c.line,
      endLine: c.line,
      // A gap is missing work, not a broken build — `warning` reads correctly in
      // the Files-changed gutter without implying the code is invalid.
      level: 'warning' as const,
      message: gap?.detail ?? gap?.title ?? 'Gap found during acceptance review.',
      title: gap?.title,
    };
  });
}

/**
 * Publish a Validator (or agent) acceptance review to the ticket's PR.
 *
 * Never throws — a review is already durably recorded before this runs, and a
 * GitHub failure must not lose it.
 */
export async function publishReviewToPr(
  env: Env,
  db: Db,
  tenantId: number,
  taskId: number,
  review: ReviewToPublish,
): Promise<PublishReviewOutcome> {
  try {
    const resolved = await resolveTaskPrTarget(env, db, tenantId, taskId);
    if (!resolved.ok) return { published: false, reason: resolved.reason };
    const target = resolved.target;

    const diff = await changedPaths(env, target);
    const { inline, body: demoted } = partitionByDiffAnchor(review.gaps, diff);
    const bodyText = renderBody(review, demoted, inline.length);

    // Mirror the verdict into the merge box as well as the conversation. `gaps`
    // maps to action_required rather than failure: work is missing, which is not
    // the same as the change being broken, and a red X would push reviewers to
    // dismiss the check rather than read it.
    const conclusion: CheckConclusion = review.verdict === 'complete' ? 'success' : 'action_required';
    await publishCheckRun(target.auth, {
      name: CHECK_NAMES.review,
      headSha: target.headSha,
      status: 'completed',
      conclusion,
      title:
        review.verdict === 'complete'
          ? 'Acceptance review passed'
          : `Acceptance review found ${review.gaps.length} gap(s)`,
      summary: review.summary ?? 'Acceptance review completed.',
      annotations: annotationsFrom(inline, review.gaps),
    }).catch(() => { /* best-effort — the review comment below is the primary surface */ });

    const posted = await postPrReviewComments(target.auth, target.prNumber, target.headSha, inline, {
      body: bodyText,
    });

    if (posted.ok) {
      return { published: true, inlineComments: inline.length, demoted: demoted.length, via: 'review' };
    }

    // The review call failed as a unit (most plausibly a line that moved between
    // our diff read and the post). Re-send everything as one conversation comment
    // so the findings survive; presentation degrades, information does not.
    const fallbackBody = renderBody(review, review.gaps, 0);
    const comment = await postRepoPrComment(
      env, db, tenantId, target.auth.repo.id, target.prNumber, fallbackBody,
      { kind: 'review', scope: `${taskId}:${target.headSha}` },
    );
    if (!comment.ok) return { published: false, reason: comment.reason };
    return { published: true, inlineComments: 0, demoted: review.gaps.length, via: 'comment' };
  } catch (e) {
    return { published: false, reason: (e as Error).message };
  }
}

/**
 * Publish a HUMAN reviewer's sign-off to the ticket's PR.
 *
 * The human path has no per-file capability — the in-product sign-off UI takes a
 * verdict plus free text, so there is nothing to anchor. This posts the verdict
 * as a conversation comment and mirrors it to the same check the Validator uses,
 * so "who accepted this and what did they say" is answerable from the PR whether
 * the reviewer was an agent or a person.
 */
export async function publishSignoffToPr(
  env: Env,
  db: Db,
  tenantId: number,
  taskId: number,
  signoff: {
    roleKey: string;
    verdict: 'approved' | 'changes_requested' | 'waived' | 'delegated';
    summary?: string | null;
    reviewerName?: string | null;
  },
): Promise<PublishReviewOutcome> {
  try {
    const resolved = await resolveTaskPrTarget(env, db, tenantId, taskId);
    if (!resolved.ok) return { published: false, reason: resolved.reason };
    const target = resolved.target;

    const label: Record<typeof signoff.verdict, string> = {
      approved: 'Approved',
      changes_requested: 'Changes requested',
      waived: 'Waived',
      delegated: 'Delegated',
    };
    // waived/delegated are procedural outcomes, not judgements on the code, so
    // they land as `neutral` — marking them success would overstate the review,
    // and failure would block on a formality.
    const conclusion: CheckConclusion =
      signoff.verdict === 'approved' ? 'success'
        : signoff.verdict === 'changes_requested' ? 'action_required'
          : 'neutral';

    const who = signoff.reviewerName ? ` by ${signoff.reviewerName}` : '';
    const body = [
      `### ${label[signoff.verdict]}${who}`,
      `Role: \`${signoff.roleKey}\``,
      signoff.summary ? signoff.summary : '_No reviewer note provided._',
    ].join('\n\n');

    await publishCheckRun(target.auth, {
      name: CHECK_NAMES.review,
      headSha: target.headSha,
      status: 'completed',
      conclusion,
      title: `${label[signoff.verdict]}${who} (${signoff.roleKey})`,
      summary: signoff.summary ?? `Ticket sign-off recorded: ${label[signoff.verdict]}.`,
    }).catch(() => { /* best-effort */ });

    const comment = await postRepoPrComment(
      env, db, tenantId, target.auth.repo.id, target.prNumber, body,
      // Scoped by role AND head SHA: re-approving after a new push is a genuinely
      // new statement and should post again, but a double-submit on the same
      // commit must not.
      { kind: 'review', scope: `signoff:${signoff.roleKey}:${target.headSha}` },
    );
    if (!comment.ok) return { published: false, reason: comment.reason };
    return { published: true, inlineComments: 0, demoted: 0, via: 'comment' };
  } catch (e) {
    return { published: false, reason: (e as Error).message };
  }
}

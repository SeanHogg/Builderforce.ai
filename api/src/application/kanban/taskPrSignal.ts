/**
 * The ONE read of "what pull request does this ticket have, and is its build green?".
 *
 * Three separate consumers were each about to grow their own version of this query:
 * producer-completion evidence on the participation manifest
 * ({@link ../kanban/attributeRunToManifest}), the `has_pr` requirement predicate
 * ({@link ../kanban/types.requirementApplies}), and the lane gate that scopes a lane's
 * requirements to the ticket in front of it. They must agree — a requirement that
 * applies only "once a PR exists" and an evidence rule that credits a producer "because
 * a PR exists" cannot be reading two different definitions of *exists* — so the read and
 * the two pure predicates over it live here and nowhere else.
 *
 * Split pure/IO on purpose: {@link isProducerPrEvidence} and {@link hasNonDraftPr} are
 * testable without a database, which is where the CI-green rule below is actually
 * pinned down.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { pullRequests } from '../../infrastructure/database/schema';

/** The latest pull-request row for a ticket, reduced to the fields any gate reads. */
export interface TaskPrSignal {
  url: string | null;
  /** `draft` | `open` | `merged` | `closed` … — provider-normalized. */
  status: string | null;
  /** `null` | `pending` | `success` | `failure` — the recorded build verdict (0107). */
  buildStatus: string | null;
}

/**
 * Does this ticket carry a pull request that counts as EXISTING for gating purposes?
 *
 * A draft PR does not: it is the author saying "not ready to look at yet", so treating
 * it as a PR would let a requirement scoped to `has_pr` fire before there is anything
 * to review.
 */
export function hasNonDraftPr(pr: TaskPrSignal | null | undefined): boolean {
  return !!pr && pr.status !== 'draft';
}

/**
 * Is this pull request good enough to CREDIT a producer's manifest slot?
 *
 * Stricter than {@link hasNonDraftPr} by exactly one rule: **a recorded RED build is not
 * evidence of a finished deliverable.** Crediting a producer for a branch whose CI is
 * failing is the shape of accountability theatre the manifest exists to prevent — the
 * slot closes, the reviewer stage opens, and a human eventually discovers the work never
 * built.
 *
 * It deliberately does NOT demand a green build outright. `build_status` is `null` for
 * every repo with no CI wired and for every PR whose first workflow has not reported
 * yet; requiring `'success'` unconditionally would mean producers on those repos are
 * never credited at all, which trades a soft over-credit for a hard total failure. The
 * honest rule is therefore: **a build verdict, if one exists, must not be `failure`**.
 * `pending` still credits — the merge gate (`requireGreenBuild`) is what refuses to LAND
 * an unbuilt branch, and that is the correct place for that decision.
 */
export function isProducerPrEvidence(pr: TaskPrSignal | null | undefined): boolean {
  if (!hasNonDraftPr(pr)) return false;
  return pr!.buildStatus !== 'failure';
}

/** The latest pull request recorded for a ticket, or null. Tenant-scoped. */
export async function loadTaskPrSignal(db: Db, tenantId: number, taskId: number): Promise<TaskPrSignal | null> {
  const [pr] = await db
    .select({ url: pullRequests.url, status: pullRequests.status, buildStatus: pullRequests.buildStatus })
    .from(pullRequests)
    .where(and(eq(pullRequests.tenantId, tenantId), eq(pullRequests.taskId, taskId)))
    .orderBy(desc(pullRequests.createdAt))
    .limit(1);
  return pr ?? null;
}

/**
 * Producer completion evidence for a ticket: the PR URL when the PR qualifies under
 * {@link isProducerPrEvidence}, otherwise null.
 *
 * Falls back to a synthetic `pr:task-<id>` handle when the provider row carries no URL,
 * so the manifest records *that* a PR existed even when the adapter could not return a
 * link (GitLab/Bitbucket `commitUrl` gaps).
 */
export function producerPrEvidence(pr: TaskPrSignal | null | undefined, taskId: number): string | null {
  if (!isProducerPrEvidence(pr)) return null;
  return pr!.url ?? `pr:task-${taskId}`;
}

/**
 * cloudFinalize — landing a finished cloud run: the pull request, the run summary and
 * the ticket stamps. The run never merges (PRD 48 §4.3): the PR merge sweep does. Moved verbatim out of
 * `cloudAgentEngine.ts` (PRD 35 WS3): this is HOST work above the one agent (the board
 * and governance layer, §6.9), not run policy. Shared by the cloud adapter and the
 * Container executor's `container-op` endpoint.
 */
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { and, eq } from 'drizzle-orm';
import { recordRunReflection } from '../skills/skillReflection';
import { type TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { recordTaskPullRequest } from '../repos/recordTaskPullRequest';
import { publishAgentRunVerdict } from '../checks/publishTaskVerdict';
import { postRepoPrComment } from '../repos/postPrComment';
import { openTaskRepoSetPullRequests } from '../repos/openTaskPullRequest';
import { RUN_CANCELLED_NOTICE } from '@builderforce/agent-run';
import { contributeTextToProjectEverminds } from '../llm/projectEvermind';
import { finalizeLearnWeight, runProducedOutput } from './outcomeScore';
import { recordCloudToolEvent } from './cloudToolEvents';
import { openOrAdoptRunPr } from './openOrAdoptRunPr';
import { runPullRequestText } from './runPullRequestText';
import { recordRunRollbackSnapshot } from './runRollback';
import { teardownRunBranch } from './runBranchTeardown';
import { recordCloudRunAttributions } from '../runOutcomes/cloudAttribution';
import type { BranchCommit } from '../repos/branchLifecycle';
import { resolveAppBaseUrl } from '../../env';
import type { Env } from '../../env';
import { recordTypedExecutionClaim } from '../provenance/finishClaimService';
import { revokeRunPrincipal } from '../agentIdentity/agentRunIdentity';
import { inspectOutboundContent } from '../trust/trustService';
import { type Db } from '../../infrastructure/database/connection';
import { executions, tasks } from '../../infrastructure/database/schema';
import { gateRunPullRequest } from './cloudFinalizeSecurity';
import { bindGrantToThisRunsPr, voidMergeGrant } from './mergeGrants';
import { findOpenPullRequestByTask } from '../repos/recordPullRequestRow';

/**
 * Land a finished cloud run: open a PR (recording it for the in-product approval
 * flow and the merge sweep), run its security step, and emit the `pr_opened` timeline
 * event. The single finalize implementation, shared by the in-worker tool loop
 * ({@link runCloudToolLoop}) and the long-lived Container executor (which runs the
 * loop in its own process and calls this via the internal container-op endpoint).
 * The run ALWAYS stops with the PR open: whether and when it merges is the project's
 * setting, applied by `repos/prMergeSweep.ts` — never an env flag (PRD 48 §4.3).
 * Never throws.
 */
export async function finalizeCloudRun(
  env: Env,
  db: Db,
  args: {
    tenantId: number;
    cloudAgentRef: string | undefined;
    executionId: number;
    taskRow: { id: number; title: string };
    agentLabel: string;
    repoCtx: TicketRepoContext | null;
    /** Why repo resolution failed (empty when it succeeded) — surfaced when no PR opens. */
    repoMiss?: string;
    writtenPaths: Set<string>;
    finalOutput: string;
    cancelled: boolean;
    /** True when in-run branch CI reported success before finish (ticket #3092). */
    ciVerified?: boolean;
  },
): Promise<{ ok: boolean; output: string }> {
  const { tenantId, cloudAgentRef, executionId, taskRow, agentLabel, repoCtx, repoMiss, writtenPaths, finalOutput, cancelled } = args;
  const ciVerified = !!args.ciVerified;
  // A steer that arrived after the loop's last step is NOT released here: the row is
  // not terminal yet, and such a steer now starts a follow-up run (lateSteerFollowUp.ts)
  // that must never start beside the run it follows. Each surface settles it right
  // after its terminal transition — CloudRunnerDO.cleanup, and the container / GitHub
  // Actions `finalize` op.
  let prOpened = false;
  let mergeNote = '';
  // When files were produced but no PR ends up open, capture WHY so the run's
  // summary / timeline explains it instead of silently showing no Pull Request tab.
  let noPrReason = '';
  // A person's merge grant on this run (PRD 48 §4.6): the PR it would bind, and whether it was
  // bound (or already settled — a void here is final, so the "no PR" void below must not repeat it).
  let grantTarget: { prRowId: string; headSha: string | null } | null = null;
  let grantBound = false;
  // The PR this finalize opened, hoisted so the rollback snapshot below can record
  // exactly what a later revert would have to close.
  let openedPrNumber: number | null = null;
  let openedPrUrl: string | null = null;
  let openedPrRowId: string | null = null;
  // Atomic single-PR claim (0140), via the ONE task PR-open step the Done-drag path
  // also uses (`openClaimedPullRequest`): claim BEFORE the external create so this
  // inline run-end finalize can't open a duplicate PR alongside a concurrent human
  // Done-drag. Lost claim => another path is opening the PR; skip everything below
  // and treat it as "PR exists". A failed create has already released the claim.
  const prText = runPullRequestText({ taskId: taskRow.id, taskTitle: taskRow.title, agentLabel, writtenPaths, ciVerified });
  // The run's own early draft is adopted here too (a lost claim, or a dead claim's unrecorded draft).
  const { opened, ownDraft } = await openOrAdoptRunPr(db, {
    tenantId, cloudAgentRef, executionId, taskId: taskRow.id, repoCtx, open: writtenPaths.size > 0 && !cancelled, text: prText,
  });
  if (repoCtx && opened && !('claimLost' in opened)) {
    const pr = opened;
    prOpened = pr.ok;
    if (!pr.ok) noPrReason = pr.reason;

    // Record the PR row so the in-product Pull Request tab / approval flow can act on it. It is
    // ALWAYS recorded 'open': 'merged' is stamped only once a merge has actually happened. Keep the
    // row id so the security step can link its scans to it and the immediate-merge branch can stamp
    // its merge SHA (which correlates the post-merge build back to this task).
    let prRowId: string | null = null;
    if (pr.ok) {
      openedPrNumber = pr.number;
      openedPrUrl = pr.url;
      // Always recorded 'open': a PR is 'merged' only once a merge has actually happened
      // (`markPullRequestMergedById` below), and the security gate may still hold it open.
      // The early draft's row + stamp were written when it opened; otherwise the row AND the task's PR stamp are one write.
      const prRow = ownDraft ? { id: ownDraft.rowId } : await recordTaskPullRequest(db, {
        tenantId, segmentId: repoCtx.segmentId, projectId: repoCtx.projectId, repoId: repoCtx.repoId,
        taskId: taskRow.id, provider: repoCtx.provider, number: pr.number, url: pr.url,
        branchName: repoCtx.branch, baseBranch: repoCtx.base, status: 'open',
      }).catch(() => null);
      prRowId = prRow?.id ?? null;
      openedPrRowId = prRowId;
    }

    if (!pr.ok || !prRowId) await db.update(tasks) // no PR / no row for it: the branch (and any PR that did open) is still stamped
      .set({ gitBranch: repoCtx.branch, ...(pr.ok ? { githubPrUrl: pr.url, githubPrNumber: pr.number } : {}), updatedAt: new Date() })
      .where(eq(tasks.id, taskRow.id))
      .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudFinalize.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] task PR metadata update failed', details: { tenantId, executionId, taskId: taskRow.id, error } } }));

    // SECURITY STEP (PRD 08 §10): scan + review the PR now, so the verdict the merge sweep reads is
    // already recorded for this head (see cloudFinalizeSecurity: fails closed on a PR that is not recorded).
    const verdict = await gateRunPullRequest(env, db, { tenantId, cloudAgentRef, executionId, agentLabel, repoCtx, pr, prRowId });

    // PRD 48 §4.6 — a person's merge grant on THIS run binds to the PR this run opened. Bound after
    // the branch listing below, which is what proves the head is the run's own last commit.
    if (prOpened && prRowId) grantTarget = { prRowId, headSha: verdict.headSha };

    // THE RUN NEVER MERGES (PRD 48 §4.3). It opens its PR and ends; the PR merge sweep
    // (`repos/prMergeSweep.ts`) is the single merge writer and merges by the PROJECT's settings
    // (`allowAutoMerge`, `prMergePolicy`, `requireSignoffToComplete`, the security verdict).
    mergeNote = prOpened ? ` — opened a PR into \`${repoCtx.base}\` (the project's merge settings decide whether and when it merges)` : '';
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: 'pr_opened', category: 'tool',
      detail: { base: repoCtx.base, head: repoCtx.branch },
      result: prOpened ? `opened PR #${pr.ok ? pr.number : ''} — merge follows the project's settings` : `pr failed: ${pr.ok ? '' : pr.reason}`.slice(0, 300),
    });
    if (prOpened) await recordTypedExecutionClaim(db, { tenantId, executionId, kind: 'delivery', statement: `Opened pull request #${pr.ok ? pr.number : ''}; the project's merge settings decide the merge.` });
  } else if (repoCtx && opened && 'claimLost' in opened && writtenPaths.size > 0 && !cancelled) {
    // A RE-RUN on a ticket whose PR is already open: the claim is lost because the PR exists, and
    // this run pushed onto its branch. A grant on this run binds THAT PR (PRD 48 §4.6), pinned below
    // to the commit this run pushed — never voided as "no pull request".
    const existing = await findOpenPullRequestByTask(db, tenantId, taskRow.id, repoCtx.branch)
      .catch((error) => {
        reportCaughtError(error, { source: 'application/runtime/cloudFinalize.ts', operation: 'finalizeCloudRun.existingPr', context: { tenantId, executionId } });
        return null;
      });
    if (existing && existing.status !== 'closed') grantTarget = { prRowId: existing.id, headSha: null };
  } else if (!repoCtx && writtenPaths.size > 0 && !cancelled) {
    // The agent produced changes but there is no repo to open a PR against —
    // record why (no linked repo / unusable credential) so it's visible in the
    // Tools timeline + summary, not swallowed into an empty Pull Request tab.
    noPrReason = repoMiss || 'no repository linked to this project';
  }

  // ── MULTI-REPO SPANNING (0956) ─────────────────────────────────────────────
  // The primary repo's PR (above) is unchanged. A task bound to a repo SET may
  // also have committed to OTHER repos; each of those has its own branch and earns
  // its own PR — but only if it actually received writes. `openTaskRepoSetPullRequests`
  // reads the per-binding write counter, so a bound repo the agent never touched
  // opens nothing. Returns [] for every single-repo task (the overwhelming case).
  let spanningNote = '';
  if (writtenPaths.size > 0 && !cancelled) {
    const spanning = await openTaskRepoSetPullRequests(
      db, integrationCredentialSecret(env), tenantId, taskRow.id, repoCtx?.repoId ?? null,
      {
        title: `Task #${taskRow.id}: ${taskRow.title}`,
        body: `Changes for task #${taskRow.id}, by ${agentLabel} (this ticket spans multiple repositories).

${ciVerified
          ? '> ✅ **CI was green in-run** on the ticket-branch HEAD. Re-check CI on this PR before merge.'
          : '> ⚠ **Not verified in-agent.** CI on this PR is the source of truth.'}`,
      },
    ).catch((error) => {
      reportCaughtError(error, { source: 'application/runtime/cloudFinalize.ts', operation: 'finalizeCloudRun', context: { logMessage: '[cloud-finalize] spanning PR open failed', details: { tenantId, executionId, taskId: taskRow.id, error } } });
      return [];
    });
    if (spanning.length > 0) {
      spanningNote = ` Also opened ${spanning.filter((p) => p.url).length} PR(s) in ${spanning.map((p) => p.slug).join(', ')}.`;
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'pr_opened_spanning', category: 'tool',
        detail: { repos: spanning.map((p) => p.slug) },
        result: spanning.map((p) => (p.url ? `${p.slug} #${p.number}` : `${p.slug}: ${p.error}`)).join('; ').slice(0, 300),
      });
    }
  }

  // ── rollback bookkeeping ────────────────────────────────────────────────────
  // Two mutually exclusive outcomes for the run's repository artifacts:
  //
  //  (a) The run finished and left work behind → SNAPSHOT it, so a human can
  //      revert this run later. This includes a run that produced files but whose
  //      PR create FAILED: the commits are still real work on a real branch, and
  //      the honest response is to make them revertable, NOT to delete them.
  //  (b) The run was CANCELLED → its half-written branch is residue → hand it to
  //      the shared teardown decision, which deletes it only when its rules allow. Rule 7
  //      (authorship) is per RUN (`runCommitMarker(taskId, executionId)`): a branch that also
  //      carries an earlier run's or a live parent's commits reads as foreign and is kept.
  //
  // A run that lands FAILED does not reach (b) (a failed one that wrote files is snapshotted under
  // (a)): its branch residue is NOT swept automatically (ROADMAP Consolidated Gap Register).
  // Under (a) the snapshot's branch listing is also the run's per-run commit attribution (PRD 41
  // §D1, `runOutcomes/cloudAttribution`) — one provider listing serves both.
  // The paths above are best-effort and must never change the run's own outcome.
  if (repoCtx && writtenPaths.size > 0) {
    if (cancelled) {
      await teardownRunBranch(env, db, {
        tenantId, executionId, taskId: taskRow.id, repoCtx,
        writtenPaths: [...writtenPaths], cloudAgentRef, agentLabel,
      }).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudFinalize.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] run branch teardown failed', details: { tenantId, executionId, taskId: taskRow.id, error } } }));
    } else {
      const listing: { commits: BranchCommit[] | null } = { commits: null };
      await recordRunRollbackSnapshot(db, {
        tenantId, executionId, taskId: taskRow.id, repoCtx,
        writtenPaths: [...writtenPaths],
        prNumber: openedPrNumber, prUrl: openedPrUrl, prRowId: openedPrRowId,
        agentLabel,
        onListed: (commits) => { listing.commits = commits; },
      }).catch(() => null);
      if (listing.commits) {
        await recordCloudRunAttributions(db, { tenantId, executionId, taskId: taskRow.id, repoCtx, commits: listing.commits })
          .catch((error) => reportCaughtError(error, { source: 'application/runtime/cloudFinalize.ts', operation: 'finalizeCloudRun', context: { logMessage: '[cloud-finalize] run commit attribution failed', details: { tenantId, executionId, taskId: taskRow.id, error } } }));
      }
      // PRD 48 §4.6 — pin a person's merge grant to the LAST COMMIT THIS RUN PUSHED, proven from the
      // same listing: the PR's head must be one of this run's own commits, or the grant is voided.
      if (grantTarget) {
        grantBound = await bindGrantToThisRunsPr(env, db, {
          tenantId, executionId, taskId: taskRow.id, prRowId: grantTarget.prRowId,
          headSha: grantTarget.headSha, runCommits: listing.commits,
        });
      }
    }
  }

  // No PR opened despite changes — make the reason explicit in the timeline so a
  // human knows what to fix (link a repo / fix the credential / inspect the error).
  const noPrNote = noPrReason && !cancelled ? ` — no PR opened: ${noPrReason}` : '';
  if (noPrNote) {
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: 'pr_skipped', category: 'tool',
      detail: { writtenFiles: writtenPaths.size, reason: noPrReason },
      result: `No PR opened: ${noPrReason}`.slice(0, 300),
    });
  }

  const output =
    finalOutput ||
    (writtenPaths.size > 0
      ? `Committed ${writtenPaths.size} file(s)${repoCtx?.branch ? ` to \`${repoCtx.branch}\`` : ''}${prOpened ? ', opened a PR' : ''}${mergeNote}${noPrNote}.${spanningNote}`
      : cancelled ? RUN_CANCELLED_NOTICE : '(no output produced)');
  // THE RUN FAILED TO DELIVER: it wrote to a bound repo but its pull request did not open. The PR
  // IS the deliverable (the run never merges), so this is a failed run carrying the reason — not a
  // success with a footnote. A LOST claim records no reason (another path is opening the PR) and
  // is not a failure.
  const prFailed = !!repoCtx && writtenPaths.size > 0 && !cancelled && !prOpened && noPrReason !== '';
  const prFailedNote = prFailed && finalOutput ? `\n\n⚠ No pull request was opened: ${noPrReason}` : '';
  // A merge grant on a run that ends without its own PR (cancelled, nothing written, the open failed,
  // or another path holds the claim) can never apply: void it, so nothing else rides on it.
  if (!grantBound) {
    await voidMergeGrant(db, { tenantId, executionId, reason: cancelled ? 'cancelled' : 'no_pull_request' })
      .catch((error) => reportCaughtError(error, { source: 'application/runtime/cloudFinalize.ts', operation: 'finalizeCloudRun.voidMergeGrant', context: { tenantId, executionId } }));
  }
  // Mark the result unverified whenever a PR was opened: nothing was built or tested
  // in-agent, so the summary's claims are not authoritative — CI on the PR is.
  const unverifiedNote = prOpened && ciVerified
    ? '\n\n✅ In-run CI on the ticket-branch HEAD was green. Re-check CI on this PR before merge.'
    : prOpened
    ? '\n\n⚠ Not verified in-agent — this serverless executor ran no local build/type-check/tests. CI on the PR is the source of truth.'
    : '';

  // Unified learning: contribute this run's output to the project's Evermind. The
  // coordinator adapts+diffs+merges IN ITS ALARM, so this finalize (a CF Worker/DO
  // with a tight CPU budget) pays NO training cost — it just enqueues the text. The
  // same door IDE + on-prem post to; the coordinator gates seeded/frozen itself.
  // Best-effort, never affects the run outcome. [[evermind-learning-architecture]]
  if (repoCtx?.projectId && !cancelled && output.trim().length >= 20) {
    // Thread the task title as the teacher prompt so a pinned frontier teacher learns
    // (task → ideal answer), not just a refinement of this run's output. Weight the
    // contribution by run QUALITY (opened > wrote-files > no-op) instead of the old
    // text-length proxy. A run never merges (PRD 48): `scoreRunOutcome` grades the merge.
    const learnWeight = finalizeLearnWeight({
      prOpened, producedChanges: writtenPaths.size > 0,
    });
    // Fan out to EVERY live Evermind this project targets (its own head + the IDE builds
    // grouped under it), not just the one projectId — the same resolver the chat learn
    // gate uses, so a cloud run contributes to all the project's Everminds. Best-effort.
    await contributeTextToProjectEverminds(env, db, tenantId, repoCtx.projectId, output, learnWeight, taskRow.title)
      .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudFinalize.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] Evermind contribution failed', details: { tenantId, executionId, projectId: repoCtx.projectId, error } } }));
  }

  // Publish this run's outcome onto the PR itself so a reviewer on github.com
  // sees the verdict where the merge decision is actually made — previously the
  // agent's result existed only in the Builderforce UI. Rides the same terminal
  // chokepoint as everything else here, so BOTH cloud surfaces (durable DO and
  // container) get it from this one call site.
  //
  // Publishes a Check Run when the tenant has the GitHub App installed, and
  // degrades to a commit status on a user token (the Checks API is App-only).
  // Strictly best-effort: annotating a PR must never change the run's outcome.
  if (writtenPaths.size > 0 || prOpened) {
    await publishAgentRunVerdict(env, db, tenantId, taskRow.id, {
      executionId,
      outcome: cancelled ? 'cancelled' : prFailed ? 'failed' : 'completed',
      // Reuse the run summary verbatim, including the unverified caveat — the
      // whole point of the check is that a reviewer sees what the agent claims
      // AND that it was not verified in-agent.
      summary: output + unverifiedNote + prFailedNote,
      filesChanged: [...writtenPaths],
      appBaseUrl: resolveAppBaseUrl(env),
    }).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudFinalize.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] GitHub check publication failed', details: { tenantId, executionId, prNumber: openedPrNumber, error } } }));
  }

  // The check run above answers "green or red" in the merge box; it cannot carry
  // the narrative. Post the run summary onto the PR CONVERSATION too, so a
  // reviewer on github.com reads what the agent did — and the "not verified
  // in-agent" caveat — without leaving the review they're already in.
  //
  // Scoped to this executionId so a second agent pass on the same PR adds a
  // second summary, while a webhook redelivery or a retried finalize of THIS run
  // is deduped by the hidden marker. Strictly best-effort.
  if (prOpened && openedPrNumber != null && repoCtx?.repoId) {
    const files = [...writtenPaths];
    const fileBlock = files.length
      ? `\n\n**Files changed (${files.length})**\n${files.slice(0, 50).map((f) => `- \`${f}\``).join('\n')}${
          files.length > 50 ? `\n- …and ${files.length - 50} more` : ''
        }`
      : '';
    const runUrl = resolveAppBaseUrl(env) ? `\n\n[View the full run](${resolveAppBaseUrl(env)}/executions/${executionId})` : '';
    const comment = `### 🤖 ${agentLabel} — task #${taskRow.id}\n\n${output}${fileBlock}${unverifiedNote}${runUrl}`;
    const inspection = await inspectOutboundContent(db, { tenantId, executionId, seam: 'pull_request_comment', target: `${repoCtx.owner}/${repoCtx.repo}#${openedPrNumber}`, content: comment });
    if (inspection.ok) {
      await recordTypedExecutionClaim(db, { tenantId, executionId, kind: 'human_message', statement: output }).catch(() => ({ ok: false as const, error: 'claim failed' }));
      await postRepoPrComment(
        env, db, tenantId, repoCtx.repoId, openedPrNumber,
        comment,
        { kind: 'agent-run', scope: executionId },
      ).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudFinalize.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] PR summary comment failed', details: { tenantId, executionId, prNumber: openedPrNumber, error } } }));
    }
  }

  // STAMP WHAT THIS RUN LEFT BEHIND (0385) — the last thing finalize does, from the
  // SAME facts the learn weight above is graded on, so the two can never disagree.
  //
  // This is the signal the autonomy breaker was missing. It counted `failed` runs only,
  // so a run that COMPLETED and shipped nothing reset the streak and was re-dispatched
  // on the next five-minute tick, forever: 5,931 completed runs against 10 failures and
  // 3 finished tickets in one day on project 11, one agent at 5,796 runs / 0 finished,
  // while 371 tickets on the same board had never run at all because the tenant's
  // dispatch ceiling was spent on the re-runs.
  //
  // A CANCELLED run is deliberately left UNJUDGED (null): a person stopped it, which
  // says nothing about whether the ticket can succeed — the same reading the breaker
  // already takes of a cancellation, and of a platform eviction.
  if (!cancelled) {
    await db.update(executions)
      .set({ produced: runProducedOutput({ prOpened, producedChanges: writtenPaths.size > 0 }) })
      .where(eq(executions.id, executionId))
      .catch((error) => reportCaughtError(error, { source: 'application/runtime/cloudFinalize.ts', operation: 'finalizeCloudRun', context: { logMessage: '[cloud-finalize] produced-stamp failed — this run will not count toward the autonomy breaker', details: { tenantId, executionId, taskId: taskRow.id, error } } }));
  }

  // Did this run clear the reflection bar? Recorded either way, because "a run that
  // produced verified work proposed no skill" is a fact a reviewer should be able to
  // see — and (E1) a verified run whose model proposed nothing gets a DRAFT written for
  // it from its own trace. Never throws.
  await recordRunReflection(env, db, {
    tenantId, ...(cloudAgentRef ? { cloudAgentRef } : {}), executionId, taskRow, agentLabel,
    projectId: repoCtx?.projectId ?? null, prOpened, ciVerified, writtenPaths: [...writtenPaths],
  });

  // The run is terminal: its callback principal stops authenticating NOW, not at its
  // 24h expiry. Best-effort — the DB-state check on every callback already refuses a
  // terminal run; this is what makes the revocation visible in the principal row.
  await revokeRunPrincipal(db, tenantId, executionId)
    .catch((error) => reportCaughtError(error, { source: 'application/runtime/cloudFinalize.ts', operation: 'finalizeCloudRun', context: { logMessage: '[cloud-finalize] run principal revocation failed', details: { tenantId, executionId, error } } }));

  // The run opens its PR and ends: an unmerged PR is the designed outcome, never a failure — but
  // a PR that did not open after the run wrote code is (`prFailed`, reason in the output).
  return { ok: !prFailed, output: output + unverifiedNote + prFailedNote };
}

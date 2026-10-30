/**
 * cloudFinalize — landing a finished cloud run: the pull request, the optional
 * auto-merge, the run summary and the ticket stamps. Moved verbatim out of
 * `cloudAgentEngine.ts` (PRD 35 WS3): this is HOST work above the one agent (the board
 * and governance layer, §6.9), not run policy. Shared by the cloud adapter and the
 * Container executor's `container-op` endpoint.
 */
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { and, eq } from 'drizzle-orm';
import { recordRunReflection } from '../skills/skillReflection';
import { type TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { mergeBranchToBase, cloudAutoMergeRequiresGreen, cloudAutoMergeEnabled } from '../repos/mergeBranchToBase';
import { recordPullRequestRow, markPullRequestMergedById } from '../repos/recordPullRequestRow';
import { publishAgentRunVerdict } from '../checks/publishTaskVerdict';
import { postRepoPrComment } from '../repos/postPrComment';
import { openClaimedPullRequest, openTaskRepoSetPullRequests } from '../repos/openTaskPullRequest';
import { RUN_CANCELLED_NOTICE } from '@builderforce/agent-run';
import { contributeTextToProjectEverminds } from '../llm/projectEvermind';
import { finalizeLearnWeight, runProducedOutput } from './outcomeScore';
import { recordCloudToolEvent } from './cloudToolEvents';
import { recordRunRollbackSnapshot, teardownRunBranch } from './runRollback';
import { resolveAppBaseUrl } from '../../env';
import type { Env } from '../../env';
import { recordTypedExecutionClaim } from '../provenance/finishClaimService';
import { revokeRunPrincipal } from '../agentIdentity/agentRunIdentity';
import { inspectOutboundContent } from '../trust/trustService';
import { type Db } from '../../infrastructure/database/connection';
import { executions, tasks } from '../../infrastructure/database/schema';

/**
 * Land a finished cloud run: open a PR (recording it for the in-product approval
 * flow), optionally auto-merge, and emit the `pr_opened` / `merge_to_main` timeline
 * events. The single finalize implementation, shared by the in-worker tool loop
 * ({@link runCloudToolLoop}) and the long-lived Container executor (which runs the
 * loop in its own process and calls this via the internal container-op endpoint).
 * By default the run STOPS with the PR open — nothing merges to the deploy branch
 * until a human approves. When `CLOUD_AUTOMERGE_ENABLED` is on, shipping waits for
 * green CI by default (`CLOUD_AUTOMERGE_REQUIRE_GREEN`; opt out with 0/false/off).
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
  let merged = false;
  let mergeNote = '';
  // When files were produced but no PR ends up open, capture WHY so the run's
  // summary / timeline explains it instead of silently showing no Pull Request tab.
  let noPrReason = '';
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
  const opened = repoCtx && writtenPaths.size > 0 && !cancelled
    ? await openClaimedPullRequest(db, tenantId, taskRow.id, {
      provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner, repo: repoCtx.repo,
      token: repoCtx.token, head: repoCtx.branch, base: repoCtx.base,
      title: `Task #${taskRow.id}: ${taskRow.title}`,
      body: `Changes for task #${taskRow.id}, by ${agentLabel}. Files: ${[...writtenPaths].join(', ')}.\n\n${ciVerified
        ? '> ✅ **CI was green in-run** on the ticket-branch HEAD (combined commit status / check-runs). Re-check CI on this PR before merge — opening it or a later push can still go red.'
        : '> ⚠ **Not verified in-agent.** This serverless executor has no shell and ran no local build, type-check, lint, or tests. CI on this PR is the source of truth — do not merge on the agent\'s summary alone.'}`,
    }).catch(() => ({ ok: false as const, claimLost: true as const }))
    : null;
  if (repoCtx && opened && !('claimLost' in opened)) {
    const pr = opened;
    prOpened = pr.ok;
    if (!pr.ok) noPrReason = pr.reason;

    const autoMerge = cloudAutoMergeEnabled(env);

    // Record the PR row so the in-product Pull Request tab / approval flow can act
    // on it. Status reflects the policy: 'open' when awaiting human approval; when
    // auto-merge is enabled, it lands as 'merged' (or stays 'open' pending green CI).
    // Keep the row id so the immediate-merge branch can stamp its merge SHA (which
    // correlates the post-merge build back to this task).
    let prRowId: string | null = null;
    if (pr.ok) {
      openedPrNumber = pr.number;
      openedPrUrl = pr.url;
      const recordedStatus = autoMerge && !cloudAutoMergeRequiresGreen(env) ? 'merged' : 'open';
      const prRow = await recordPullRequestRow(db, {
        tenantId, segmentId: repoCtx.segmentId, projectId: repoCtx.projectId, repoId: repoCtx.repoId,
        taskId: taskRow.id, provider: repoCtx.provider, number: pr.number, url: pr.url,
        branchName: repoCtx.branch, baseBranch: repoCtx.base, status: recordedStatus,
      }).catch(() => null);
      prRowId = prRow?.id ?? null;
      openedPrRowId = prRowId;
    }

    await db.update(tasks)
      .set({ gitBranch: repoCtx.branch, ...(pr.ok ? { githubPrUrl: pr.url, githubPrNumber: pr.number } : {}), updatedAt: new Date() })
      .where(eq(tasks.id, taskRow.id))
      .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudFinalize.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] task PR metadata update failed', details: { tenantId, executionId, taskId: taskRow.id, error } } }));

    if (!autoMerge) {
      // Approval-gated default: open the PR and stop. A human merges in-product.
      mergeNote = prOpened ? ` — opened a PR for review (awaiting approval before merge to \`${repoCtx.base}\`)` : '';
      merged = false;
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'pr_opened', category: 'tool',
        detail: { base: repoCtx.base, head: repoCtx.branch },
        result: prOpened ? `opened PR #${pr.ok ? pr.number : ''} — awaiting human approval` : `pr failed: ${pr.ok ? '' : pr.reason}`.slice(0, 300),
      });
      if (prOpened) await recordTypedExecutionClaim(db, { tenantId, executionId, kind: 'delivery', statement: `Opened pull request #${pr.ok ? pr.number : ''} for human review.` });
    } else if (cloudAutoMergeRequiresGreen(env)) {
      // Auto-merge enabled, gated on green CI: a successful CI webhook merges later.
      mergeNote = ` — pending CI (will merge to \`${repoCtx.base}\` on green)`;
      merged = true; // not a merge failure; the gate intentionally defers it
    } else {
      // Auto-merge enabled, immediate: ship to the deploy branch now.
      const m = await mergeBranchToBase({
        provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner, repo: repoCtx.repo,
        token: repoCtx.token, base: repoCtx.base, head: repoCtx.branch,
        message: `Task #${taskRow.id}: ${taskRow.title} (BuilderForce auto-merge by ${agentLabel})`,
      });
      merged = m.ok;
      // Stamp the merge SHA so the post-merge deploy-branch build correlates back
      // to this task (build validation + auto-fix loop).
      if (m.ok && prRowId) {
        await markPullRequestMergedById(db, prRowId, tenantId, { mergeSha: m.sha ?? null })
          .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudFinalize.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] merged PR persistence failed', details: { tenantId, executionId, prRowId, error } } }));
      }
      mergeNote = m.ok
        ? ` and auto-merged to \`${repoCtx.base}\` (deploy triggered)`
        : ` — auto-merge to \`${repoCtx.base}\` failed: ${m.reason}`;
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'merge_to_main', category: 'tool',
        detail: { base: repoCtx.base, head: repoCtx.branch },
        result: m.ok ? `merged${m.merged ? '' : ' (already up to date)'}${m.sha ? ` · ${m.sha.slice(0, 7)}` : ''}` : `failed: ${m.reason}`.slice(0, 300),
      });
    }
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
  //      the shared teardown decision, which deletes it ONLY if it can prove the
  //      branch is nothing but this run's abandoned work.
  //
  // A run that lands FAILED does not reach (b): its branch residue is swept where a failed
  // landing is persisted (`failedRunSweep`, from `buildExecutionRepository`'s onTerminal,
  // through `teardownCrashedRunArtifacts` - the same teardown decision), and one that
  // reached (a) is left alone there. All are best-effort and must never change the run's
  // own outcome.
  if (repoCtx && writtenPaths.size > 0) {
    if (cancelled) {
      await teardownRunBranch(env, db, {
        tenantId, executionId, taskId: taskRow.id, repoCtx,
        writtenPaths: [...writtenPaths], cloudAgentRef, agentLabel,
      }).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudFinalize.ts", operation: "finalizeCloudRun", context: { logMessage: '[cloud-finalize] run branch teardown failed', details: { tenantId, executionId, taskId: taskRow.id, error } } }));
    } else {
      await recordRunRollbackSnapshot(db, {
        tenantId, executionId, taskId: taskRow.id, repoCtx,
        writtenPaths: [...writtenPaths],
        prNumber: openedPrNumber, prUrl: openedPrUrl, prRowId: openedPrRowId,
        agentLabel,
      }).catch(() => null);
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
  // Only a FAILED auto-merge breaks the "ship it" contract. Approval-gated runs end
  // with the PR open by design, so an unmerged PR there is success, not failure.
  const autoMergeFailed = prOpened && cloudAutoMergeEnabled(env) && !merged;
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
    // contribution by run QUALITY (merged > opened > wrote-files > no-op) instead of
    // the old text-length proxy, so a merged run teaches harder than a failed one.
    const learnWeight = finalizeLearnWeight({
      merged, prOpened, autoMergeFailed, producedChanges: writtenPaths.size > 0,
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
      outcome: cancelled ? 'cancelled' : autoMergeFailed ? 'failed' : 'completed',
      // Reuse the run summary verbatim, including the unverified caveat — the
      // whole point of the check is that a reviewer sees what the agent claims
      // AND that it was not verified in-agent.
      summary: output + unverifiedNote,
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
      .set({ produced: runProducedOutput({ merged, prOpened, producedChanges: writtenPaths.size > 0 }) })
      .where(eq(executions.id, executionId))
      .catch((error) => reportCaughtError(error, { source: 'application/runtime/cloudFinalize.ts', operation: 'finalizeCloudRun', context: { logMessage: '[cloud-finalize] produced-stamp failed — this run will not count toward the autonomy breaker', details: { tenantId, executionId, taskId: taskRow.id, error } } }));
  }

  // Did this run clear the reflection bar? Recorded either way, because "a run that
  // produced verified work proposed no skill" is a fact a reviewer should be able to
  // see — and (E1) a verified run whose model proposed nothing gets a DRAFT written for
  // it from its own trace. Never throws.
  await recordRunReflection(env, db, {
    tenantId, ...(cloudAgentRef ? { cloudAgentRef } : {}), executionId, taskRow, agentLabel,
    projectId: repoCtx?.projectId ?? null, merged, prOpened, ciVerified, writtenPaths: [...writtenPaths],
  });

  // The run is terminal: its callback principal stops authenticating NOW, not at its
  // 24h expiry. Best-effort — the DB-state check on every callback already refuses a
  // terminal run; this is what makes the revocation visible in the principal row.
  await revokeRunPrincipal(db, tenantId, executionId)
    .catch((error) => reportCaughtError(error, { source: 'application/runtime/cloudFinalize.ts', operation: 'finalizeCloudRun', context: { logMessage: '[cloud-finalize] run principal revocation failed', details: { tenantId, executionId, error } } }));

  return { ok: !autoMergeFailed, output: output + unverifiedNote };
}

/**
 * cloudProvider — the cloud run's capability BACKING: the repo over the git API, the
 * static validator, the approvals-queue human channel, durable memory, bounded web
 * reads and the PRD write-back. Moved verbatim out of `cloudAgentEngine.ts` (PRD 35 WS3):
 * it is the PROVIDER half of the cloud adapter, never policy. `cloudAdapter.ts` hands it
 * to the one agent through `cloudAgent/runProvider.ts`.
 */
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getLatestBlueprint } from '../blueprint/blueprintDetection';
import { buildMemoryCapability } from '../memory/memoryService';
import { buildSkillAuthoringCapability } from '../skills/tenantSkillService';
import { buildCoordinationCapability, guardRepoWrite } from '../coordination/coordinationCapability';
import { type LeaseHolder } from '../coordination/leaseService';
import { coordinationScopeKey } from '../../domain/coordination/resourceKey';
import { fetchCached } from './cloudWeb';
import { searchOwnedThenDiscover } from '../webSearch/demandSearch';
import { type TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { verifyWrittenFiles } from '../repos/verifyWrittenFiles';
import { pollBranchCi } from '../ci/pollCommitCiStatus';
import { durableRepoSemantic } from './cloudAgent/runSurfaceCaps';
import { buildCloudRepoCapabilities } from './cloudAgent/cloudRepoCapabilities';
import { type WrittenFileHashes } from './cloudAgent/writtenFileHashes';
import { withAnswerReplay } from './costLoop/answerReplay';
import { pauseExecutionForQuestion } from './executionPause';
import { type CapabilityProvider, type Capability } from '@builderforce/agent-tools';
import { recordCloudToolEvent } from './cloudToolEvents';
import type { Env } from '../../env';
import { authorizeCredentialDelegation } from '../agentIdentity/agentRunIdentity';
import { recordContextContribution } from '../trust/trustService';
import { type Db } from '../../infrastructure/database/connection';
import { buildPrdCapability } from './cloudAgent/prd';

/**
 * The durable/Worker surface's {@link CapabilityProvider}: the concrete backing for
 * the capability-gated tool registry on Cloudflare. It exposes the repo over the git
 * API (no disk), a shell-free static validator, human-in-the-loop via the approvals
 * queue, durable cross-run memory, and bounded public-web reads — and OWNS the side
 * effects of a write/delete (tracking the run's
 * written paths, recording a `task_file_changes` row, notifying subscribers) so each
 * tool stays a thin schema + result shaper. `repoCtx` and `writtenPaths` are the live
 * run state, so `readRef` (base before the first write, the ticket branch after) is
 * computed per call. The SAME tool definitions run on-prem against a disk/shell
 * provider — only this backing changes per surface (Dependency Inversion).
 */
export function buildCloudProvider(args: {
  env: Env;
  db: Db;
  tenantId: number;
  projectId: number;
  executionId: number;
  taskRow: { id: number; title: string };
  agentLabel: string;
  cloudAgentRef: string | undefined;
  repoCtx: TicketRepoContext | null;
  repoMiss: string;
  /** Live set of paths written this run (mutated by write/delete). */
  writtenPaths: Set<string>;
  writtenHashes?: WrittenFileHashes; // content hash of each written file as the run left it (mutated alongside `writtenPaths`)
  /** The run's capability set — `CLOUD_SURFACE_CAPS` plus whatever the TENANT
   *  unlocked (`durableRunCaps`: C5's `repo.semantic`). Must be the set the tool schemas
   *  were derived from. */
  capabilities: ReadonlySet<Capability>;
  /** Replay: pin repo reads to this ref rather than computing base→branch. */
  frozenReadRef?: string;
  principalId?: string;
  repositoryDelegationId?: string;
  /** The project's detected blueprint (services, databases, env vars). */
  blueprint: Awaited<ReturnType<typeof getLatestBlueprint>>;
}): CapabilityProvider {
  const { env, db, tenantId, projectId, executionId, taskRow, agentLabel, cloudAgentRef, repoCtx, repoMiss, writtenPaths, writtenHashes, blueprint } = args;
  // Read/list against the ticket branch only once it exists (created on the first
  // commit). Before any write, the branch ref 404s — read from `base` instead, so
  // the agent sees the real codebase rather than mistaking the missing branch for
  // "no repo access".
  // A replay pins reads to the ref the ORIGINAL run saw; a live run computes it (base
  // before the first write, the ticket branch after — the branch does not exist until
  // the first commit, and a 404 there reads to the agent as "no repo access").
  const readRef = (): string =>
    args.frozenReadRef ?? (repoCtx ? (writtenPaths.size > 0 ? repoCtx.branch : repoCtx.base) : '');
  const credentialAllowed = (scope: 'repository:read' | 'repository:write'): Promise<boolean> =>
    args.principalId && args.repositoryDelegationId
      ? authorizeCredentialDelegation(db, { tenantId, principalId: args.principalId, delegationId: args.repositoryDelegationId, requiredScope: scope })
      : Promise.resolve(false);

  // The repo tools (read memo, credential gate, secret inspection, multi-repo routing, bookkeeping)
  // over the shared coding provider live in `cloudAgent/cloudRepoCapabilities.ts`.
  const repo = buildCloudRepoCapabilities({ env, db, tenantId, executionId, taskRow, agentLabel, repoCtx, repoMiss, writtenPaths, writtenHashes, readRef, credentialAllowed });

  // WHO this run is, for coordination purposes. A ticket is one blackboard, so every
  // agent staffed onto the same ticket — in the same stage or a later one — shares a
  // scope and contends for the same leases.
  const leaseHolder: LeaseHolder = {
    tenantId,
    executionId,
    label: agentLabel,
    taskId: taskRow.id,
    repoSlug: repoCtx ? `${repoCtx.owner}/${repoCtx.repo}` : '',
    // The ticket BRANCH, not the base: contention exists only between agents committing
    // to the same ref, and every ticket has its own. Keying on the repo alone would
    // serialize unrelated tickets that happen to touch one file.
    branch: repoCtx?.branch ?? '',
    scopeKey: coordinationScopeKey(taskRow.id),
  };

  return {
    capabilities: args.capabilities, semantic: durableRepoSemantic(args.capabilities, { env, tenantId, projectId, repoCtx }),
    repoRead: repo.repoRead,
    // Every write goes through the coordination guard, which takes an implicit
    // exclusive lease on the path first. Correctness must not depend on the model
    // choosing to call `claim_resource`, so the surface claims on its behalf: a peer
    // agent in the same stage now gets a refusal naming the holder instead of silently
    // reverting the other agent's change on the shared ticket branch.
    repoWrite: guardRepoWrite(repo.repoWrite, {
      env,
      db,
      holder: leaseHolder,
      onRefused: (path, heldBy) => {
        // A refusal is a real coordination event, not a tool error — surface it on the
        // run timeline so an operator can see two agents contending for one file.
        void recordCloudToolEvent(db, {
          tenantId, cloudAgentRef, executionId,
          toolName: 'coordination.refused', category: 'tool',
          detail: { path, heldBy },
          result: `write to '${path}' refused — held by ${heldBy}`,
        }).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudProvider.ts", operation: "buildCloudProvider", context: { logMessage: '[cloud-run] coordination refusal telemetry failed', details: { tenantId, executionId, path, error } } }));
      },
    }),
    staticCheck: {
      async verify() {
        if (!repoCtx) return { ok: true, ran: false, note: `No repository is bound (${repoMiss}) — nothing to validate here; return the deliverable in your finish summary.` };
        if (writtenPaths.size === 0) return { ok: true, ran: false, note: 'No files written yet — write your changes first, then call run_checks to statically validate config files.' };
        const v = await verifyWrittenFiles({ ...repoCtx, ref: readRef() }, writtenPaths);
        if (!v.ok) {
          return {
            ok: false, ran: true, kind: 'static-validation',
            errors: v.errors,
            note: `Static validation FAILED on ${v.errors.length} file(s) — fix the parse error(s) below with write_file, then call run_checks again.`,
          };
        }
        // Ticket #3092: this executor has no shell, so branch CI is the in-run
        // build/type-check/test. Poll HEAD; a red result fails the tool so the
        // agent fixes before finishing. `none` (no checks yet / PR-only workflow)
        // is not a failure — finish will still refuse a fabricated "tests passed".
        const ci = await pollBranchCi(repoCtx);
        const short = ci.sha ? ci.sha.slice(0, 7) : 'HEAD';
        const staticNote = `Static source/config validation PASSED for ${v.checked.length} changed file(s)`
          + `${v.skipped.length ? ` (${v.skipped.length} file(s) had no applicable shell-free policy)` : ''}.`;
        if (ci.status === 'failure') {
          return {
            ok: false, ran: true, kind: 'branch-ci',
            checked: v.checked, skipped: v.skipped,
            errors: (ci.failed.length ? ci.failed : ['ci']).map((name) => ({ path: `(ci) ${name}`, message: ci.summary })),
            note: `${staticNote} CI FAILED on ${short} (${ci.count} check(s)): ${ci.summary}. Fix, then call run_checks again. Do not claim tests passed.`,
          };
        }
        const ciNote = ci.status === 'success'
          ? ` CI on ${short} is GREEN (${ci.count} check(s)). You may claim those checks passed.`
          : ci.status === 'pending'
            ? ` CI is PENDING on ${short} (${ci.count} check(s)). Do not finish yet; call run_checks again. Do not claim tests passed.`
            : ' No CI checks on this commit yet (none configured, or they only run after the PR opens). Do not claim a local build/type-check/test passed.';
        return {
          ok: true, ran: true, kind: 'static-validation',
          checked: v.checked, skipped: v.skipped,
          note: staticNote + ciNote,
        };
      },
    },
    // Human-in-the-loop. The durable surface keeps its conversation in the DO
    // cursor, so it hands NO loop state to the pause record — but it goes through
    // the SAME primitive the container/Actions surfaces do, so the approval, the
    // needs-attention routing and the resume record are identical everywhere.
    human: {
      async ask(question, context) {
        const { approvalId } = await pauseExecutionForQuestion(env, db, {
          tenantId, executionId, taskId: taskRow.id, projectId,
          ...(cloudAgentRef ? { cloudAgentRef } : {}),
          agentLabel, question, ...(context ? { context } : {}),
          surface: 'durable',
        });
        return { paused: true, approvalId, note: 'Question sent to a human. The run is paused until it is answered; you will resume with the answer.' };
      },
    },
    // The ticket's PRD, WRITABLE. Prep hands the run its PRD as context; this is what
    // lets the run write back to it — a decision it made, or a section it found wrong —
    // through the same `specs` writer + branch-commit path the first draft used. WHICH
    // ticket's PRD is fixed by the run, never by the model.
    prd: buildPrdCapability(env, db, { executionId, tenantId, projectId, taskId: taskRow.id, taskTitle: taskRow.title, agentLabel }),
    // Durable cross-run memory, GOVERNED (0371): the run's scope chain decides both
    // what it may recall (ticket → project → tenant, never a sibling project) and where
    // a write lands, and every fact carries its origin run + optional TTL. The backing
    // table is a routing detail of the scope, not a decision made here. B4: a recall the
    // project's answered-question memory already holds is replayed (`answerReplay.ts`).
    memory: withAnswerReplay(buildMemoryCapability({ db, env, tenantId, projectId, ticketId: taskRow.id, origin: 'cloud-run', executionId }), { env, db, tenantId, projectId, agentRef: cloudAgentRef ?? null }),
    // Multi-agent coordination for this ticket: leases + the shared blackboard.
    coordination: buildCoordinationCapability({ env, db, holder: leaseHolder }),
    // Skill authoring: a run that worked out a repeatable procedure can PROPOSE it
    // for review. Drafts only — approval is a human write, so a run can never change
    // what other agents are instructed to do. The workspace/project/run are stamped
    // here, exactly as `memory` resolves its own scope.
    skillAuthor: buildSkillAuthoringCapability({ env, db, tenantId, projectId, executionId, taskId: taskRow.id, agentLabel }),
    // Read a public URL (docs / an API spec / a linked issue) so the agent isn't
    // limited to what the repo already contains — and discover that URL in the first
    // place. `search` checks the tenant's OWNED crawled index first and only falls back
    // to a vendor (tenant BYO key → the operator's own key → SearXNG → keyless
    // encyclopedic floor) to discover pages worth crawling, via the SAME
    // `searchOwnedThenDiscover` primitive the Brain's `web.search` MCP tool and the
    // workflow `web-search` node use — so an autonomous run's research builds the
    // tenant's index instead of being thrown away when the tool call returns. SSRF
    // egress policy + byte cap + timeout + the read-through cache + per-query metering
    // all live in cloudWeb.
    web: {
      async fetch(url: string) {
        const result = await fetchCached(env, url);
        if (result.ok) await recordContextContribution(db, { tenantId, executionId, sourceKind: 'web_fetch', sourceRef: result.url ?? url, trustTier: 'external', content: result.content ?? '' });
        return result;
      },
      async search(query: string) {
        const result = await searchOwnedThenDiscover({ db, env, tenantId, request: { query } });
        if (result.ok) await recordContextContribution(db, { tenantId, executionId, sourceKind: 'web_search', sourceRef: query, trustTier: 'external', content: JSON.stringify(result) });
        return result;
      },
    },
  };
}

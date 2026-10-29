/**
 * cloudPrepare — the prep both cloud surfaces share before a run's first turn (the PRD,
 * governance, assigned capabilities, the system + user prompts) and the RUNNING
 * transition. Moved verbatim out of `cloudAgentEngine.ts` (PRD 35 WS3): this builds the
 * task the one agent is handed, it is not run policy.
 */
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { loadAgentPsychometric } from './cloudAgent/agent';
import { and } from 'drizzle-orm';
import { approvedSkillsForRun } from '../skills/tenantSkillService';
import { rankSkillsForTask, renderSkillCatalogBlock, workspaceSkillSummaries } from '../skills/skillLibrary';
import { skillReflectionDirective } from '../skills/skillReflection';
import { isValidatorReviewPayload } from '../validation/validatorReviewMarker';
import { isIncidentTriagePayload, incidentIdFromPayload } from '../incident/incidentTriageMarker';
import { prepSurfaceCaps } from './cloudAgent/runSurfaceCaps';
import { workModeToolingPrompt } from './costLoop/workModePrompt';
import { isCostLeverOn } from '@builderforce/cost-levers';
import { loadCapabilityContext } from '../artifact/capabilityContext';
import { recordPersonalityEvent, compilePersonalityApplication } from '../persona/recordPersonalityEvent';
import { notifyExecutionSubscribers } from './executionEvents';
import { type AgentExecParams } from '@builderforce/agent-tools';
import { renderRunContext, summarizeBlocks, type RunContextBlock } from '@builderforce/run-context';
import { RUN_CONTEXT_ORDER } from './runContextSource';
import { buildRunContext } from './runContextService';
import { parseRemediation, parseFollowUp, parseRoleInstruction } from './cloudDispatch';
import { recordCloudToolEvent } from './cloudToolEvents';
import { RuntimeService } from './RuntimeService';
import { ExecutionStatus } from '../../domain/shared/types';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import type { Env } from '../../env';
import { ensureAgentRunIdentity } from '../agentIdentity/agentRunIdentity';
import { trustNotice } from '../../domain/trust/contentTrust';
import { recordContextContribution } from '../trust/trustService';
import { type Db } from '../../infrastructure/database/connection';
import { boards, tasks } from '../../infrastructure/database/schema';
import { ensureTaskPrd, loadWorkspaceContext } from './cloudAgent/prd';

/**
 * Prep shared by both cloud surfaces (the durable `CloudRunnerDO` and the Cloudflare
 * Container): ensure a task PRD, load governance + assigned capabilities (all
 * parallel reads), record the `context.prepare` + `capabilities.load` timeline
 * events, and build the system + user prompts the tool loop runs against. Returns
 * the two prompts. Never throws on the telemetry writes (best-effort).
 */
export async function prepareCloudRun(
  env: Env,
  db: Db,
  executionId: number,
  taskRow: { id: number; title: string; description: string | null },
  tenantId: number,
  projectId: number,
  agentLabel: string,
  model: string | undefined,
  artifacts: ResolvedArtifacts | undefined,
  cloudAgentRef?: string,
  payload?: string,
  opts?: {
    shell?: boolean;
    /**
     * REHEARSAL: prep must not change anything.
     *
     * The shadow provider (application/rehearsal/shadowProvider.ts) intercepts the
     * LOOP, but prep runs BEFORE the loop and is not read-only by default: it drafts
     * and commits a PRD to the real ticket branch, and records a personality-
     * application event attributed to the agent. Both escape a rehearsal — the first
     * as a real commit, the second as skew in personality telemetry. This flag makes
     * prep observe-only; everything it READS is unchanged, so the prompts a rehearsal
     * runs on are the prompts the live run would get (minus a PRD it would have
     * created, which the report notes).
     */
    readOnly?: boolean;
    /** Rehearsal/replay may pin the exact immutable definition observed by the source
     * run. Live runs omit this and freeze the current row at the run boundary. */
    agentDefinitionSnapshot?: Record<string, unknown>;
  },
): Promise<{ systemPrompt: string; userContent: string; execParams: AgentExecParams; agentPsychometric: string | null }> {
  const tPrep0 = Date.now();
  // The capability set this run's surface advertises. Resolved ONCE: the identity it
  // issues and the prompt it builds have to agree about which tools exist, and a
  // second `opts?.shell ? … : …` further down is how they stop agreeing.
  const surfaceCaps = prepSurfaceCaps(env, tenantId, opts?.shell === true);
  const prepIdentity = await ensureAgentRunIdentity(db, {
    tenantId, executionId, agentRef: cloudAgentRef, issuedBy: `execution:${executionId}`,
    capabilities: [...surfaceCaps],
  });
  // The agent's OWN personality (independent of assigned personas) — folded into the
  // capability prompt block, the exec params, and (by the caller) the limbic setpoints.
  const frozenPsychometric = opts?.agentDefinitionSnapshot?.psychometric ?? prepIdentity.definition?.psychometric;
  const agentPsychometric = typeof frozenPsychometric === 'string'
    ? frozenPsychometric
    : await loadAgentPsychometric(env, tenantId, cloudAgentRef);
  // The PRD is the slow leg — on a first pass it is a paid LLM draft plus a real branch
  // commit — so it is started here and handed to the shared assembler as a PROMISE,
  // keeping it overlapped with every other read exactly as the old inline `Promise.all`
  // did. Only the CLOUD path may create a PRD; every other surface reads the stored one.
  const prdPromise = ensureTaskPrd(env, db, executionId, taskRow, tenantId, projectId, taskRow.id, agentLabel, model, opts?.readOnly === true);
  const [capabilities, workspace, workspaceSkills] = await Promise.all([
    loadCapabilityContext(env, db, tenantId, artifacts, agentPsychometric),
    // The repo the agent runs against — its identity + top-level shape (so a wrong/
    // empty binding is visible before any LLM spend) AND what a prior pass already
    // committed to this branch (so a re-run reconciles instead of blindly appending).
    // Best-effort: a clean first run / no repo yields an empty workspace.
    loadWorkspaceContext(env, db, integrationCredentialSecret(env), tenantId, taskRow.id),
    // Procedures THIS workspace approved — including ones an earlier run proposed
    // after producing graded proof. Cached read; only `approved` rows are returned,
    // so a draft never reaches a prompt.
    approvedSkillsForRun(env, db, tenantId, projectId ?? null),
  ]);
  const prd = await prdPromise;
  const priorChanges = workspace.priorChanges;
  const repoLabel = workspace.repo ? `${workspace.repo.owner}/${workspace.repo.repo}` : null;
  await Promise.all([
    recordContextContribution(db, { tenantId, executionId, sourceKind: 'ticket', sourceRef: String(taskRow.id), trustTier: 'tenant', content: `${taskRow.title}\n${taskRow.description ?? ''}` }),
    ...(prd ? [recordContextContribution(db, { tenantId, executionId, sourceKind: 'prd', sourceRef: String(taskRow.id), trustTier: 'tenant', content: prd })] : []),
    ...(repoLabel ? [recordContextContribution(db, { tenantId, executionId, sourceKind: 'repository', sourceRef: repoLabel, trustTier: 'repository', content: `${workspace.topLevel.join('\n')}\n${priorChanges.map((c) => c.path).join('\n')}` })] : []),
  ]);
  // Record capability loading as its own timeline event so the Observability
  // timeline shows exactly which Skills/Personas/Content the cloud agent loaded.
  const cap = capabilities.summary;
  if (cap.skills.length || cap.personas.length || cap.content.length) {
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: 'capabilities.load', category: 'context',
      detail: cap,
      // Say which of them this agent actually CARRIES. "3 skills loaded" was true of a
      // run whose agent was assigned none of them — every one inherited from the tenant.
      result: `${cap.personas.length} persona(s), ${cap.skills.length} skill(s), ${cap.content.length} content`
        + ` · ${cap.agentPinned.length} agent-pinned, ${(cap.skills.length + cap.personas.length + cap.content.length) - cap.agentPinned.length} inherited`
        + (cap.missing.length ? ` · ${cap.missing.length} unresolved: ${cap.missing.join(', ')}` : ''),
    });
  }

  // Record a FIRST-CLASS personality-application event (Residual 1) the moment this run
  // actually applies a personality — an in-process db write, NOT an HTTP self-call. Runs
  // exactly ONCE per run (prepareCloudRun is the single prep site every cloud surface —
  // Worker / durable DO / container — funnels through). Reuses the profile + merged exec
  // levers already resolved above (one compile, no per-turn N+1). `compilePersonalityApplication`
  // returns null when the agent's own psychometric yields no directives, so a V2 /
  // neutral-profile run records nothing and stays byte-identical. The GET now derives
  // only to backfill gaps. Best-effort — telemetry must never block a run.
  // Skipped for a rehearsal: this attributes a personality APPLICATION to the agent,
  // and a probe must not move the numbers that describe how the real agent behaves.
  if (cloudAgentRef && !opts?.readOnly) {
    const application = compilePersonalityApplication({
      agentPsychometric,
      execParams: capabilities.execParams,
      personaIds: capabilities.summary.personas,
    });
    if (application) {
      await recordPersonalityEvent(env, db, tenantId, { agentRef: cloudAgentRef, executionId, ...application })
        .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudPrepare.ts", operation: "prepareCloudRun", context: { logMessage: '[cloud-run] personality telemetry failed', details: { tenantId, executionId, cloudAgentRef, error } } }));
    }
  }

  // Auto-fix runs carry a remediation block (the post-merge build failure) in the
  // payload — surface it prominently so the agent fixes the REAL failing build.
  const remediation = parseRemediation(payload);

  // A "Send" on a TERMINAL run starts a NEW run carrying the user's message as a
  // follow-up directive. Surface it as the HEADLINE instruction so the run treats
  // the message as the goal — building on the prior run's committed work and the
  // (now PRD-recorded) directive, not redoing the task from scratch.
  const followUp = parseFollowUp(payload);

  // Validator acceptance-review run: the payload marks this run as a REVIEW, not
  // implementation work. Steer it explicitly (independent of the agent's persona) so
  // ANY agent dispatched with the review flag performs an acceptance review and reports
  // via reviews.record, rather than editing code.
  const isReviewRun = isValidatorReviewPayload(payload);

  // Incident-triage run: the payload marks this as the Incident Manager working an
  // open incident, NOT shipping code. Steer it (independent of persona) to analyse the
  // ticket, classify the affected system, page/escalate on-call, and post war-room
  // updates via the incidents.*/oncall.* tools.
  const isIncidentRun = isIncidentTriagePayload(payload);
  const incidentRunId = incidentIdFromPayload(payload);

  // The role-participation ask: "you are the <role> accountable for this ticket —
  // record your verdict with builtin_kanban_signoff". Written by
  // buildSignoffRequestPayload / buildProducerRequestPayload and, until this line,
  // read by nothing — so a reviewer was dispatched to judge work and never asked to
  // record the judgement. See parseRoleInstruction for the measured impact.
  const roleInstruction = parseRoleInstruction(payload);

  // Show the agent the repo it's about to edit BEFORE it spends an LLM call, so a
  // wrong/empty binding is caught up-front instead of after a conceptual non-answer
  // (the exec #54 failure: the agent never saw that only `agent-runtime` was bound).
  const workspaceBlock = workspace.repo
    ? `## Repository / workspace\n\n`
      + `Your changes run against **${repoLabel}** (base \`${workspace.repo.base}\`), which currently contains ${workspace.fileCount}${workspace.truncated ? '+' : ''} file(s). Top-level entries:\n\n`
      + (workspace.topLevel.length ? workspace.topLevel.map((p) => `- \`${p}\``).join('\n') : '_(empty repository)_')
      + `\n\nIf these files are clearly UNRELATED to what the task asks for (e.g. the task is about a website but this repo holds none of its code), do NOT invent a conceptual answer or edit unrelated files — say so plainly in your summary, name the bound repository (${repoLabel}), and state that the correct repo must be bound. Explore with list_files / search_code before concluding.`
    : `## Repository / workspace\n\n`
      + `⚠ No repository is bound to this task${workspace.reason ? ` (${workspace.reason})` : ''}, so there are no files to edit. Return the complete deliverable in your final summary and state that a repository must be bound before code can ship.`;

  const priorChangesBlock = priorChanges.length
    ? `## Files already on this branch from prior passes\n\n`
      + `A previous run already committed these files to this task's branch. They are part of the OPEN pull request. `
      + `Reconcile against this list: update what's still needed, and **delete any that are dead code** — stubs, placeholders, unreferenced files, or anything that should not ship in this PR — with the delete_file tool. Do not leave orphaned files just because a prior pass created them.\n\n`
      + priorChanges.map((c) => `- \`${c.path}\` (${c.status})`).join('\n')
    : null;

  // ── The run's context, as BLOCKS ────────────────────────────────────────────
  //
  // Everything below is a `RunContextBlock` from `@builderforce/run-context`, not a
  // string spliced into a local array. The blocks the api can assemble for ANY surface
  // (strategy, PRD, governance, the ticket, project memory, Evermind lessons) come from
  // `buildRunContext`; the ones only THIS executor knows — the headline directive, the
  // bound repository, what a prior pass left on the branch, the capability prompt and the
  // executor-specific tool guidance — are handed to it as `extraBlocks` so they travel
  // the same reconciliation path. `renderRunContext` then produces the two prompts, in
  // the same order and with the same separators this function used to build inline.
  const surfaceBlocks: RunContextBlock[] = [
    // FIRST, deliberately: this is the accountability ask the run exists to answer.
    // A role run that produces the deliverable but records nothing leaves its slot
    // in `in_progress` forever — the state whose only exit is this tool call.
    {
      kind: 'directive', subject: `role:${executionId}`, channel: 'user', order: RUN_CONTEXT_ORDER.role,
      trustTier: 'tenant', pinned: true,
      body: roleInstruction ? `## Your role on this ticket — RECORD YOUR VERDICT\n\n${roleInstruction}` : '',
    },
    {
      kind: 'directive', subject: `review:${executionId}`, channel: 'user', order: RUN_CONTEXT_ORDER.review,
      trustTier: 'tenant', pinned: true,
      body: isReviewRun
        ? `## Acceptance review (do NOT edit code)\n\nThis is a VALIDATOR REVIEW of already-Done work — verify the ticket was genuinely completed against its PRD/requirements and the repository. Read the branch/PR and the relevant code with search_code / read_file, judge whether the deliverable is complete and correct, then call the \`builtin_reviews_record\` tool with your verdict ('complete' or 'gaps'), a short assessment, and any concrete gaps (each becomes a GAP ticket).\n\n**Anchor every gap you can to the code.** When a gap is about a specific line you read, pass \`path\` (repo-relative, exactly as it appears in the change) and \`line\` on that gap — it is then posted as an inline comment on the pull request, on that line, where a human reviewer will actually see it. Only anchor to files this change actually touched. Leave \`path\`/\`line\` unset for gaps about work that is MISSING (no tests, an unimplemented requirement) — those have nowhere to point and go in the review summary, which is equally visible. Do NOT invent a location to satisfy the field.\n\nDo NOT write_file / delete_file or change the ticket's status — you are reviewing, not implementing.`
        : '',
    },
    {
      kind: 'directive', subject: `incident:${executionId}`, channel: 'user', order: RUN_CONTEXT_ORDER.incident,
      trustTier: 'tenant', pinned: true,
      body: isIncidentRun
        ? `## Incident triage (do NOT edit code)\n\nYou are the INCIDENT MANAGER working an OPEN incident${incidentRunId ? ` (incident \`${incidentRunId}\`)` : ''} — help-desk triage and response, NOT a code change. Steps:\n1. Read the incident with \`builtin_incidents_get\`; read the source ticket in the task description.\n2. **Search the knowledge base FIRST** with \`builtin_knowledge_search\` for prior similar incidents, RCAs, or known-errors — if this has happened before, reuse the documented workaround/resolution instead of starting from scratch.\n3. Work out WHICH SYSTEM the issue pertains to and record it with \`builtin_incidents_classify\`.\n4. Set an accurate severity with \`builtin_incidents_update\` (sev1 = full outage / broad impact … sev4 = minor).\n5. Page whoever is on call with \`builtin_oncall_page\` (check \`builtin_oncall_list\` first). Escalation to later tiers happens automatically on a timer until someone acknowledges.\n6. Post what you find and do to the war-room feed with \`builtin_incidents_add_note\`.\n7. When the incident is resolved, set its status to resolved with \`builtin_incidents_update\`, then **publish a post-mortem** with \`builtin_incidents_postmortem\` (root cause, contributing factors, resolution, what went well/wrong, and concrete action items) — it becomes a searchable Knowledge RCA, files the action items as remediation tasks, and teaches the workforce not to repeat the cause.\nDo NOT write_file / delete_file — you are triaging, not implementing.`
        : '',
    },
    {
      kind: 'directive', subject: `remediation:${executionId}`, channel: 'user', order: RUN_CONTEXT_ORDER.remediation,
      trustTier: 'tenant', pinned: true,
      body: remediation
        ? `## Build failure to fix (attempt ${remediation.attempt}/${remediation.maxAttempts})\n\n${
            remediation.phase === 'pre_merge'
              ? 'The CI build on this task’s pull-request branch FAILED — it must be green before the PR can merge. Fix the cause below — do not re-do unrelated work.'
              : 'A previous change for this task was merged but the build then FAILED. Fix the cause below — do not re-do unrelated work.'
          }\n\n${remediation.buildError}${remediation.runUrl ? `\n\nCI run: ${remediation.runUrl}` : ''}`
        : '',
    },
    {
      kind: 'directive', subject: `follow-up:${executionId}`, channel: 'user', order: RUN_CONTEXT_ORDER.followUp,
      trustTier: 'tenant', pinned: true,
      body: followUp
        ? `## Follow-up directive (act on this first)\n\nThe user reviewed the previous run${followUp.priorExecutionId != null ? ` (execution #${followUp.priorExecutionId})` : ''} and sent this new direction. Treat it as the primary goal for THIS run, building on the work already committed to the task's branch (see the prior-files list below) rather than starting over:\n\n${followUp.directive}`
        : '',
    },
    {
      kind: 'workspace', subject: `workspace:${taskRow.id}`, channel: 'user', order: RUN_CONTEXT_ORDER.workspace,
      trustTier: 'repository', sourceRef: repoLabel ?? 'unbound workspace',
      body: `${trustNotice('repository', repoLabel ?? 'unbound workspace')}\n\n${workspaceBlock}`,
    },
    {
      kind: 'prior_changes', subject: `prior-changes:${taskRow.id}`, channel: 'user', order: RUN_CONTEXT_ORDER.priorChanges,
      trustTier: 'repository', ...(repoLabel ? { sourceRef: repoLabel } : {}),
      body: priorChangesBlock ?? '',
    },
    // ── system channel ──────────────────────────────────────────────────────
    {
      kind: 'tooling', subject: `executor:${opts?.shell ? 'sandbox' : 'durable'}`, channel: 'system',
      order: RUN_CONTEXT_ORDER.coreTooling, trustTier: 'operator', pinned: true,
      // The executor's tooling prompt (shell vs CI verification) with the D5 diff-edit
      // and D8 parallel-read wording when their levers are on.
      body: workModeToolingPrompt({
        shell: opts?.shell, diffEdits: isCostLeverOn(env, 'd5_output_caps', tenantId), parallelReads: isCostLeverOn(env, 'd8_parallel_tool_calls', tenantId),
      }),
    },
    {
      // Platform (project-management) tools — advertised alongside the repo tools on
      // every cloud surface (durable + container). This is what lets a run manage the
      // project as it works instead of silently dropping out-of-scope findings.
      kind: 'tooling', subject: 'platform-tools', channel: 'system',
      order: RUN_CONTEXT_ORDER.platformTooling, trustTier: 'operator', pinned: true,
      body: 'You ALSO have PLATFORM tools (prefixed `builtin_`) to manage the project as you work — they act on the SAME project boards the humans use, not the repo. '
        + 'Use `builtin_tasks_list` / `builtin_tasks_get` to see what is already tracked; '
        + '`builtin_tasks_create` to file a NEW task for any gap, bug, or follow-up work you find that is OUT OF SCOPE for THIS task — do NOT silently drop it, capture it as a task so it is not lost; '
        + '`builtin_tasks_update` to reflect progress; and `builtin_objectives_update` / `builtin_key_results_update` to update the OKR/objective progress your work advances. '
        + "They default to THIS run's project; pass an explicit projectId only to target another. "
        + 'When you finish, base any "what remains" statement on real state — the tasks you actually created plus `builtin_tasks_list` — never a guess.',
    },
    {
      kind: 'capabilities', subject: `capabilities:${executionId}`, channel: 'system',
      order: RUN_CONTEXT_ORDER.capabilities, trustTier: 'tenant', pinned: true,
      body: capabilities.promptBlock || '',
    },
    {
      // Reflection: a run that reaches a verified result may distil what it did into
      // a skill DRAFT for review. Prompt-side because only the agent knows which of
      // the things it did were the repeatable ones, and it knows that at the end.
      kind: 'directive', subject: `reflection:${executionId}`, channel: 'user',
      order: RUN_CONTEXT_ORDER.followUp, trustTier: 'operator', pinned: true,
      body: skillReflectionDirective(repoLabel != null && surfaceCaps.has('skill.author')),
    },
    {
      // The workspace's OWN approved skills — procedures earlier runs worked out and
      // a human signed off. Same trust tier as assigned capabilities: a person
      // approved them, and an unapproved draft can never appear here.
      //
      // An Agent Skills CATALOG (name + description each), not the bodies: the run
      // loads a skill's instructions — and any file bundled with it — through the
      // platform `skills.read` tool when its task matches, which is the spec's
      // progressive disclosure and costs one line per skill instead of the whole text.
      kind: 'capabilities', subject: `workspace-skills:${executionId}`, channel: 'system',
      order: RUN_CONTEXT_ORDER.capabilities, trustTier: 'tenant', pinned: true,
      // E1: only the approved skills relevant to this task (top 5), not all 50.
      body: renderSkillCatalogBlock(workspaceSkillSummaries(isCostLeverOn(env, 'e1_skill_ranking', tenantId) ? rankSkillsForTask(workspaceSkills, `${taskRow.title} ${taskRow.description ?? ''}`) : workspaceSkills)),
    },
  ];

  // Strategy / PRD / governance / ticket / project memory / Evermind lessons — the
  // blocks EVERY surface now gets, from the ONE assembler. Reconciled through Evermind
  // cognition against `task:<id>`, so a PRD or a rule that CHANGED since a prior pass on
  // this ticket arrives marked as a change rather than as a second competing statement.
  // `elideUnchanged` stays off: this prompt is built fresh per run, so an elided block is
  // one the model can no longer see.
  const runContext = await buildRunContext(env, db, {
    tenantId,
    projectId,
    taskId: taskRow.id,
    scope: `task:${taskRow.id}`,
    query: `${taskRow.title} ${taskRow.description ?? ''}`.trim(),
    ...(cloudAgentRef ? { agentRef: cloudAgentRef } : {}),
    task: taskRow,
    prd,
    extraBlocks: surfaceBlocks,
    elideUnchanged: false,
  });
  const { systemPrompt, userContent } = renderRunContext(runContext.envelope);

  // Recorded HERE rather than before the assembly so the Observability timeline names the
  // blocks this run actually received — the question "was the agent even told the rules?"
  // used to be unanswerable from the timeline, which is how a whole surface went years
  // without strategic context and nothing showed it.
  await recordCloudToolEvent(db, {
    tenantId, cloudAgentRef, executionId,
    toolName: 'context.prepare', category: 'planning',
    detail: {
      blocks: runContext.full.blocks.map((b) => b.kind),
      unchanged: runContext.unchanged,
      repo: repoLabel,
      fileCount: workspace.fileCount,
      priorFiles: priorChanges.length,
    },
    result: `${summarizeBlocks(runContext.envelope.blocks)}`
      + ` · ${repoLabel ? `workspace ${repoLabel} (${workspace.fileCount}${workspace.truncated ? '+' : ''} file(s))` : `no repo bound${workspace.reason ? ` (${workspace.reason})` : ''}`}`
      + ` · ${priorChanges.length ? `${priorChanges.length} prior file(s) on branch` : 'clean branch'}`,
    durationMs: Date.now() - tPrep0,
  });

  return { systemPrompt, userContent, execParams: capabilities.execParams, agentPsychometric };
}

/**
 * The single PENDING/SUBMITTED → RUNNING transition for BOTH cloud surfaces (the
 * durable `CloudRunnerDO` and the Cloudflare Container kickoff). Routes through
 * {@link RuntimeService.update} — the one routine that also moves the ticket to In
 * Progress, records metrics, and writes the audit event — then announces the new
 * status to live subscribers. Best-effort: a row that already raced to a
 * terminal/cancelled state makes `markRunning` throw, which we swallow rather than
 * clobber. Funnelling both executors through here is what stops them drifting (the
 * container surface used to skip RUNNING entirely, so its card sat on "pending" for
 * the whole live run).
 */
export async function markCloudExecutionRunning(runtimeService: RuntimeService, executionId: number): Promise<void> {
  let running: Awaited<ReturnType<RuntimeService['update']>>;
  try {
    running = await runtimeService.update(executionId, { status: ExecutionStatus.RUNNING });
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cloudPrepare.ts", operation: "markCloudExecutionRunning", level: 'warning', context: { logMessage: '[cloud-run] running transition rejected', details: { executionId, error } } });
    return; // already non-pending (cancelled/terminal) — leave it
  }
  notifyExecutionSubscribers(executionId, {
    type: 'status_change',
    executionId,
    status: running.status,
    execution: running.toPlain(),
    ts: new Date().toISOString(),
  });
}

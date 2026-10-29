/**
 * cloudAdapter — the CLOUD adapter of the one agent (PRD 35 WS3, §3.1 / §4).
 *
 * The ONE importer of `runAgent` on the cloud surface. It builds PORTS from the cloud host and
 * hands the run to the agent; it has NO loop, NO policy and NO branch on behaviour. Every
 * behaviour difference arrives through a port or through `RunPolicy` data the board compiled
 * (the sign-off, the approval gates, the dispatch provenance); `RunPolicy.entryPoint` is a
 * telemetry label and is never read here beyond being stamped.
 *
 *   model        — `cloudAdapterModel`: the metered plan-proxy call + containment (one request);
 *   capabilities — `cloudProvider` composed by `cloudAgent/runProvider` (git API, sandbox, IDE
 *                  workspace, rehearsal as a decorator), under the declared footprint limits;
 *   store        — the Durable Object cursor: the agent's `RunState` is plain JSON, saved after
 *                  every step, so a tick (`maxSteps: 1`) resumes exactly where the last stopped;
 *   events       — the run timeline + the WS6 outcome row (`cloudAdapterPorts`);
 *   human        — the durable pause: park on an approval, `/resume` wakes it;
 *   steering     — the execution's pending steers, drained at every step boundary;
 *   context      — the evolving affect directive, per turn (the prep already inlined the rest);
 *   extensions   — the curated platform tools.
 *
 * The finish gates, guards, verify and compaction are bound with the couplings this surface has
 * (`cloudAdapterHooks`); what they DO is the agent's.
 */
import { asksForSubagents, renderTaskState, runAgent, type ContextPack, type RunPolicy, type RunPorts, type RunState, type RunTask } from '@builderforce/agent-run';
import { isCostLeverOn, type CostLeverId } from '@builderforce/cost-levers';
import type { CloudEngineContext } from './cloudAgentEngine';
import { parseRunDispatch } from './runDispatch';
import { cloudModelPort } from './cloudAdapterModel';
import { cloudPolicyModules } from './cloudAdapterHooks';
import { durableHuman, pendingSteering, timelineSink } from './cloudAdapterPorts';
import { containProvider, platformTools } from './cloudAdapterTools';
import { releaseLeases, settleCloudRun, type RunStash } from './cloudRunTail';
import { openCloudRunHost, type CloudRunHost } from './cloudRunHost';
import type { CloudLoopOpts, CloudLoopResult } from './cloudRunOpts';
import { toRunState } from './cloudRunState';
import { isChildDelegation } from './cloudRunDelegation';

/** The cost levers this surface honours, resolved through the one gate (`@builderforce/cost-levers`) — never by entry point. */
const RUN_LEVERS: readonly CostLeverId[] = [
  'a3_progress_detector', 'd7_deterministic_handlers', 'd8_parallel_tool_calls', 'd1_verifier_cascade',
  'c2_observation_masking', 'c3_task_state', 'c9_price_tier_budget',
];


/** Nothing to pack: the prep inlined the PRD, the ticket and the project's facts into the prompt the task carries. */
const NO_PACK: ContextPack = { focus: [], facts: [], recall: [] };

/** The user turns a resumed transcript already holds — a steer the run adopted is not injected twice. */
function userTurnsOf(resume: RunState | undefined): ReadonlySet<string> {
  return new Set((resume?.messages ?? []).filter((m): m is { role: 'user'; content: string } => (m as { role?: string }).role === 'user').map((m) => m.content));
}

/** The task: the ticket's prompt, who is asking, and the board's dispatch provenance (§6.9). */
function taskOf(host: CloudRunHost, rc: CloudEngineContext): RunTask {
  const { opts } = host;
  const stamped = parseRunDispatch(rc.dispatchPayload);
  const child = isChildDelegation(opts.delegation);
  const source = child ? 'subagent' : stamped.source ?? (opts.originatingChatId != null ? 'chat' : opts.requiredSignoff ? 'lane-entry' : 'manual');
  return {
    prompt: host.userContent,
    runId: String(host.refs.executionId),
    persona: host.systemPrompt,
    ticketId: host.taskRow.id,
    projectId: host.refs.projectId,
    ...(opts.originatingChatId != null ? { chatId: opts.originatingChatId } : {}),
    dispatch: {
      source,
      ...(stamped.approvalId ? { approvalId: stamped.approvalId } : {}),
      ...(child && opts.delegation ? { parentRunId: String(opts.delegation.parent.executionId) } : {}),
    },
  };
}

/** The policy data the board compiled, and the run's lever set. Data only — the agent decides what it means. */
function policyOf(host: CloudRunHost): RunPolicy {
  const { opts, env, refs } = host;
  return {
    entryPoint: 'cloud',
    toolScope: 'ticket',
    role: host.runRole,
    levers: RUN_LEVERS.filter((id) => isCostLeverOn(env, id, refs.tenantId)),
    budgets: {},
    // The run-start pick is a SEED for the model policy (`modelStart.model`), never a pin the agent asks for as-is.
    inference: 'hybrid',
    // The declared checks run once after the finish is accepted, as a best-effort note (`cloudRunTail`) — not a gate.
    verify: 'none',
    ...(opts.requiredSignoff ? { signoff: opts.requiredSignoff } : {}),
    approvalGates: opts.policyGates ?? [],
    // The ticket's OWN words — not the rendered PRD / facts envelope the prompt carries, which can name sub-agents without asking for them.
    delegation: { requested: asksForSubagents(`${host.taskRow.title}\n${host.taskRow.description ?? ''}`), readsBeforeNudge: 6 },
    // Nothing left to try ends the run with what it said; whatever it committed still ships.
    stallExhausted: 'finish',
    modelStart: {
      model: host.pick.model,
      strict: host.pick.strict,
      ...(opts.delegation?.spec?.role ? { delegatedRole: opts.delegation.spec.role } : {}),
      ...(host.verifyPin ? { phaseModels: { verify: host.verifyPin } } : {}),
    },
  };
}

/**
 * Run one cloud run through the one agent.
 *
 * The Durable Object calls this once per alarm tick with `maxSteps: 1` and the cursor's saved
 * state; the Worker surface calls it unbounded in one invocation. Both produce the same trace —
 * the resume state is plain JSON in the cursor.
 */
export async function runCloudAgent(
  rc: CloudEngineContext,
  input: { model: string | undefined; systemPrompt: string; userContent: string },
  opts: CloudLoopOpts,
): Promise<CloudLoopResult> {
  const opened = await openCloudRunHost(rc, input, opts);
  if ('stopped' in opened) return opened.stopped;
  const { host } = opened;
  const { env, db, refs, cancel } = host;

  const resume: RunState | undefined = toRunState(opts.resume);
  /** The run's live state, named by the guards on every hook call — the contained-run progress line reads its task state. */
  const live: { state?: RunState } = {};
  const stash: RunStash = {};
  const model = cloudModelPort({
    env, db, proxy: host.proxy, routing: host.routing,
    run: { tenantId: refs.tenantId, projectId: refs.projectId, taskId: refs.taskId, executionId: refs.executionId, meterExecutionId: host.meterExecutionId, ...(refs.cloudAgentRef ? { cloudAgentRef: refs.cloudAgentRef } : {}) },
    runRole: host.runRole, pickedModel: host.pick.model, genParams: host.genParams,
    ...(opts.execParams ? { execParams: opts.execParams } : {}),
    cost: host.cost, declaredLimits: host.declaredLimits,
    footprint: () => ({ files: host.writtenPaths.size, repositories: host.repoCtx ? 1 : 0 }),
    progress: () => renderTaskState((live.state ?? resume)?.taskState),
    fallbackSurface: host.fallbackSurface,
    startStep: resume?.step ?? 0,
  });
  const ports: RunPorts = {
    model,
    capabilities: containProvider(host.provider, {
      db, tenantId: refs.tenantId, executionId: refs.executionId, cloudAgentRef: refs.cloudAgentRef,
      declared: host.declaredLimits, writtenPaths: host.writtenPaths, repositories: host.repoCtx ? 1 : 0,
    }),
    store: {
      load: () => resume,
      save: () => undefined, // the outcome carries the state; the tail hands it to the cursor
      commitMemory: (consolidated) => { stash.consolidated = consolidated; },
    },
    events: timelineSink(db, refs, () => model.servedModel() ?? host.pick.model),
    human: durableHuman(env, db, refs),
    steering: pendingSteering(db, refs, model.currentStep, () => userTurnsOf(resume)),
    context: { pack: () => NO_PACK, turnSections: () => [opts.dynamicSystem ?? '', host.cost.budgetNote(host.declaredLimits, host.writtenPaths.size, host.repoCtx ? 1 : 0)].filter(Boolean) },
    extensions: platformTools({
      env, db, tenantId: refs.tenantId, projectId: refs.projectId, meterExecutionId: host.meterExecutionId, executionId: refs.executionId,
      ...(refs.cloudAgentRef ? { cloudAgentRef: refs.cloudAgentRef } : {}), ...(opts.originatingChatId != null ? { originatingChatId: opts.originatingChatId } : {}),
    }),
  };

  try {
    const outcome = await runAgent({
      task: taskOf(host, rc),
      policy: policyOf(host),
      ports,
      ...(resume ? { resume } : {}),
      ...(opts.maxSteps !== undefined ? { maxSteps: opts.maxSteps } : {}),
      signal: cancel.controller.signal,
      modules: cloudPolicyModules({
        env, db, run: refs, runRole: host.runRole, repoCtx: host.repoCtx, delegated: !!opts.delegation, writtenHashes: host.writtenHashes,
        ...(host.verify ? { sandbox: host.verify.sandbox } : {}),
        ladder: host.ladder, features: host.features, resolvedModel: model.servedModel,
        ...(opts.execParams ? { execParams: opts.execParams } : {}),
        onState: (state) => { live.state = state; },
      }),
    });
    return await settleCloudRun(host, outcome, stash, model);
  } catch (error) {
    // A thrown port is terminal for this invocation: hand the leases back now, otherwise peers stay
    // blocked until the TTL although this run can no longer use them. The original failure is preserved.
    await releaseLeases(host);
    throw error;
  } finally {
    // Stop the cancel watcher so its timer can't outlive the run, and abort any fetch still in flight.
    cancel.stop();
    cancel.controller.abort();
  }
}

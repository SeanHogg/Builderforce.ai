import { createDurableErrorReporter, type DurableErrorReporter } from '../../application/observability/durableErrorReporter';
/**
 * CloudRunnerDO — the ONE cloud runtime. Every cloud run, on every plan, runs the one
 * engine here across Durable Object `alarm()` ticks: ONE LLM step per tick, with the
 * conversation state persisted in DO storage between ticks. Its shell and working tree
 * come from the run's SANDBOX — the Cloudflare Container, or the repo's GitHub Actions
 * runner, which polls this DO for the engine's requests (`sandbox/runSandboxHost.ts`). Each tick is a fresh Worker invocation with a fresh CPU/subrequest
 * budget, so a multi-step run never hits the ~30s `waitUntil` wall that kills the
 * interim Worker path — it just keeps ticking until the agent calls `finish`.
 *
 * Mirrors {@link AnalysisRunnerDO}: a cursor in `state.storage` is the
 * idempotency/resume anchor; the `executions` row mirrors status for the polling
 * UI, and `updated_at` is bumped every tick so the orphan reaper treats an
 * actively-ticking run as alive (heartbeat) and only reaps one that has gone
 * silent. Kickoff: the route POSTs `/start`; no long work happens in `fetch()`.
 */
import { eq } from 'drizzle-orm';
import { buildDatabase, type Db } from '../database/connection';
import { runInDurableObjectScope } from '../../application/shared/requestScope';
import { executions } from '../database/schema';
import { scopedToTenant } from '../database/tenantScope';
import { prepareCloudRun, resolveAgentEngine, markCloudExecutionRunning, initialCloudLimbicState, evolveCloudLimbicState, recordLimbicState, type CloudLoopState } from '../../application/runtime/cloudAgentEngine';
import { loadPersonaSetpoints } from '../../application/artifact/capabilityContext';
import { heartbeatExecution } from '../../application/runtime/cloudAgent/runContext';
import type { AgentExecParams } from '@builderforce/agent-tools';
import type { LimbicState } from '@seanhogg/builderforce-memory-engine/limbic';
import { parseRoutingBias, parseArcStage, parsePolicyGates, parseModel, parseReviewRole, parseLaneKey, parseOriginatingChatId, parseExecutor, withRunSandbox } from '../../application/runtime/cloudDispatch';
import { ACTIONS_RUNNER_WAIT_MS, RunSandboxHost, type RunSandboxKind } from '../../application/runtime/sandbox/runSandboxHost';
import { dispatchGithubActionsRun } from '../../application/runtime/githubActionsDispatch';
import { scoreRunOutcome } from '../../application/runtime/scoreRunOutcome';
import { isInfrastructureEviction } from '../../application/runtime/orphanReasons';
import { settleLateSteersSafely } from '../../application/runtime/lateSteerFollowUp';
import { childBrief, parseCloudChild, settleCloudChildLineage } from '../../application/runtime/cloudChildRuns';
import type { CloudRunDelegation } from '../../application/runtime/cloudRunDelegation';
import { buildRuntimeService } from '../../buildRuntimeService';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import { ExecutionStatus } from '../../domain/shared/types';
import { TERMINAL_EXECUTION_STATUSES } from '../../domain/execution/Execution';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import type { Env } from '../../env';

interface StartBody {
  executionId: number;
  tenantId: number;
  projectId: number;
  taskId: number;
  taskTitle: string;
  taskDescription: string | null;
  cloudAgentRef?: string;
  agentLabel: string;
  /** JSON execution payload — parsed for `model`. */
  payload?: string;
  artifacts?: ResolvedArtifacts;
}

type Stage = 'prep' | 'loop';

interface Cursor extends StartBody {
  stage: Stage;
  model?: string;
  systemPrompt?: string;
  userContent?: string;
  loop?: CloudLoopState;
  /** V3 (limbic) only — the evolving affective state injected per tick via the
   *  loop's dynamicSystem seam, plus the personality setpoints it relaxes toward.
   *  Plain JSON (Record<string,number>) so it survives DO cursor persistence. */
  limbic?: boolean;
  limbicState?: LimbicState;
  limbicSetpoints?: LimbicState;
  /** Execution levers compiled from the agent's/personas' personality (resolved on
   *  the prep tick, reused every loop tick so personality applies across DO ticks). */
  execParams?: AgentExecParams;
  /** The run's sandbox (decided on the prep tick): the shell and working tree. */
  sandbox?: RunSandboxKind;
  /** When the loop started waiting for its Actions runner to poll. */
  sandboxWaitSince?: number;
}

const CURSOR_KEY = 'cursor';
/** Set once the run is known terminal (told via `/concluded`, or read from the row).
 *  Sticky until cleanup, so no later tick or cancel poll needs the DB to know it. */
const CONCLUDED_KEY = 'concluded';
/**
 * How long a "not concluded" answer from the row is trusted before re-reading it. The
 * alarm re-arms per LLM step and the engine's cancel watcher polls every 2s, so an
 * uncached check was several Neon round trips per tick for an answer that almost never
 * changes. A cancel through RuntimeService tells this DO directly (`/concluded`), so
 * this window only delays what nobody signals — a reaper fail, a cancel from an older
 * isolate — by at most 10s.
 */
const CONCLUDED_RECHECK_MS = 10_000;

export class CloudRunnerDO implements DurableObject {
  declare readonly '__DURABLE_OBJECT_BRAND': never;

  private readonly db: Db;
  private readonly runtimeService: RuntimeService;
  /** Bound once here so no call site can forget the runtime override. */
  private readonly reportError: DurableErrorReporter;
  /** When the row last said "not concluded" (in memory: an evicted DO just re-reads). */
  private notConcludedCheckedAt = 0;
  /** The run's sandbox: which one, the tick's handle, and the Actions runner's mailbox. */
  private readonly sandboxHost: RunSandboxHost;

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.reportError = createDurableErrorReporter('infrastructure/relay/CloudRunnerDO.ts', env, state);
    this.db = buildDatabase(env);
    // Same canonical RuntimeService the Worker request handler uses, so a durable
    // run's status transitions move the ticket, record metrics, write audit events,
    // and trigger the next-lane agent identically — no raw open-coded db.update.
    this.runtimeService = buildRuntimeService(env, this.db);
    this.sandboxHost = new RunSandboxHost(env, this.db, state.storage);
  }

  fetch(request: Request): Promise<Response> {
    return runInDurableObjectScope('CloudRunnerDO', this.env, this.state, () => this.handleFetch(request));
  }

  private async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/start')) {
      const body = (await request.json().catch(() => null)) as StartBody | null;
      if (!body || typeof body.executionId !== 'number') return new Response('bad request', { status: 400 });
      await this.start(body);
      return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    }
    // Resume a run paused on ask_human: a human answered (delivered as a pending
    // steer the loop drains on its next tick), so flip back to running and re-arm
    // the alarm. The cursor (incl. loop resume state) was kept across the pause.
    if (request.method === 'POST' && url.pathname.endsWith('/resume')) {
      const cursor = (await this.state.storage.get<Cursor>(CURSOR_KEY)) ?? null;
      if (!cursor) return new Response(JSON.stringify({ ok: false, reason: 'no paused run' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      await markCloudExecutionRunning(this.runtimeService, cursor.executionId);
      // An Actions run released its runner while it waited: queue a fresh one.
      if (cursor.sandbox === 'actions') {
        this.sandboxHost.reopen(cursor.sandbox);
        cursor.sandboxWaitSince = undefined;
        await this.state.storage.put(CURSOR_KEY, cursor);
        await dispatchGithubActionsRun(this.env, this.db, { tenantId: cursor.tenantId, taskId: cursor.taskId, executionId: cursor.executionId })
          .catch((error) => this.reportError(error, { operation: 'resume', context: { logMessage: '[cloud-runner] Actions runner re-dispatch failed', details: { executionId: cursor.executionId } } }));
      }
      await this.state.storage.setAlarm(Date.now());
      // Narrate the resume into the ticket's linked Brain chats — this is the ONLY
      // authoritative "actually resumed" point (a wake with no cursor 409s above).
      // The approval id (threaded from the answer) uniquifies the idempotency key so
      // each ask_human Q&A cycle narrates exactly one resumed line.
      const body = (await request.json().catch(() => null)) as { approvalId?: string } | null;
      await this.runtimeService.postLifecycleMilestoneById(cursor.executionId, 'resumed', {
        eventNonce: typeof body?.approvalId === 'string' ? body.approvalId : null,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    }
    // The run's GitHub Actions runner: it cannot be called, so it polls here for the
    // engine's next sandbox request and posts each result back (`sandbox/sandboxMailbox.ts`).
    if (request.method === 'POST' && url.pathname.endsWith('/sandbox/next')) {
      return Response.json(await this.sandboxHost.handleRunnerPoll());
    }
    if (request.method === 'POST' && url.pathname.endsWith('/sandbox/result')) {
      const body = (await request.json().catch(() => null)) as { id?: unknown; result?: unknown } | null;
      const taken = typeof body?.id === 'string' && this.sandboxHost.handleRunnerResult(body.id, body.result);
      return Response.json({ ok: taken }, { status: taken ? 200 : 409 });
    }
    // The run was concluded elsewhere (RuntimeService.cancel). Remember it so the next
    // tick — and the in-flight step's cancel poll — stop without reading the row. A DO
    // with no run (container/host executions, or already cleaned up) records nothing.
    if (request.method === 'POST' && url.pathname.endsWith('/concluded')) {
      if (await this.state.storage.get<Cursor>(CURSOR_KEY)) await this.state.storage.put(CONCLUDED_KEY, true);
      return new Response(null, { status: 204 });
    }
    return new Response('not found', { status: 404 });
  }

  private async start(body: StartBody): Promise<void> {
    // THE shared reader (`cloudDispatch.parseModel`), not a local re-parse. The inline
    // copy that used to live here is how the durable surface — where reviewer runs
    // actually execute — missed the supersession rewrite that reader applies: a payload
    // pinned to a retired id led the BYO chain and 503'd. Two parsers for one field is
    // one parser too many.
    const model = parseModel(body.payload);

    // Already concluded before we start (cancelled, or reaped) → don't transition or spend.
    // A self-heal requeue reuses this DO (`exec:<id>`), so a flag left by an earlier
    // life must not stop it: the start always reads the row itself.
    await this.state.storage.delete(CONCLUDED_KEY);
    this.notConcludedCheckedAt = 0;
    if (await this.isAlreadyConcluded(body.executionId, { fresh: true })) return;

    const cursor: Cursor = { ...body, stage: 'prep', model };
    await this.state.storage.put(CURSOR_KEY, cursor);
    await markCloudExecutionRunning(this.runtimeService, body.executionId);
    await this.state.storage.setAlarm(Date.now());
  }

  alarm(): Promise<void> {
    return runInDurableObjectScope('CloudRunnerDO', this.env, this.state, () => this.handleAlarm());
  }

  private async handleAlarm(): Promise<void> {
    const cursor = (await this.state.storage.get<Cursor>(CURSOR_KEY)) ?? null;
    if (!cursor) return;

    // Cross-tick conclusion: the /cancel endpoint flipped the row to CANCELLED, or
    // staleExecutionReaper failed it, from another isolate. Already terminal — just
    // stop and clean up.
    if (await this.isAlreadyConcluded(cursor.executionId)) {
      await this.cleanup(cursor.executionId);
      return;
    }
    // Heartbeat: prove the run is alive so the orphan reaper doesn't reap an
    // actively-ticking run (the cloud ceiling measures from updated_at). The ONE
    // throttled writer the container ops use too — the alarm re-arms per LLM step, so
    // an unthrottled beat here was a write every few seconds per run. This DO is one
    // isolate, so the beat's in-isolate gate makes most ticks skip the round trip too.
    await heartbeatExecution(this.db, cursor.executionId);

    try {
      if (cursor.stage === 'prep') {
        // The sandbox first: whether the run has a shell decides its tools and its prompt.
        cursor.sandbox = await this.sandboxHost.prepare(sandboxRunOf(cursor), parseExecutor(cursor.payload) === 'github_actions' ? 'github_actions' : 'durable');
        // Stamped on the row too, so run history and diagnostics can say whether this run
        // could build and test what it wrote.
        cursor.payload = withRunSandbox(cursor.payload, cursor.sandbox ?? 'none');
        await this.db.update(executions).set({ payload: cursor.payload }).where(eq(executions.id, cursor.executionId))
          .catch((error) => this.reportError(error, { operation: 'alarm', context: { logMessage: '[cloud-runner] sandbox stamp failed', details: { executionId: cursor.executionId } } }));
        const { systemPrompt, userContent, execParams, agentPsychometric } = await prepareCloudRun(
          this.env, this.db, cursor.executionId,
          { id: cursor.taskId, title: cursor.taskTitle, description: cursor.taskDescription },
          cursor.tenantId, cursor.projectId, cursor.agentLabel, cursor.model, cursor.artifacts, cursor.cloudAgentRef, cursor.payload,
          { shell: !!cursor.sandbox },
        );
        cursor.systemPrompt = systemPrompt;
        cursor.userContent = userContent;
        // A sub-agent runs the same prompt as its owner with the sub-agent brief in front,
        // and its task as the first turn.
        const child = parseCloudChild(cursor.payload);
        if (child) Object.assign(cursor, childBrief(child, systemPrompt));
        // Persona/agent personality exec levers — persisted so every loop tick applies
        // the same temperature (personality must hold across DO ticks, not just tick 1).
        cursor.execParams = execParams;
        // The current engine (V3) ALWAYS runs the limbic layer: seed the affective
        // state from the personality setpoints + the task. It's injected per-tick via
        // the loop's dynamicSystem seam (NOT baked into systemPrompt) and EVOLVES
        // across ticks below. The agent's OWN personality contributes a setpoint too.
        cursor.limbic = true;
        cursor.limbicSetpoints = await loadPersonaSetpoints(this.env, this.db, cursor.artifacts?.personas ?? [], agentPsychometric);
        cursor.limbicState = initialCloudLimbicState(
          { title: cursor.taskTitle, description: cursor.taskDescription },
          cursor.limbicSetpoints,
        );
        await recordLimbicState(
          this.db,
          { tenantId: cursor.tenantId, cloudAgentRef: cursor.cloudAgentRef, executionId: cursor.executionId },
          cursor.limbicState,
        );
        cursor.stage = 'loop';
        await this.persistAndArm(cursor);
        return;
      }

      // An Actions run holds until GitHub has scheduled its runner and it has polled: the
      // engine's first shell call would otherwise wait out a queued job inside one tick.
      if (await this.sandboxHost.awaitingRunner(cursor.sandbox)) {
        cursor.sandboxWaitSince ??= Date.now();
        if (Date.now() - cursor.sandboxWaitSince > ACTIONS_RUNNER_WAIT_MS) {
          throw new Error(`GitHub Actions did not start the agent runner within ${Math.round(ACTIONS_RUNNER_WAIT_MS / 60_000)} minutes. Check the workflow run in the repository's Actions tab.`);
        }
        await this.state.storage.put(CURSOR_KEY, cursor);
        await this.state.storage.setAlarm(Date.now() + 10_000);
        return;
      }

      // One LLM step per tick; resume from the saved conversation state. The engine
      // is resolved through the ONE seam (resolveAgentEngine) — this surface only says
      // it is durable and hands over THIS tick's evolving affect; the engine owns the
      // loop, the directive and the resume/deferral wiring.
      const reviewRole = parseReviewRole(cursor.payload);
      const reviewLane = parseLaneKey(cursor.payload);
      const requiredSignoff = reviewRole
        ? { roleKey: reviewRole, ...(reviewLane ? { laneKey: reviewLane } : {}) }
        : undefined;
      const originatingChatId = parseOriginatingChatId(cursor.payload);
      const routingBias = parseRoutingBias(cursor.payload);
      const arcStage = parseArcStage(cursor.payload);
      const policyGates = parsePolicyGates(cursor.payload);
      // Its place in a delegation tree: every run may spawn; a sub-agent also carries its spec.
      const child = parseCloudChild(cursor.payload);
      const delegation: CloudRunDelegation = { parent: cursor, runtime: this.runtimeService, ...(child ? { spec: child } : {}) };
      const engine = resolveAgentEngine({
        env: this.env, db: this.db, executionId: cursor.executionId, tenantId: cursor.tenantId,
        taskRow: { id: cursor.taskId, title: cursor.taskTitle, description: cursor.taskDescription },
        projectId: cursor.projectId, agentLabel: cursor.agentLabel, cloudAgentRef: cursor.cloudAgentRef,
        isCancelled: () => this.isAlreadyConcluded(cursor.executionId),
        ...(routingBias ? { routingBias } : {}),
        ...(arcStage ? { arcStage } : {}),
        ...(originatingChatId != null ? { originatingChatId } : {}),
        ...(requiredSignoff ? { requiredSignoff } : {}),
        ...(cursor.execParams ? { execParams: cursor.execParams } : {}),
        surface: {
          kind: 'durable', maxSteps: 1,
          ...(cursor.limbic && cursor.limbicState ? { limbicState: cursor.limbicState } : {}),
          ...(cursor.sandbox ? { sandbox: this.sandboxHost.forTick(sandboxRunOf(cursor), cursor.sandbox) } : {}),
        },
        delegation,
      });
      const result = await engine.run({
        systemPrompt: cursor.systemPrompt ?? '', userContent: cursor.userContent ?? '', model: cursor.model,
        ...(cursor.loop ? { resume: cursor.loop } : {}),
        ...(policyGates?.length ? { policy: { gates: policyGates } } : {}),
      });

      // V3: evolve affect from this tick's outcome (amygdala) toward setpoints
      // (hypothalamus) so the next tick's directive reflects how the run is going.
      if (cursor.limbic && cursor.limbicState) {
        cursor.limbicState = evolveCloudLimbicState(cursor.limbicState, cursor.limbicSetpoints, result);
      }

      if (result.cancelled) { await this.cleanup(cursor.executionId); return; }

      // Paused on a human question: persist the resume state but do NOT re-arm the
      // alarm — the run sleeps (no token spend) until /resume wakes it after the
      // question is answered. The cursor is kept so /resume can continue from here.
      if (result.awaitingInput) {
        cursor.loop = result.state as CloudLoopState | undefined;
        await this.state.storage.put(CURSOR_KEY, cursor);
        await this.sandboxHost.park(cursor.sandbox);
        await this.db.update(executions)
          .set({ status: 'paused', updatedAt: new Date() })
          .where(eq(executions.id, cursor.executionId))
          .catch((error) => this.reportError(error, { operation: "alarm", context: { logMessage: '[cloud-runner] pause transition failed', details: {
            executionId: cursor.executionId,
            tenantId: cursor.tenantId,
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          } } }));
        // Narrate the pause — WITH the question — into the ticket's linked Brain
        // chats, so the human driving the conversation sees what the agent needs
        // (Slack/email via approvalNotifier are the only other channels). Keyed by
        // approval id: repeat pauses each narrate once; a retried tick dedupes.
        await this.runtimeService.postLifecycleMilestoneById(cursor.executionId, 'paused', {
          questionText: result.awaitingInput.question,
          eventNonce: result.awaitingInput.approvalId,
        });
        return;
      }

      if (!result.finished) {
        cursor.loop = result.state as CloudLoopState | undefined;
        await this.persistAndArm(cursor);
        return;
      }

      // Terminal: mark the execution (canonical transition — moves the ticket to
      // In Review, records metrics/audit, and fires the next-lane agent) and stop.
      // Skip when the run already concluded (retried alarm, reaper, cancellation)
      // — that transition can only be rejected, and would clobber a cancellation.
      if (!(await this.isAlreadyConcluded(cursor.executionId, { fresh: true }))) {
        await this.runtimeService.update(
          cursor.executionId,
          result.ok
            ? { status: ExecutionStatus.COMPLETED, result: result.output }
            : { status: ExecutionStatus.FAILED, errorMessage: result.output },
        ).catch((error) => this.reportError(error, { operation: "alarm", level: 'warning', context: { logMessage: '[cloud-runner] terminal transition was rejected', details: {
          executionId: cursor.executionId,
          tenantId: cursor.tenantId,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        } } }));
      }
      await this.cleanup(cursor.executionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // A PLATFORM EVICTION is not a run failure. Cloudflare resets every live
      // Durable Object when a new Worker version is deployed, so an ordinary deploy
      // interrupts every in-flight run at once. Failing them wrote the raw
      // "Durable Object reset because its code was updated." onto the ticket AND
      // spent a strike against the 3-failure autonomy breaker — three deploys in an
      // hour could halt a healthy ticket (task 683: 3 of 5 failures, one 47-minute
      // deploy window).
      //
      // The cursor is persisted on every tick, so the run is resumable exactly where
      // it stopped: re-arm the alarm and leave the row `running`. If even that write
      // is lost (the isolate may be going away as we speak), the row simply stays
      // non-terminal and `staleExecutionReaper` self-heals it onto a fresh durable
      // runner within minutes — the machinery that already exists for a dropped run.
      // Either way we must NOT cleanup(): that deletes the cursor this run resumes from.
      if (isInfrastructureEviction(message)) {
        await this.persistAndArm(cursor).catch((error) => this.reportError(error, { operation: "alarm", context: { logMessage: '[cloud-runner] crash cursor persistence failed; reaper must recover', details: {
          executionId: cursor.executionId,
          tenantId: cursor.tenantId,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        } } }));
        return;
      }

      // Don't clobber a run that already concluded; otherwise fail it so it isn't stuck.
      if (!(await this.isAlreadyConcluded(cursor.executionId, { fresh: true }))) {
        await this.runtimeService.update(cursor.executionId, {
          status: ExecutionStatus.FAILED,
          errorMessage: message,
        }).catch((error) => this.reportError(error, { operation: "alarm", level: 'warning', context: { logMessage: '[cloud-runner] crash failure transition was rejected', details: {
          executionId: cursor.executionId,
          tenantId: cursor.tenantId,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        } } }));
      }
      await this.cleanup(cursor.executionId);
    }
  }

  /**
   * True when the run already reached a terminal state, so this tick must not
   * attempt another transition.
   *
   * An alarm can legitimately arrive after the run is over: Cloudflare retries a
   * failed alarm, a deploy re-runs an evicted one, `staleExecutionReaper` may
   * have already failed the row, or a human cancelled mid-tick. In each case
   * `RuntimeService.update` could only throw `Cannot complete an execution in
   * status '<terminal>'` — and forcing it through would clobber a cancellation.
   * Skipping is the correct outcome, not an error worth reporting.
   *
   * Fails OPEN (returns false) so a transient read error still lets the run
   * conclude — the domain guard remains the backstop.
   *
   * Cached: a terminal answer is sticky in storage ({@link CONCLUDED_KEY}); a
   * "not concluded" one is trusted for {@link CONCLUDED_RECHECK_MS}. `fresh` always
   * reads the row — the start and the terminal transitions, where a stale "no" could
   * clobber a cancellation, use it.
   */
  private async isAlreadyConcluded(executionId: number, opts?: { fresh?: boolean }): Promise<boolean> {
    if (await this.state.storage.get<boolean>(CONCLUDED_KEY)) return true;
    if (!opts?.fresh && Date.now() - this.notConcludedCheckedAt < CONCLUDED_RECHECK_MS) return false;
    try {
      const [row] = await this.db
        .select({ status: executions.status })
        .from(executions)
        .where(eq(executions.id, executionId))
        .limit(1);
      const concluded = TERMINAL_EXECUTION_STATUSES.includes(row?.status as ExecutionStatus);
      if (concluded) await this.state.storage.put(CONCLUDED_KEY, true);
      else this.notConcludedCheckedAt = Date.now();
      return concluded;
    } catch (error) {
      this.reportError(error, {
        operation: 'isAlreadyConcluded',
        level: 'warning',
        context: { executionId },
      });
      return false;
    }
  }

  private async persistAndArm(cursor: Cursor): Promise<void> {
    await this.state.storage.put(CURSOR_KEY, cursor);
    await this.state.storage.setAlarm(Date.now());
  }

  private async cleanup(executionId?: number): Promise<void> {
    // The run is over: release its sandbox (the container's clone, the Actions runner).
    const ending = await this.state.storage.get<Cursor>(CURSOR_KEY);
    if (ending?.sandbox) await this.sandboxHost.close(sandboxRunOf(ending), ending.sandbox).catch(() => undefined);
    // Terminal — a steer that arrived after the loop's last tick is LATE: it starts a
    // follow-up run under the person who sent it (a cancelled run's is released,
    // visibly) — lateSteerFollowUp.ts. Every DO terminal path (finish, cancel, error)
    // routes through here, and the row is already terminal, so the follow-up never
    // starts beside the run it follows. Idempotent: a claimed steer is never re-claimed.
    if (executionId != null) {
      // A child's report goes to its chat and its parent; a parent's live children stop.
      await settleCloudChildLineage(this.db, this.runtimeService, executionId);
      await settleLateSteersSafely({ env: this.env, db: this.db, runtimeService: this.runtimeService }, { executionId });
      // Learned Model Routing: the single durable-surface terminal chokepoint —
      // every DO terminal path (finish, cancel, error) routes through cleanup, so
      // scoring here covers them all. Idempotent + best-effort (never blocks).
      await scoreRunOutcome(this.env, this.db, { executionId }).catch((error) => this.reportError(error, { operation: "cleanup", context: { logMessage: '[cloud-runner] outcome scoring failed', details: {
        executionId,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      } } }));
    }
    await this.state.storage.delete(CURSOR_KEY);
    await this.state.storage.delete(CONCLUDED_KEY);
    this.notConcludedCheckedAt = 0;
    await this.state.storage.deleteAlarm();
  }
}

/** What the run's sandbox host needs to know about the run. */
function sandboxRunOf(cursor: Cursor) {
  return {
    executionId: cursor.executionId, tenantId: cursor.tenantId, projectId: cursor.projectId, taskId: cursor.taskId,
    ...(cursor.cloudAgentRef ? { cloudAgentRef: cursor.cloudAgentRef } : {}),
  };
}

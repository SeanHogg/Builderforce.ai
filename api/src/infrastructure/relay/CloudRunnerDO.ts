/**
 * CloudRunnerDO — the **durable** cloud surface for V2 agents. Runs the cloud
 * agent loop fully in the cloud across Durable Object `alarm()` ticks: ONE LLM
 * step per tick, with the conversation state persisted in DO storage between
 * ticks. Each tick is a fresh Worker invocation with a fresh CPU/subrequest
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
import { executions } from '../database/schema';
import { prepareCloudRun, runCloudToolLoop, markCloudExecutionRunning, initialCloudLimbicState, evolveCloudLimbicState, recordLimbicState, type CloudLoopState } from '../../application/runtime/cloudAgentEngine';
import { loadPersonaSetpoints } from '../../application/artifact/capabilityContext';
import { buildLimbicBlock, type LimbicState, type AgentExecParams } from '@builderforce/agent-tools';
import { parseRoutingBias, parsePolicyGates } from '../../application/runtime/cloudDispatch';
import { scoreRunOutcome } from '../../application/runtime/scoreRunOutcome';
import { releasePendingSteers } from '../../application/runtime/executionSteering';
import { buildRuntimeService } from '../../buildRuntimeService';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import { ExecutionStatus } from '../../domain/shared/types';
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
}

const CURSOR_KEY = 'cursor';

export class CloudRunnerDO implements DurableObject {
  declare readonly '__DURABLE_OBJECT_BRAND': never;

  private readonly db: Db;
  private readonly runtimeService: RuntimeService;
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.db = buildDatabase(env);
    // Same canonical RuntimeService the Worker request handler uses, so a durable
    // run's status transitions move the ticket, record metrics, write audit events,
    // and trigger the next-lane agent identically — no raw open-coded db.update.
    this.runtimeService = buildRuntimeService(env, this.db);
  }

  async fetch(request: Request): Promise<Response> {
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
    return new Response('not found', { status: 404 });
  }

  private async start(body: StartBody): Promise<void> {
    let model: string | undefined;
    try {
      const p = body.payload ? (JSON.parse(body.payload) as { model?: unknown }) : null;
      if (p && typeof p.model === 'string' && p.model.trim()) model = p.model.trim();
    } catch { /* payload not JSON — use default model */ }

    // Already cancelled before we start → don't transition or spend.
    if (await this.isCancelled(body.executionId)) return;

    const cursor: Cursor = { ...body, stage: 'prep', model };
    await this.state.storage.put(CURSOR_KEY, cursor);
    await markCloudExecutionRunning(this.runtimeService, body.executionId);
    await this.state.storage.setAlarm(Date.now());
  }

  async alarm(): Promise<void> {
    const cursor = (await this.state.storage.get<Cursor>(CURSOR_KEY)) ?? null;
    if (!cursor) return;

    // Cross-tick cancel: the /cancel endpoint flipped the row to CANCELLED from
    // another isolate. The row is already terminal — just stop and clean up.
    if (await this.isCancelled(cursor.executionId)) {
      await this.cleanup(cursor.executionId);
      return;
    }
    // Heartbeat: prove the run is alive so the orphan reaper doesn't reap an
    // actively-ticking run (the cloud ceiling measures from updated_at).
    await this.db.update(executions)
      .set({ updatedAt: new Date() })
      .where(eq(executions.id, cursor.executionId))
      .catch(() => { /* best-effort */ });

    try {
      if (cursor.stage === 'prep') {
        const { systemPrompt, userContent, execParams, agentPsychometric } = await prepareCloudRun(
          this.env, this.db, cursor.executionId,
          { id: cursor.taskId, title: cursor.taskTitle, description: cursor.taskDescription },
          cursor.tenantId, cursor.projectId, cursor.agentLabel, cursor.model, cursor.artifacts, cursor.cloudAgentRef, cursor.payload,
        );
        cursor.systemPrompt = systemPrompt;
        cursor.userContent = userContent;
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

      // One LLM step per tick; resume from the saved conversation state. For V3,
      // inject THIS tick's evolving affect as a per-step directive (the loop seam),
      // leaving the persisted conversation untouched.
      const dynamicSystem = cursor.limbic && cursor.limbicState ? buildLimbicBlock(cursor.limbicState) : undefined;
      const result = await runCloudToolLoop(
        this.env, this.db, cursor.executionId, cursor.tenantId,
        { id: cursor.taskId, title: cursor.taskTitle, description: cursor.taskDescription },
        cursor.cloudAgentRef, cursor.agentLabel, cursor.model,
        cursor.systemPrompt ?? '', cursor.userContent ?? '',
        () => this.isCancelled(cursor.executionId),
        cursor.projectId,
        { resume: cursor.loop, maxSteps: 1, deferFinalize: true, routingBias: parseRoutingBias(cursor.payload), policyGates: parsePolicyGates(cursor.payload), ...(dynamicSystem ? { dynamicSystem } : {}), ...(cursor.execParams ? { execParams: cursor.execParams } : {}) },
      );

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
        cursor.loop = result.state;
        await this.state.storage.put(CURSOR_KEY, cursor);
        await this.db.update(executions)
          .set({ status: 'paused', updatedAt: new Date() })
          .where(eq(executions.id, cursor.executionId))
          .catch(() => { /* best-effort */ });
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
        cursor.loop = result.state;
        await this.persistAndArm(cursor);
        return;
      }

      // Terminal: mark the execution (canonical transition — moves the ticket to
      // In Review, records metrics/audit, and fires the next-lane agent) and stop.
      await this.runtimeService.update(
        cursor.executionId,
        result.ok
          ? { status: ExecutionStatus.COMPLETED, result: result.output }
          : { status: ExecutionStatus.FAILED, errorMessage: result.output },
      ).catch(() => { /* already terminal/cancelled — leave it */ });
      await this.cleanup(cursor.executionId);
    } catch (err) {
      // Don't clobber a cancellation; otherwise fail the run so it isn't stuck.
      if (!(await this.isCancelled(cursor.executionId))) {
        await this.runtimeService.update(cursor.executionId, {
          status: ExecutionStatus.FAILED,
          errorMessage: err instanceof Error ? err.message : String(err),
        }).catch(() => { /* already terminal/cancelled — leave it */ });
      }
      await this.cleanup(cursor.executionId);
    }
  }

  private async isCancelled(executionId: number): Promise<boolean> {
    try {
      const [row] = await this.db
        .select({ status: executions.status })
        .from(executions)
        .where(eq(executions.id, executionId))
        .limit(1);
      return row?.status === 'cancelled';
    } catch {
      return false;
    }
  }

  private async persistAndArm(cursor: Cursor): Promise<void> {
    await this.state.storage.put(CURSOR_KEY, cursor);
    await this.state.storage.setAlarm(Date.now());
  }

  private async cleanup(executionId?: number): Promise<void> {
    // Terminal — drop any steer that arrived after the loop's last tick so it can't
    // dangle unconsumed. Covers the DO error/cancel paths that bypass finalizeCloudRun
    // (the finished path already released inside it); releasePendingSteers is idempotent.
    if (executionId != null) {
      await releasePendingSteers(this.db, executionId);
      // Learned Model Routing: the single durable-surface terminal chokepoint —
      // every DO terminal path (finish, cancel, error) routes through cleanup, so
      // scoring here covers them all. Idempotent + best-effort (never blocks).
      await scoreRunOutcome(this.env, this.db, { executionId }).catch(() => { /* best-effort */ });
    }
    await this.state.storage.delete(CURSOR_KEY);
    await this.state.storage.deleteAlarm();
  }
}

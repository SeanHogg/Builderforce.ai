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
import { prepareCloudRun, runCloudToolLoop, type CloudLoopState } from '../../presentation/routes/runtimeRoutes';
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
}

const CURSOR_KEY = 'cursor';

export class CloudRunnerDO implements DurableObject {
  declare readonly '__DURABLE_OBJECT_BRAND': never;

  private readonly db: Db;
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.db = buildDatabase(env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/start')) {
      const body = (await request.json().catch(() => null)) as StartBody | null;
      if (!body || typeof body.executionId !== 'number') return new Response('bad request', { status: 400 });
      await this.start(body);
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
    await this.db.update(executions)
      .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
      .where(eq(executions.id, body.executionId))
      .catch(() => { /* best-effort */ });
    await this.state.storage.setAlarm(Date.now());
  }

  async alarm(): Promise<void> {
    const cursor = (await this.state.storage.get<Cursor>(CURSOR_KEY)) ?? null;
    if (!cursor) return;

    // Cross-tick cancel: the /cancel endpoint flipped the row to CANCELLED from
    // another isolate. The row is already terminal — just stop and clean up.
    if (await this.isCancelled(cursor.executionId)) {
      await this.cleanup();
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
        const { systemPrompt, userContent } = await prepareCloudRun(
          this.env, this.db, cursor.executionId,
          { id: cursor.taskId, title: cursor.taskTitle, description: cursor.taskDescription },
          cursor.tenantId, cursor.projectId, cursor.agentLabel, cursor.model, cursor.artifacts, cursor.cloudAgentRef, cursor.payload,
        );
        cursor.systemPrompt = systemPrompt;
        cursor.userContent = userContent;
        cursor.stage = 'loop';
        await this.persistAndArm(cursor);
        return;
      }

      // One LLM step per tick; resume from the saved conversation state.
      const result = await runCloudToolLoop(
        this.env, this.db, cursor.executionId, cursor.tenantId,
        { id: cursor.taskId, title: cursor.taskTitle, description: cursor.taskDescription },
        cursor.cloudAgentRef, cursor.agentLabel, cursor.model,
        cursor.systemPrompt ?? '', cursor.userContent ?? '',
        () => this.isCancelled(cursor.executionId),
        cursor.projectId,
        { resume: cursor.loop, maxSteps: 1, deferFinalize: true },
      );

      if (result.cancelled) { await this.cleanup(); return; }

      if (!result.finished) {
        cursor.loop = result.state;
        await this.persistAndArm(cursor);
        return;
      }

      // Terminal: mark the execution and stop ticking.
      await this.db.update(executions)
        .set(result.ok
          ? { status: 'completed', result: result.output, completedAt: new Date(), updatedAt: new Date() }
          : { status: 'failed', errorMessage: result.output, completedAt: new Date(), updatedAt: new Date() })
        .where(eq(executions.id, cursor.executionId))
        .catch(() => { /* best-effort */ });
      await this.cleanup();
    } catch (err) {
      // Don't clobber a cancellation; otherwise fail the run so it isn't stuck.
      if (!(await this.isCancelled(cursor.executionId))) {
        await this.db.update(executions)
          .set({ status: 'failed', errorMessage: err instanceof Error ? err.message : String(err), completedAt: new Date(), updatedAt: new Date() })
          .where(eq(executions.id, cursor.executionId))
          .catch(() => { /* best-effort */ });
      }
      await this.cleanup();
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

  private async cleanup(): Promise<void> {
    await this.state.storage.delete(CURSOR_KEY);
    await this.state.storage.deleteAlarm();
  }
}

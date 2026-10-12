/**
 * `orchestrate.live` in the cloud — spawn a sub-agent as its OWN durable run, and the
 * owner's verbs for children it is not blocked on. ONE backing for every cloud surface:
 * a parent on the durable runner and a parent in a Container or Actions image (whose
 * delegation ops the Worker answers) start the same child the same way.
 *
 * Recursion, not a second loop: a child is a durable execution on the parent's ticket,
 * started on the same runner with the same engine, carrying a `subagent` spec and an
 * owner pointer (`cloudChildRuns.ts`). `spawn` returns its handle the moment it is
 * started; the parent keeps working, redirects it with a steer, stops it with a cancel,
 * and hears its report as a steer before its next turn. There is no step cap on a child —
 * it ends when it finishes, when it is stopped, or on the kernel's failure-streak breaker.
 */

import {
  ownerDirectionText,
  WAIT_INTERRUPTED_NOTE,
  type LiveChildControls,
  type OrchestrationCapability,
  type SubagentRequest,
  type SubagentResult,
} from '@builderforce/agent-tools';
import { MAX_SUBAGENT_DEPTH } from '@builderforce/agent-loop';
import { eq } from 'drizzle-orm';
import { executions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import { BrainService } from '../brain/BrainService';
import { enqueueExecutionMessage, hasPendingPersonSteer } from './executionSteering';
import { composeDispatcherLabel } from './dispatcherLabel';
import { parseOriginatingChatId } from './cloudDispatch';
import { resolveDelegatePersona, type PersonaBriefPort } from './cloudSubagent';
import {
  childHandle,
  childPayload,
  childRowsByHandle,
  isTerminalExecutionStatus,
  liveChildHandles,
  parseCloudChild,
  stopLiveChildren,
  type CloudChildSpec,
} from './cloudChildRuns';
import type { RuntimeService } from './RuntimeService';

/** The owning run — what a child inherits (its ticket, agent, routing and assigned artifacts). */
export interface LiveParentRun {
  executionId: number;
  tenantId: number;
  projectId: number;
  taskId: number;
  taskTitle: string;
  taskDescription: string | null;
  cloudAgentRef?: string;
  agentLabel: string;
  payload?: string;
  artifacts?: ResolvedArtifacts;
}

/** Where a run sits in its tree — the depth it spawns at and the run the tree bills to. */
const treeOf = (parent: LiveParentRun): { depth: number; rootExecutionId: number } => {
  const own = parseCloudChild(parent.payload);
  return { depth: own?.depth ?? 0, rootExecutionId: own?.rootExecutionId ?? parent.executionId };
};

export interface LiveOrchestrationDeps {
  env: Env;
  db: Db;
  runtime: RuntimeService;
  parent: LiveParentRun;
  personaBrief?: PersonaBriefPort;
  /** Keep the parent visibly alive while it waits (the reaper reads its heartbeat). */
  heartbeat(): Promise<void>;
  /** What this owner must do before building on a child's commits, when its working
   *  copy does not read the branch live (an image's local clone). */
  afterChildCommits?: string;
}

/** A wait never holds one durable tick longer than this — the parent can wait again. */
const CLOUD_WAIT_CAP_MS = 5 * 60_000;
const WAIT_POLL_MS = 5_000;

const SPAWNED_NOTE =
  'Running in the background — keep working. Its report arrives as a message when it finishes; address it by handle with wait_agents, message_agent or stop_agent. Finishing waits for it.';

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

export function buildLiveOrchestration(deps: LiveOrchestrationDeps): OrchestrationCapability {
  const { db, runtime, parent } = deps;
  const owner = parent.agentLabel;

  /** Start a child on the durable runner. Returns its error, or null once started. */
  const startOnRunner = async (executionId: number, payload: string): Promise<string | null> => {
    const runner = deps.env.CLOUD_RUNNER;
    if (!runner) return 'the CLOUD_RUNNER binding is not configured';
    const res = await runner.get(runner.idFromName(`exec:${executionId}`)).fetch('https://cloud-runner/start', {
      method: 'POST',
      body: JSON.stringify({
        executionId, tenantId: parent.tenantId, projectId: parent.projectId,
        taskId: parent.taskId, taskTitle: parent.taskTitle, taskDescription: parent.taskDescription,
        cloudAgentRef: parent.cloudAgentRef, agentLabel: parent.agentLabel,
        payload, artifacts: parent.artifacts,
      }),
    }).catch((e: unknown) => ({ ok: false, status: e instanceof Error ? e.message : String(e) }) as const);
    return res.ok ? null : `the cloud runner refused the sub-agent (${res.status})`;
  };

  const tree = treeOf(parent);

  const spawn = async (input: SubagentRequest): Promise<SubagentResult> => {
    if (tree.depth >= MAX_SUBAGENT_DEPTH) return { ok: false, error: `sub-agents nest at most ${MAX_SUBAGENT_DEPTH} deep — do this slice yourself` };
    const who = await resolveDelegatePersona(deps.personaBrief, typeof input.asAgent === 'string' ? input.asAgent.trim() : '', input.role);
    if (!who.ok) return { ok: false, error: who.error };
    const spec = (handle: string): CloudChildSpec => ({
      parentExecutionId: parent.executionId,
      rootExecutionId: tree.rootExecutionId,
      depth: tree.depth + 1,
      handle,
      label: input.label,
      task: input.task,
      ...(input.role ? { role: input.role } : {}),
      ...(who.persona ? { persona: who.persona } : {}),
      ...who.echo,
      ...(input.ticket ? { ticket: input.ticket } : {}),
      owner,
    });
    try {
      const execution = await runtime.submit({
        taskId: parent.taskId,
        tenantId: parent.tenantId,
        submittedBy: composeDispatcherLabel(`execution:${parent.executionId}`, 'subagent'),
        payload: childPayload(parent.payload, spec('')),
        source: 'agent',
      });
      const id = Number(execution.id);
      const handle = childHandle(id);
      const payload = childPayload(parent.payload, spec(handle));
      // The owner pointer, set before the child takes its first step.
      await db.update(executions).set({ parentExecutionId: parent.executionId, payload }).where(scopedToTenant(executions, parent.tenantId, eq(executions.id, id)));
      const refused = await startOnRunner(id, payload);
      if (refused) {
        await runtime.cancel(id, `execution:${parent.executionId}`).catch(() => undefined);
        return { ok: false, error: refused, ...who.echo };
      }
      const note = deps.afterChildCommits ? `${SPAWNED_NOTE} ${deps.afterChildCommits}` : SPAWNED_NOTE;
      return { ok: true, running: true, handle, note, ...who.echo, ...(input.ticket ? { ticket: input.ticket } : {}) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), ...who.echo };
    }
  };

  const live: LiveChildControls = {
    async wait(handles, timeoutMs, signal) {
      const targets = handles.length ? [...handles] : await liveChildHandles(db, parent.tenantId, parent.executionId);
      const deadline = Date.now() + Math.min(timeoutMs, CLOUD_WAIT_CAP_MS);
      let running: string[] = [];
      let finished: string[] = [];
      let interrupted = false;
      for (;;) {
        const rows = await childRowsByHandle(db, parent.tenantId, parent.executionId, targets);
        running = rows.filter((r) => !isTerminalExecutionStatus(r.status)).map((r) => childHandle(r.id));
        finished = rows.filter((r) => isTerminalExecutionStatus(r.status)).map((r) => childHandle(r.id));
        if (!running.length || Date.now() >= deadline || signal?.aborted) break;
        // The person spoke to this run: the wait gives way so the next turn answers them.
        if ((interrupted = await hasPendingPersonSteer(db, parent.tenantId, parent.executionId))) break;
        await deps.heartbeat();
        await sleep(WAIT_POLL_MS, signal);
      }
      const unknown = targets.filter((h) => !running.includes(h) && !finished.includes(h));
      const notes = [
        interrupted ? WAIT_INTERRUPTED_NOTE : '',
        finished.length ? `${finished.join(', ')} finished — their reports arrive as your next message.` : '',
        running.length ? `${running.join(', ')} still running.` : '',
        unknown.length ? `No sub-agent of yours named ${unknown.join(', ')}.` : '',
      ].filter(Boolean);
      // Reports are delivered once, as steers — never also here.
      return { reports: [], running, ...(notes.length ? { note: notes.join(' ') } : {}) };
    },

    async message(handle, text) {
      const [row] = await childRowsByHandle(db, parent.tenantId, parent.executionId, [handle]);
      if (!row) return { ok: false, error: `no sub-agent '${handle}' of yours` };
      if (isTerminalExecutionStatus(row.status)) return { ok: false, error: `${handle} already finished (${row.status}) — spawn a new one for more work` };
      await enqueueExecutionMessage(db, { executionId: row.id, tenantId: parent.tenantId, role: 'user', text: ownerDirectionText(owner, text) });
      // The chat shows the direction, as it does in the editor.
      const chatId = parseOriginatingChatId(parent.payload);
      const spec = parseCloudChild(row.payload);
      if (chatId != null && parent.cloudAgentRef) {
        await new BrainService(db).postExecutionUpdate(chatId, parent.tenantId, {
          agentRef: parent.cloudAgentRef,
          agentName: owner,
          content: `**${owner} → ${spec?.asAgent?.name ?? spec?.label ?? handle}:** ${text.trim()}`,
        }).catch(() => undefined);
      }
      return { ok: true };
    },

    stop: (handles) => stopLiveChildren(db, runtime, parent.tenantId, parent.executionId, `execution:${parent.executionId}`, handles === 'all' ? undefined : handles),
  };

  return { spawn, live };
}


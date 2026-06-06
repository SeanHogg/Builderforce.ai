/**
 * Cloud workflow executor — runs `runtime='cloud'` workflows on the
 * builderforce-hosted runtime, instead of a self-hosted agentHost polling and
 * executing the tasks itself. Invoked from the Worker `scheduled()` handler: it
 * drains ready tasks (dependencies satisfied) for pending/running cloud
 * workflows, executes each by node kind, and advances the workflow's status when
 * its tasks reach a terminal state.
 *
 * Node-kind coverage on cloud:
 *   - trigger / llm / transform / filter / branch / output  → executed natively
 *     (llm via the gateway; the ETL kinds are payload pass-through for now).
 *   - memory / knowledge / train / agent / mcp              → these require an
 *     agentHost agent/tool/SSM runtime that has no cloud equivalent here, so the
 *     task fails with a clear, recorded message (see Gap Register). Run those
 *     workflows on a self-hosted agentHost.
 *
 * A per-tick task budget bounds how much work one cron invocation does; a
 * multi-stage cloud workflow advances across successive ticks.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import { workflows, workflowTasks } from '../../infrastructure/database/schema';
import { ideProxy } from '../llm/LlmProxyService';
import type { ProxyEnv } from '../llm/LlmProxyService';
import type { Db } from '../../infrastructure/database/connection';

export interface CloudExecutorEnv extends ProxyEnv {
  NEON_DATABASE_URL: string;
}

/** Default per-cron-tick budget of tasks to execute across all cloud workflows. */
const DEFAULT_TASK_BUDGET = 50;

type TaskRow = typeof workflowTasks.$inferSelect;
interface NodeInput {
  kind: string;
  config: Record<string, unknown>;
  payload?: unknown;
  triggerSource?: string;
}

/** Substitute `{{input}}` (and `{{ input }}`) in a template with the upstream text. */
export function renderTemplate(template: string, input: string): string {
  return template.replace(/\{\{\s*input\s*\}\}/g, input);
}

function parseInput(raw: string | null): NodeInput {
  if (!raw) return { kind: 'unknown', config: {} };
  try {
    const v = JSON.parse(raw) as Partial<NodeInput>;
    return { kind: String(v.kind ?? 'unknown'), config: (v.config as Record<string, unknown>) ?? {}, payload: v.payload, triggerSource: v.triggerSource };
  } catch {
    return { kind: 'unknown', config: {} };
  }
}

/** Run one cloud-native node; returns its output text or throws on failure. */
async function executeCloudNode(env: CloudExecutorEnv, node: NodeInput, inputText: string): Promise<string> {
  switch (node.kind) {
    case 'trigger':
      return node.payload !== undefined ? JSON.stringify(node.payload) : inputText;

    case 'llm': {
      const cfg = node.config;
      const system = typeof cfg.system === 'string' ? cfg.system : '';
      const prompt = typeof cfg.prompt === 'string' ? cfg.prompt : '';
      const messages = [
        ...(system ? [{ role: 'system' as const, content: renderTemplate(system, inputText) }] : []),
        { role: 'user' as const, content: renderTemplate(prompt || '{{input}}', inputText) },
      ];
      const proxy = ideProxy(env);
      const result = await proxy.complete({
        model: typeof cfg.model === 'string' ? cfg.model : undefined,
        messages,
        ...(typeof cfg.temperature === 'number' ? { temperature: cfg.temperature } : {}),
      });
      if (!result.response.ok) {
        throw new Error(`llm call failed (${result.response.status})`);
      }
      const json = (await result.response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return json.choices?.[0]?.message?.content ?? '';
    }

    // ETL kinds: pass the payload through. Expression/predicate evaluation is not
    // yet implemented cloud-side (recorded in the Gap Register).
    case 'transform':
    case 'filter':
    case 'branch':
    case 'output':
      return inputText;

    default:
      throw new Error(
        `node kind "${node.kind}" is not supported on the cloud runtime — run this workflow on a self-hosted agentHost`,
      );
  }
}

/** All dependency task ids parsed from a task's stored dependsOn JSON. */
function depIds(task: TaskRow): string[] {
  if (!task.dependsOn) return [];
  try {
    const v = JSON.parse(task.dependsOn) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Drain ready tasks for one cloud workflow; returns how many tasks it executed. */
async function advanceCloudWorkflow(env: CloudExecutorEnv, db: Db, workflowId: string, budget: number): Promise<number> {
  const tasks = await db.select().from(workflowTasks).where(eq(workflowTasks.workflowId, workflowId));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const outputs = new Map<string, string>(tasks.filter((t) => t.status === 'completed').map((t) => [t.id, t.output ?? '']));

  let processed = 0;
  let madeProgress = true;
  while (madeProgress && processed < budget) {
    madeProgress = false;
    for (const task of tasks) {
      if (processed >= budget) break;
      if (task.status !== 'pending') continue;

      const deps = depIds(task);
      const depTasks = deps.map((id) => byId.get(id)).filter(Boolean) as TaskRow[];
      if (depTasks.some((d) => d.status === 'failed' || d.status === 'cancelled')) {
        // Upstream failed → fail this task without executing.
        task.status = 'failed';
        task.error = 'upstream task failed';
        await db
          .update(workflowTasks)
          .set({ status: 'failed', error: task.error, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(workflowTasks.id, task.id));
        madeProgress = true;
        continue;
      }
      if (!depTasks.every((d) => d.status === 'completed')) continue; // deps not ready yet

      const node = parseInput(task.input);
      const inputText = deps.map((id) => outputs.get(id) ?? '').filter(Boolean).join('\n\n');
      const now = new Date();
      await db.update(workflowTasks).set({ status: 'running', startedAt: now, updatedAt: now }).where(eq(workflowTasks.id, task.id));

      try {
        const output = await executeCloudNode(env, node, inputText);
        task.status = 'completed';
        outputs.set(task.id, output);
        await db
          .update(workflowTasks)
          .set({ status: 'completed', output, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(workflowTasks.id, task.id));
      } catch (e) {
        task.status = 'failed';
        task.error = e instanceof Error ? e.message : 'execution failed';
        await db
          .update(workflowTasks)
          .set({ status: 'failed', error: task.error, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(workflowTasks.id, task.id));
      }
      processed++;
      madeProgress = true;
    }
  }

  // Recompute the workflow status from its tasks.
  const fresh = await db.select({ status: workflowTasks.status }).from(workflowTasks).where(eq(workflowTasks.workflowId, workflowId));
  const anyPendingOrRunning = fresh.some((t) => t.status === 'pending' || t.status === 'running');
  const anyFailed = fresh.some((t) => t.status === 'failed');
  const next = anyPendingOrRunning ? 'running' : anyFailed ? 'failed' : 'completed';
  await db
    .update(workflows)
    .set({ status: next, ...(next === 'completed' || next === 'failed' ? { completedAt: new Date() } : {}), updatedAt: new Date() })
    .where(eq(workflows.id, workflowId));

  return processed;
}

export interface CloudExecResult {
  workflows: number;
  tasks: number;
}

/** Advance all pending/running cloud workflows within the per-tick task budget. */
export async function processPendingCloudWorkflows(env: CloudExecutorEnv, budget = DEFAULT_TASK_BUDGET): Promise<CloudExecResult> {
  const db = buildDatabase(env as unknown as Parameters<typeof buildDatabase>[0]);

  const cloud = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.runtime, 'cloud'), inArray(workflows.status, ['pending', 'running'])))
    .limit(100);

  let remaining = budget;
  let touched = 0;
  for (const wf of cloud) {
    if (remaining <= 0) break;
    const did = await advanceCloudWorkflow(env, db, wf.id, remaining);
    if (did > 0) touched++;
    remaining -= did;
  }

  console.log(`[cron:cloud-exec] workflows=${cloud.length} advanced=${touched} tasks=${budget - remaining}`);
  return { workflows: cloud.length, tasks: budget - remaining };
}

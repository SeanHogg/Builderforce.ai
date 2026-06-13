/**
 * Cloud workflow executor — runs `runtime='cloud'` workflows on the
 * builderforce-hosted runtime, instead of a self-hosted agentHost polling and
 * executing the tasks itself. Invoked from the Worker `scheduled()` handler: it
 * drains ready tasks (dependencies satisfied) for pending/running cloud
 * workflows, executes each by node kind, and advances the workflow's status when
 * its tasks reach a terminal state.
 *
 * Node-kind coverage on cloud:
 *   - trigger / llm / transform / filter / branch / output  → executed natively.
 *     llm runs via the gateway; the ETL kinds (transform/filter/branch) are
 *     evaluated by the sandbox-safe expression engine in `domain/workflowExpr`
 *     (an empty expression is a pass-through, so legacy workflows are unaffected).
 *     A `filter` whose predicate is false prunes its whole downstream cone: the
 *     node is marked `cancelled` and `dispositionFromDeps` cascades the cancel to
 *     every dependent (a prune is a skip, not a failure — the workflow can still
 *     end `completed`).
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
import { recordProxyUsage } from '../llm/usageLedger';
import { contextFromInput, evaluateBool, renderTransform } from '../../domain/workflowExpr';
import type { ProxyEnv } from '../llm/LlmProxyService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

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

/** The outcome of running one cloud node. `drop` (filter only) means the node's
 *  predicate rejected the payload, so this path should be pruned downstream. */
interface NodeResult {
  output: string;
  drop?: boolean;
}

/** Run one cloud-native node; returns its output (and a drop flag) or throws on failure.
 *  `usageCtx` (when known) lets the `llm` node record its spend in the ledger [1310]. */
async function executeCloudNode(env: CloudExecutorEnv, node: NodeInput, inputText: string, usageCtx?: { db: Db; tenantId: number }): Promise<NodeResult> {
  switch (node.kind) {
    case 'trigger':
      return { output: node.payload !== undefined ? JSON.stringify(node.payload) : inputText };

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
      if (usageCtx) {
        void recordProxyUsage(usageCtx.db, env as unknown as Env, {
          tenantId: usageCtx.tenantId, useCase: 'workflow_llm_node', result,
        });
      }
      if (!result.response.ok) {
        throw new Error(`llm call failed (${result.response.status})`);
      }
      const json = (await result.response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return { output: json.choices?.[0]?.message?.content ?? '' };
    }

    // ETL kinds — evaluated cloud-side via the sandbox-safe expression engine
    // (no eval/Function). An empty expression is a pass-through, so existing
    // workflows are unaffected.
    case 'transform': {
      const ctx = contextFromInput(inputText);
      return { output: renderTransform(typeof node.config.expression === 'string' ? node.config.expression : '', inputText, ctx) };
    }
    case 'filter': {
      const ctx = contextFromInput(inputText);
      const predicate = typeof node.config.predicate === 'string' ? node.config.predicate : '';
      // Predicate holds → forward the payload; fails → drop it, which prunes the
      // whole downstream cone of this filter (the drain loop cancels dependents
      // of a dropped node — see `dispositionFromDeps`).
      return evaluateBool(predicate, ctx) ? { output: inputText } : { output: '', drop: true };
    }
    case 'branch': {
      // Evaluate the condition and tag the payload with the taken branch so a
      // downstream node can read `$branch`. Selective edge pruning (running only
      // the taken side) needs labeled edges (tracked in the Gap Register); until
      // then both sides run, but each can read `$branch` to self-gate.
      const ctx = contextFromInput(inputText);
      const condition = typeof node.config.condition === 'string' ? node.config.condition : '';
      const taken = condition ? evaluateBool(condition, ctx) : true;
      try {
        const parsed = JSON.parse(inputText || '{}') as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { output: JSON.stringify({ ...parsed, $branch: taken }) };
        }
      } catch {
        /* non-JSON payload — fall through to passthrough */
      }
      return { output: inputText };
    }
    case 'output':
      return { output: inputText };

    default:
      throw new Error(
        `node kind "${node.kind}" is not supported on the cloud runtime — run this workflow on a self-hosted agentHost`,
      );
  }
}

/**
 * Decide what to do with a pending task given the statuses of its dependencies.
 * Pure + exported so the prune/cascade semantics are unit-tested without a DB:
 *   - any dep `failed`    → `fail`   (a real error upstream propagates as failure)
 *   - else any `cancelled`→ `cancel` (an upstream filter pruned this path — skip,
 *                                     NOT a failure; cascades through joins too)
 *   - else all `completed`→ `run`
 *   - otherwise           → `wait`   (deps still pending/running)
 * A task with no dependencies → `run` (roots start immediately).
 */
export type DepDisposition = 'run' | 'wait' | 'fail' | 'cancel';
export function dispositionFromDeps(depStatuses: string[]): DepDisposition {
  if (depStatuses.some((s) => s === 'failed')) return 'fail';
  if (depStatuses.some((s) => s === 'cancelled')) return 'cancel';
  if (depStatuses.every((s) => s === 'completed')) return 'run';
  return 'wait';
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
  // The workflow's tenant — lets each `llm` node record its spend in the ledger [1310].
  const [wf] = await db.select({ tenantId: workflows.tenantId }).from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  const usageCtx = wf?.tenantId != null ? { db, tenantId: wf.tenantId } : undefined;
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
      const disposition = dispositionFromDeps(depTasks.map((d) => d.status));
      if (disposition === 'wait') continue; // deps not ready yet
      if (disposition === 'fail' || disposition === 'cancel') {
        // `fail`: a real upstream error. `cancel`: an upstream filter pruned this
        // path — skip without executing (not a failure). Either way it cascades
        // to this task's own dependents on the next pass.
        const status = disposition === 'fail' ? 'failed' : 'cancelled';
        task.status = status;
        task.error = disposition === 'fail' ? 'upstream task failed' : 'skipped — upstream filtered out';
        await db
          .update(workflowTasks)
          .set({ status, error: task.error, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(workflowTasks.id, task.id));
        madeProgress = true;
        continue;
      }

      const node = parseInput(task.input);
      const inputText = deps.map((id) => outputs.get(id) ?? '').filter(Boolean).join('\n\n');
      const now = new Date();
      await db.update(workflowTasks).set({ status: 'running', startedAt: now, updatedAt: now }).where(eq(workflowTasks.id, task.id));

      try {
        const { output, drop } = await executeCloudNode(env, node, inputText, usageCtx);
        if (drop) {
          // Filter predicate rejected the payload → mark this node `cancelled` so
          // its downstream cone is pruned (cascades via `dispositionFromDeps`).
          task.status = 'cancelled';
          await db
            .update(workflowTasks)
            .set({ status: 'cancelled', output: '', error: 'filtered out (predicate false)', completedAt: new Date(), updatedAt: new Date() })
            .where(eq(workflowTasks.id, task.id));
        } else {
          task.status = 'completed';
          outputs.set(task.id, output);
          await db
            .update(workflowTasks)
            .set({ status: 'completed', output, completedAt: new Date(), updatedAt: new Date() })
            .where(eq(workflowTasks.id, task.id));
        }
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

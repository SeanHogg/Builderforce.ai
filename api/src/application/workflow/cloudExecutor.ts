import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Cloud workflow executor — runs `runtime='cloud'` workflows on the
 * builderforce-hosted runtime, instead of a self-hosted agentHost polling and
 * executing the tasks itself. Invoked from the Worker `scheduled()` handler: it
 * drains ready tasks (dependencies satisfied) for pending/running cloud
 * workflows, executes each by node kind, and advances the workflow's status when
 * its tasks reach a terminal state.
 *
 * Each kind is a handler in `NODE_HANDLERS`, merged from one table per family in
 * `./nodes/` — transform.ts, control.ts, ai.ts, io.ts.
 *
 * Node-kind coverage on cloud:
 *   - trigger / llm / transform / filter / branch / output / gmail → executed natively.
 *     gmail sends through the tenant's connected Gmail integration (googleOAuth).
 *     llm runs via the gateway; the ETL kinds (transform/filter/branch) are
 *     evaluated by the sandbox-safe expression engine in `domain/workflowExpr`
 *     (an empty expression is a pass-through, so legacy workflows are unaffected).
 *     A `filter` whose predicate is false prunes its whole downstream cone: the
 *     node is marked `cancelled` and `dispositionFromDeps` cascades the cancel to
 *     every dependent (a prune is a skip, not a failure — the workflow can still
 *     end `completed`).
 *   - connector → executed natively. The ONE node kind through which every
 *     connector action (Twilio, SendGrid, Slack, Stripe, a tenant's own) is
 *     reachable from a workflow; it delegates to `executeConnectorAction`, so a
 *     workflow's outbound call gets the same SSRF guard, credential handling and
 *     audit log an agent's does.
 *   - mcp → executed natively (0412). The Data + Marketing palette integrations
 *     all compile to this kind; the node resolves the tenant's stored credential
 *     and calls the provider through the shared catalog, so the connect form's
 *     "Test connection" and the running node issue the same request. Providers
 *     whose wire protocol a Worker cannot speak (MySQL/Mongo/Redis/Snowflake)
 *     fail with that specific reason rather than a generic refusal.
 *   - memory / knowledge / train / agent                    → these require an
 *     agentHost agent/tool/SSM runtime that has no cloud equivalent here, so the
 *     task fails with a clear, recorded message (see Gap Register). Run those
 *     workflows on a self-hosted agentHost.
 *   - web-search → executed natively (AI Agents). With a tenant in scope, goes
 *     through the SAME owned-index-first `searchOwnedThenDiscover` the cloud
 *     agent's own `web_search` tool uses (tenant Tavily/Ollama/Exa/Linkup key →
 *     operator key → SearXNG → keyless Wikipedia, only as a discovery fallback),
 *     so a workflow's research also builds the tenant's index. A tenant-less
 *     preview run falls back to a vendor-only call, so it never refuses for
 *     lack of a connected integration either way.
 *   - web-fetch → executed natively (Tools). Reuses the Brain's own
 *     SSRF-guarded, cached `fetchWebDocumentCached` — no credential needed.
 *     Replaces the old "Fetch" palette entry, which was `kind: 'trigger'`
 *     (inert when chained mid-flow — see DONE.md 2026-08-16).
 *   - google-drive → executed natively. Same tenant-credential path as `gmail`
 *     (provider='google_drive'); search or read-as-text. Replaces the old
 *     "Google Drive" palette entry (same `kind: 'trigger'` defect as Fetch).
 *   - analyze-image / extract-document-data → executed natively (AI Agents).
 *     Both are a vision-capable `proxy.complete()` turn (see
 *     `completeVisionPrompt`) — an image URL + a prompt, auto-routed to a
 *     vision-capable model by the SAME `poolRouting.ts` shape detection the
 *     Brain's own image turns use. `extract-document-data` differs only in
 *     its system prompt (structured JSON extraction) — Make's document/
 *     invoice/receipt "Content Extractor" modules are this same capability,
 *     not a distinct one.
 *   - transcribe-audio → executed natively (AI Agents). A real Whisper
 *     `/v1/audio/transcriptions` or `/translations` multipart call (operator-
 *     funded `OPENAI_API_KEY`, no per-tenant BYO path yet) — genuinely
 *     different transport from every chat-completion kind above, so it does
 *     NOT go through `proxy.complete()`.
 *   - router / switch / merge / numeric-aggregator / table-aggregator /
 *     text-aggregator / set-variable / get-variable / set-variables /
 *     get-variables / increment / sleep / compose-string / convert-encoding /
 *     regex-match / html-to-text / html-table / html-elements /
 *     match-elements / match-pattern-advanced / replace / chunk-text / assert
 *     / healthcheck → executed natively (Flow Control / Tools / Text Parser /
 *     Diagnostics). `router`/`switch` generalize `branch`'s `$branch`-tag
 *     mechanism to N named routes (`$route`), by condition or by literal value
 *     respectively; `merge`/the three `*-aggregator` kinds all read the raw
 *     per-dependency outputs off `node.depOutputs`, populated by the drain
 *     loop below rather than the pre-joined `inputText`. The `*-variable(s)`
 *     kinds read/write `workflowVariables.ts`'s KV store. `sleep` is gated in
 *     `advanceCloudWorkflow` via `workflow_tasks.not_before` — by the time its
 *     handler runs, the delay has already elapsed.
 *
 * A per-tick task budget bounds how much work one cron invocation does; a
 * multi-stage cloud workflow advances across successive ticks.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import { workflows, workflowTasks } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { NodeHandler, NodeHandlerTable, NodeInput, NodeResult, OutboundPort, UsageContext } from './nodes/types';
import { TRANSFORM_NODE_HANDLERS } from './nodes/transform';
import { CONTROL_NODE_HANDLERS } from './nodes/control';
import { AI_NODE_HANDLERS } from './nodes/ai';
import { IO_NODE_HANDLERS } from './nodes/io';

/** Default per-cron-tick budget of tasks to execute across all cloud workflows. */
const DEFAULT_TASK_BUDGET = 50;

type TaskRow = typeof workflowTasks.$inferSelect;

function parseInput(raw: string | null): NodeInput {
  if (!raw) return { kind: 'unknown', config: {} };
  try {
    const v = JSON.parse(raw) as Partial<NodeInput>;
    return {
      kind: String(v.kind ?? 'unknown'),
      config: (v.config as Record<string, unknown>) ?? {},
      payload: v.payload,
      triggerSource: v.triggerSource,
      ...(v.depLabels && typeof v.depLabels === 'object' ? { depLabels: v.depLabels as Record<string, string> } : {}),
    };
  } catch {
    return { kind: 'unknown', config: {} };
  }
}

/** Merge the per-family tables; a kind claimed by two families fails at module load
 *  rather than one silently shadowing the other. */
function mergeHandlerTables(...tables: NodeHandlerTable[]): ReadonlyMap<string, NodeHandler> {
  const merged = new Map<string, NodeHandler>();
  for (const table of tables) {
    for (const [kind, handler] of Object.entries(table)) {
      if (merged.has(kind)) throw new Error(`workflow node kind "${kind}" is registered twice`);
      merged.set(kind, handler);
    }
  }
  return merged;
}

/**
 * NODE_HANDLERS — node kind → handler, the ONE dispatch table for cloud nodes.
 * A `Map` (not an object lookup) so a kind like `constructor` or `__proto__`
 * resolves to nothing and takes the unsupported-kind path, exactly as the old
 * `switch`'s `default` did.
 */
export const NODE_HANDLERS: ReadonlyMap<string, NodeHandler> = mergeHandlerTables(
  TRANSFORM_NODE_HANDLERS,
  CONTROL_NODE_HANDLERS,
  AI_NODE_HANDLERS,
  IO_NODE_HANDLERS,
);

/** Run one cloud-native node; returns its output (and a drop flag) or throws on failure.
 *  `usageCtx` (when known) lets the `llm` node record its spend in the ledger [1310].
 *  `outbound` (when supplied) intercepts the node kinds that leave this workspace —
 *  see {@link OutboundPort}. Omitted, every live caller today, this is a no-op: the
 *  real adapters run exactly as they always have. */
export async function executeCloudNode(
  env: Env,
  node: NodeInput,
  inputText: string,
  usageCtx?: UsageContext,
  outbound?: OutboundPort,
): Promise<NodeResult> {
  const handler = NODE_HANDLERS.get(node.kind);
  if (!handler) {
    throw new Error(
      `node kind "${node.kind}" is not supported on the cloud runtime — run this workflow on a self-hosted agentHost`,
    );
  }
  return handler({ env, node, inputText, usageCtx, outbound });
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
/**
 * Which OUTLET a completed node took, read back out of its own output.
 *
 * `branch` tags its payload `$branch: true|false` and `router` tags
 * `$route: <name>`; both already did so, and both were readable only by a
 * downstream `filter` the author had to remember to add. This is the same tag,
 * read by the ENGINE, which is what turns a labeled edge into a real fork.
 *
 * Returns null for a node that tagged nothing — a plain step whose edge somebody
 * labelled anyway. Null never prunes: inventing an outlet for a node that has
 * none would silently delete half a workflow that used to run.
 */
export function outletTaken(output: string): string | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (typeof parsed.$route === 'string') return parsed.$route;
    if (typeof parsed.$branch === 'boolean') return parsed.$branch ? 'true' : 'false';
    return null;
  } catch {
    return null;
  }
}

/**
 * Should this task be pruned because a LABELED dependency took a different outlet?
 *
 * Only labeled dependencies are consulted, and only completed ones: an unlabeled
 * edge is unconditional and a dependency that has not finished is handled by
 * `dispositionFromDeps` first. A labeled dep whose node emitted no outlet tag is
 * treated as a match — the alternative is deleting a path because somebody
 * labelled an edge leaving a node that does not branch.
 */
export function prunedByEdgeLabel(
  depLabels: Record<string, string> | undefined,
  deps: Array<{ id: string; status: string; output: string }>,
): boolean {
  if (!depLabels) return false;
  return deps.some((dep) => {
    const expected = depLabels[dep.id];
    if (!expected || dep.status !== 'completed') return false;
    const taken = outletTaken(dep.output);
    return taken != null && taken !== expected;
  });
}

export function dispositionFromDeps(depStatuses: string[]): DepDisposition {
  if (depStatuses.some((s) => s === 'failed')) return 'fail';
  if (depStatuses.some((s) => s === 'cancelled')) return 'cancel';
  if (depStatuses.every((s) => s === 'completed')) return 'run';
  return 'wait';
}

/**
 * A node's configured error-handling policy — Make's five Flow Control error
 * handlers (Skip/Resume/Break/Commit/Rollback), adapted to what this engine can
 * actually do. `config.onError` is a plain string field on ANY node kind
 * (rendered generically by `NodeConfigPanel.tsx`, not per-kind), read here
 * rather than in `executeCloudNode` because the decision belongs to the
 * CALLER — the node itself doesn't know it failed until after it threw.
 *
 * What maps and what doesn't, honestly:
 *   - Ignore  → `ignore`: the task COMPLETES with empty output; downstream runs
 *     normally, exactly like Make's own semantics.
 *   - Resume  → `resume`: same, but with `config.onErrorValue` as the output —
 *     also a faithful match.
 *   - Break   → `stop-branch`: the task is `cancelled` (not `failed`), which
 *     `dispositionFromDeps` prunes only THIS node's downstream cone — sibling
 *     branches and the rest of the run are unaffected. Make's own Break ALSO
 *     re-queues the run for an automatic retry later (exponential backoff);
 *     there is no such retry-later scheduler here, so this is Break minus the
 *     retry.
 *   - Commit / Rollback → NOT implemented. Both require per-node compensating
 *     "undo" actions (Rollback) or a notion of a still-open transaction to
 *     close early (Commit) — neither exists for `mcp`/`connector`/`gmail`/etc.
 *     here (each node calls its target directly, no compensating action is
 *     recorded). Faking either would silently claim a guarantee the engine
 *     cannot back up. `fail-task` (the default, unchanged prior behavior)
 *     covers "stop and report failure," which is the closest honest fallback.
 */
export type NodeErrorPolicy = 'fail-task' | 'ignore' | 'resume' | 'stop-branch';

export interface ErrorHandlingOutcome {
  status: 'failed' | 'completed' | 'cancelled';
  output: string;
  error: string;
}

function errorPolicyOf(config: Record<string, unknown>): NodeErrorPolicy {
  const raw = config.onError;
  return raw === 'ignore' || raw === 'resume' || raw === 'stop-branch' ? raw : 'fail-task';
}

/** Pure — no DB — so it's unit-testable independent of `advanceCloudWorkflow`'s
 *  DB orchestration. Decides a failed task's terminal state per its policy. */
export function applyErrorHandler(config: Record<string, unknown>, error: unknown): ErrorHandlingOutcome {
  const message = error instanceof Error ? error.message : 'execution failed';
  const policy = errorPolicyOf(config);
  if (policy === 'ignore') {
    return { status: 'completed', output: '', error: `error handled (ignore): ${message}` };
  }
  if (policy === 'resume') {
    const output = typeof config.onErrorValue === 'string' ? config.onErrorValue : '';
    return { status: 'completed', output, error: `error handled (resume): ${message}` };
  }
  if (policy === 'stop-branch') {
    return { status: 'cancelled', output: '', error: `error handled (stop-branch): ${message}` };
  }
  return { status: 'failed', output: '', error: message };
}

export interface IteratorTaskRef {
  id: string;
  input: string | null;
  agentRole: string;
  description: string;
  dependsOn: string | null;
}

export interface IteratorNewTask {
  id: string;
  agentRole: string;
  description: string;
  input: string;
  dependsOn: string;
}

export interface IteratorExpansionPlan {
  newTasks: IteratorNewTask[];
  /** Existing task id → its rewritten `dependsOn` (JSON string). */
  rewire: Record<string, string>;
}

function parseDependsOn(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Make's Iterator, adapted to a task graph that is normally COMPILED once and
 * fixed: fork the processor node(s) directly downstream of an Iterator task
 * into one clone per array item, each fed its own item via a synthetic
 * "carrier" task (`kind: 'trigger'`, `payload: item` — the existing trigger
 * passthrough already does exactly "output this fixed value", reused rather
 * than inventing a second mechanism). Any EXISTING task that already fanned in
 * from a (now-cloned) processor — `merge` or a `*-aggregator` kind, which read
 * `depOutputs` off ALL of `dependsOn` — has its `dependsOn` widened to every
 * clone. That widening is Make's Aggregator, similarly adapted: no new
 * aggregator kind is needed, the existing fan-in kinds already do the
 * collecting once they see every clone.
 *
 * Bounded scope, stated honestly: only nodes whose `dependsOn` is EXACTLY
 * `[iteratorTaskId]` are treated as processors — a multi-node chain between
 * Iterator and its aggregator is not walked or cloned. This is what keeps the
 * expansion a single, static, idempotent operation (triggered exactly once,
 * at the moment the Iterator task itself completes — see
 * `advanceCloudWorkflow`) instead of a general graph-rewriting engine. Chain
 * more than one step per item by putting a `merge`/`*-aggregator` node
 * directly after the one processor and continuing from there.
 *
 * Pure — no DB — so the graph-mutation logic is unit-testable independent of
 * `advanceCloudWorkflow`'s DB orchestration, which only applies whatever this
 * returns (insert `newTasks`, then `UPDATE ... SET depends_on` per `rewire`).
 */
export function planIteratorExpansion(
  iteratorTaskId: string,
  items: readonly unknown[],
  tasks: readonly IteratorTaskRef[],
  newId: () => string,
): IteratorExpansionPlan | null {
  const processors = tasks.filter((t) => {
    const deps = parseDependsOn(t.dependsOn);
    return deps.length === 1 && deps[0] === iteratorTaskId;
  });
  if (processors.length === 0 || items.length === 0) return null;

  const newTasks: IteratorNewTask[] = [];
  const rewire: Record<string, string> = {};
  // One clone-id list per processor, collected across all items — a processor
  // may feed more than one downstream fan-in node, and each needs the SAME
  // full list.
  const cloneIdsByProcessor = new Map<string, string[]>();

  for (const processor of processors) {
    const cloneIds: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const carrierId = newId();
      newTasks.push({
        id: carrierId,
        agentRole: 'node:trigger',
        description: `Iterator item ${i + 1}/${items.length}`,
        input: JSON.stringify({ kind: 'trigger', config: {}, payload: items[i] }),
        dependsOn: JSON.stringify([]),
      });
      if (i === 0) {
        // Reuse the ALREADY-COMPILED processor task for item 0 — just rewire
        // it off the iterator and onto item 0's carrier.
        cloneIds.push(processor.id);
        rewire[processor.id] = JSON.stringify([carrierId]);
      } else {
        const cloneId = newId();
        cloneIds.push(cloneId);
        newTasks.push({
          id: cloneId,
          agentRole: processor.agentRole,
          description: processor.description,
          input: processor.input ?? '',
          dependsOn: JSON.stringify([carrierId]),
        });
      }
    }
    cloneIdsByProcessor.set(processor.id, cloneIds);
  }

  for (const t of tasks) {
    const deps = parseDependsOn(t.dependsOn);
    let changed = false;
    const widened = deps.flatMap((depId) => {
      const clones = cloneIdsByProcessor.get(depId);
      if (!clones) return [depId];
      changed = true;
      return clones;
    });
    if (changed) rewire[t.id] = JSON.stringify(widened);
  }

  return { newTasks, rewire };
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
async function advanceCloudWorkflow(env: Env, db: Db, workflowId: string, budget: number): Promise<number> {
  // The workflow's tenant — lets each `llm` node record its spend in the ledger
  // [1310], and (new) lets set-variable/get-variable/increment scope their state.
  const [wf] = await db
    .select({ tenantId: workflows.tenantId, workflowDefinitionId: workflows.workflowDefinitionId })
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1);
  const usageCtx: UsageContext | undefined = wf?.tenantId != null
    ? { db, tenantId: wf.tenantId, workflowId, workflowDefinitionId: wf.workflowDefinitionId ?? null }
    : undefined;
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

      // A LABELED edge that was not taken prunes this arm. `branch` and `router`
      // already tagged their payload with the outlet; until this read it, BOTH
      // sides of a branch ran and each downstream node had to self-gate on the
      // tag with a hand-authored `filter` — so a workflow that plainly read
      // "if paid → charge, else → email" charged AND emailed.
      //
      // Pruned as `cancelled`, not `failed`: an untaken arm is a path the author
      // asked not to run, and it cascades to that arm's own dependents through
      // `dispositionFromDeps` exactly as a filter drop does. The run can still
      // end `completed`, which is the whole point.
      if (prunedByEdgeLabel(node.depLabels, depTasks.map((d) => ({ id: d.id, status: d.status, output: d.output ?? '' })))) {
        task.status = 'cancelled';
        task.error = 'skipped — this branch was not taken';
        await db
          .update(workflowTasks)
          .set({ status: 'cancelled', output: '', error: task.error, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(workflowTasks.id, task.id));
        madeProgress = true;
        continue;
      }

      // `sleep` gate: deps are satisfied, but the node itself holds this task
      // pending until its delay elapses. First visit (no `notBefore` armed yet)
      // arms the timer and defers without executing or counting as progress —
      // ONLY this task's own timer is checked; downstream tasks wait on `sleep`'s
      // `status` the normal way, so nothing else needs to know about `not_before`.
      if (node.kind === 'sleep') {
        if (!task.notBefore) {
          const seconds = Math.max(0, Number(node.config.seconds) || 0);
          const notBefore = new Date(Date.now() + seconds * 1000);
          task.notBefore = notBefore;
          await db.update(workflowTasks).set({ notBefore, updatedAt: new Date() }).where(eq(workflowTasks.id, task.id));
          continue;
        }
        if (task.notBefore.getTime() > Date.now()) continue;
      }

      const depOutputsArr = deps.map((id) => outputs.get(id) ?? '');
      const inputText = depOutputsArr.filter(Boolean).join('\n\n');
      const now = new Date();
      await db.update(workflowTasks).set({ status: 'running', startedAt: now, updatedAt: now }).where(eq(workflowTasks.id, task.id));

      try {
        const { output, drop } = await executeCloudNode(env, { ...node, depOutputs: depOutputsArr }, inputText, usageCtx);
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

          // Iterator fan-out — triggered exactly once, right here, at the
          // moment the Iterator task itself completes (see
          // `planIteratorExpansion`'s docstring for the mechanism + its
          // bounded scope). A no-op for every other node kind.
          if (node.kind === 'iterator') {
            let items: unknown[] = [];
            try {
              const parsed = JSON.parse(output) as unknown;
              if (Array.isArray(parsed)) items = parsed;
            } catch (error) {
              reportCaughtError(error, { source: 'application/workflow/cloudExecutor.ts', operation: 'iterator.expand.parseOutput', level: 'warning' });
            }
            const plan = items.length > 0 ? planIteratorExpansion(task.id, items, tasks, () => crypto.randomUUID()) : null;
            if (plan) {
              const mutatedAt = new Date();
              if (plan.newTasks.length > 0) {
                await db.insert(workflowTasks).values(plan.newTasks.map((nt) => ({
                  id: nt.id, workflowId, agentRole: nt.agentRole, description: nt.description,
                  input: nt.input, dependsOn: nt.dependsOn, status: 'pending' as const,
                  createdAt: mutatedAt, updatedAt: mutatedAt,
                })));
              }
              for (const [id, dependsOn] of Object.entries(plan.rewire)) {
                await db.update(workflowTasks).set({ dependsOn, updatedAt: mutatedAt }).where(eq(workflowTasks.id, id));
              }
              // Reflect the mutation in THIS tick's in-memory view so the loop
              // below sees the new/rewired tasks without a fresh SELECT.
              for (const nt of plan.newTasks) {
                const row: TaskRow = {
                  id: nt.id, workflowId, agentRole: nt.agentRole, description: nt.description,
                  status: 'pending', input: nt.input, output: null, error: null,
                  dependsOn: nt.dependsOn, notBefore: null, startedAt: null, completedAt: null,
                  createdAt: mutatedAt, updatedAt: mutatedAt,
                };
                tasks.push(row);
                byId.set(nt.id, row);
              }
              for (const [id, dependsOn] of Object.entries(plan.rewire)) {
                const existing = byId.get(id);
                if (existing) existing.dependsOn = dependsOn;
              }
              madeProgress = true;
            }
          }
        }
      } catch (e) {
        // Per-node `config.onError` policy (Ignore/Resume/Break, adapted — see
        // `applyErrorHandler`'s docstring) decides the task's terminal state,
        // not always `failed` the way it used to be unconditionally.
        const outcome = applyErrorHandler(node.config, e);
        task.status = outcome.status;
        task.error = outcome.error;
        const patch: Record<string, unknown> = {
          status: outcome.status, error: outcome.error, completedAt: new Date(), updatedAt: new Date(),
        };
        if (outcome.status === 'completed') {
          outputs.set(task.id, outcome.output);
          patch.output = outcome.output;
        }
        await db.update(workflowTasks).set(patch).where(eq(workflowTasks.id, task.id));
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
export async function processPendingCloudWorkflows(env: Env, budget = DEFAULT_TASK_BUDGET): Promise<CloudExecResult> {
  const db = buildDatabase(env);

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

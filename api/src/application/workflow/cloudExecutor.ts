import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Cloud workflow executor — runs `runtime='cloud'` workflows on the
 * builderforce-hosted runtime, instead of a self-hosted agentHost polling and
 * executing the tasks itself. Invoked from the Worker `scheduled()` handler: it
 * drains ready tasks (dependencies satisfied) for pending/running cloud
 * workflows, executes each by node kind, and advances the workflow's status when
 * its tasks reach a terminal state.
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
 *   - router / merge / set-variable / get-variable / increment / sleep /
 *     regex-match / html-to-text / assert / healthcheck → executed natively
 *     (Flow Control / Tools / Text Parser / Diagnostics). `router` generalizes
 *     `branch`'s `$branch`-tag mechanism to N named routes (`$route`); `merge`
 *     reads the raw per-dependency outputs off `node.depOutputs`, populated by
 *     the drain loop below rather than the pre-joined `inputText`. `set-variable`
 *     / `get-variable` / `increment` read/write `workflowVariables.ts`'s KV
 *     store. `sleep` is gated in `advanceCloudWorkflow` via `workflow_tasks
 *     .not_before` — by the time its `case` runs, the delay has already elapsed.
 *
 * A per-tick task budget bounds how much work one cron invocation does; a
 * multi-stage cloud workflow advances across successive ticks.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import { workflows, workflowTasks } from '../../infrastructure/database/schema';
import { ideProxy, readProxyChoice } from '../llm/LlmProxyService';
import { loadGoogleCredential } from '../integrations/googleCredential';
import { sendGmail } from '../integrations/googleOAuth';
import { tenantProxyForPlan, byoAwareModel } from '../llm/tenantProxy';
import { recordProxyUsage } from '../llm/usageLedger';
import { contextFromInput, evaluateBool, renderTransform } from '../../domain/workflowExpr';
import { regexMatch, htmlToText } from '../../domain/workflowTextTools';
import { credentialSecret } from '../integrations/credentialCrypto';
import { executeMcpNode, type McpNodeConfig } from './mcpNode';
import { executeConnectorNode, type ConnectorNodeConfig } from './connectorNode';
import { getWorkflowVariable, setWorkflowVariable, incrementWorkflowVariable } from './workflowVariables';
import { assertSafeUrl, resolveAndAssertPublic, BlockedUrlError } from '../../infrastructure/net/ssrfGuard';
import type { ProxyEnv } from '../llm/LlmProxyService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export interface CloudExecutorEnv extends ProxyEnv {
  NEON_DATABASE_URL: string;
}

/** Default per-cron-tick budget of tasks to execute across all cloud workflows. */
const DEFAULT_TASK_BUDGET = 50;

type TaskRow = typeof workflowTasks.$inferSelect;
export interface NodeInput {
  kind: string;
  config: Record<string, unknown>;
  payload?: unknown;
  triggerSource?: string;
  /** `merge` only — the raw output of each dependency, in `dependsOn` order
   *  (NOT the newline-joined `inputText` every other kind reads). Populated by
   *  `advanceCloudWorkflow`, never persisted on the task's own stored input. */
  depOutputs?: string[];
}

/** Tenant + run context a node needs to touch state beyond its own payload —
 *  the LLM usage ledger, and (new) the run/definition-scoped variable store. */
export interface UsageContext {
  db: Db;
  tenantId: number;
  /** This execution's `workflows.id` — the scope for `set-variable`/`get-variable`. */
  workflowId: string;
  /** The source `workflow_definitions.id`, when this run came from one — the
   *  cross-run scope for `increment`. Falls back to `workflowId` for ad-hoc runs. */
  workflowDefinitionId: string | null;
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

/**
 * A stand-in for the node kinds that leave this workspace (or spend real
 * tokens). Every method is OPTIONAL — a port that only stubs `gmail` leaves
 * `connector`/`mcp`/`llm` to run for real, which is never how this is actually
 * used today (the sandbox dry-run stubs all four) but keeps the seam honest
 * about being per-kind rather than all-or-nothing.
 *
 * Consulted BEFORE the real path's own preconditions (a stubbed `gmail` node
 * needs no `usageCtx`, no connected account, nothing) — that is what makes a
 * dry-run runnable with no tenant context at all.
 */
export interface OutboundPort {
  gmail?(config: Record<string, unknown>, inputText: string): Promise<string>;
  connector?(config: Record<string, unknown>, inputText: string): Promise<string>;
  mcp?(config: Record<string, unknown>, inputText: string): Promise<string>;
  llm?(config: Record<string, unknown>, inputText: string): Promise<string>;
}

/** Run one cloud-native node; returns its output (and a drop flag) or throws on failure.
 *  `usageCtx` (when known) lets the `llm` node record its spend in the ledger [1310].
 *  `outbound` (when supplied) intercepts the four node kinds that leave this workspace —
 *  see {@link OutboundPort}. Omitted, every live caller today, this is a no-op: the
 *  real adapters run exactly as they always have. */
export async function executeCloudNode(
  env: CloudExecutorEnv,
  node: NodeInput,
  inputText: string,
  usageCtx?: UsageContext,
  outbound?: OutboundPort,
): Promise<NodeResult> {
  switch (node.kind) {
    case 'trigger':
      return { output: node.payload !== undefined ? JSON.stringify(node.payload) : inputText };

    case 'llm': {
      if (outbound?.llm) return { output: await outbound.llm(node.config, inputText) };
      const cfg = node.config;
      const system = typeof cfg.system === 'string' ? cfg.system : '';
      const prompt = typeof cfg.prompt === 'string' ? cfg.prompt : '';
      const messages = [
        ...(system ? [{ role: 'system' as const, content: renderTemplate(system, inputText) }] : []),
        { role: 'user' as const, content: renderTemplate(prompt || '{{input}}', inputText) },
      ];
      // The tenant's workflow LLM node → run on their connected BYO account when they
      // have one; the node's configured `cfg.model` is a deliberate choice, so it's
      // honored only when it preempts the BYO seed (nothing connected, or it's on their
      // own account) — otherwise the connected flagship leads. Without a tenant (should
      // not happen for a real workflow) fall back to the operator pool.
      const nodeModel = typeof cfg.model === 'string' ? cfg.model : undefined;
      const { proxy, byoVendors, registeredModels } = usageCtx
        ? await tenantProxyForPlan(env as unknown as Env, usageCtx.tenantId)
        : { proxy: ideProxy(env), byoVendors: new Set<string>(), registeredModels: [] as readonly string[] };
      const result = await proxy.complete({
        model: byoAwareModel(nodeModel, byoVendors, registeredModels),
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
      return { output: (await readProxyChoice(result)).content };
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
      } catch (error) {
        /* non-JSON payload — fall through to passthrough */
      
        reportCaughtError(error, { source: "application/workflow/cloudExecutor.ts", operation: "executeCloudNode" });
      }
      return { output: inputText };
    }
    case 'router': {
      // Same JSON-tag mechanism as `branch`, generalized to N named routes:
      // the first route (in declared order) whose condition holds (or which
      // has no condition) wins; an unmatched payload takes `fallback`. Reading
      // `$route` back downstream (via a `filter` node) is how a routed path
      // self-gates — see the module docstring's note on router/branch.
      const ctx = contextFromInput(inputText);
      // `routes` is authored as a JSON string in the config panel (same
      // convention as the `mcp` kind's `params` field) — parse defensively so a
      // malformed/empty value degrades to "no routes" rather than throwing.
      let routes: Array<{ name?: unknown; condition?: unknown }> = [];
      if (Array.isArray(node.config.routes)) {
        routes = node.config.routes as Array<{ name?: unknown; condition?: unknown }>;
      } else if (typeof node.config.routes === 'string') {
        try {
          const parsedRoutes = JSON.parse(node.config.routes) as unknown;
          if (Array.isArray(parsedRoutes)) routes = parsedRoutes as Array<{ name?: unknown; condition?: unknown }>;
        } catch {
          /* malformed routes JSON — treat as no routes, falls through to fallback */
        }
      }
      let taken: string | null = null;
      for (const r of routes) {
        const name = typeof r?.name === 'string' ? r.name.trim() : '';
        if (!name) continue;
        const condition = typeof r?.condition === 'string' ? r.condition : '';
        if (!condition || evaluateBool(condition, ctx)) { taken = name; break; }
      }
      const route = taken ?? (typeof node.config.fallback === 'string' && node.config.fallback.trim() ? node.config.fallback.trim() : 'none');
      try {
        const parsed = JSON.parse(inputText || '{}') as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { output: JSON.stringify({ ...parsed, $route: route }) };
        }
      } catch (error) {
        /* non-JSON payload — fall through to passthrough */
        reportCaughtError(error, { source: "application/workflow/cloudExecutor.ts", operation: "executeCloudNode" });
      }
      return { output: inputText };
    }
    case 'merge': {
      // Reads the RAW per-dependency outputs (advanceCloudWorkflow populates
      // `node.depOutputs`), not the newline-joined `inputText` — a fan-in needs
      // to know where one branch's output ends and the next begins.
      const strategy = typeof node.config.strategy === 'string' ? node.config.strategy : 'array';
      const parts = node.depOutputs ?? (inputText ? [inputText] : []);
      const parseOrRaw = (s: string): unknown => { try { return JSON.parse(s); } catch { return s; } };
      if (strategy === 'first') return { output: parts[0] ?? '' };
      if (strategy === 'object-keys') {
        const keys = typeof node.config.keys === 'string'
          ? node.config.keys.split(',').map((k) => k.trim()).filter(Boolean)
          : [];
        const obj: Record<string, unknown> = {};
        parts.forEach((p, i) => { obj[keys[i] ?? `output${i + 1}`] = parseOrRaw(p); });
        return { output: JSON.stringify(obj) };
      }
      return { output: JSON.stringify(parts.map(parseOrRaw)) };
    }
    case 'set-variable': {
      if (!usageCtx) throw new Error('The Set Variable node needs a tenant context to store state');
      const key = typeof node.config.key === 'string' ? node.config.key.trim() : '';
      if (!key) throw new Error('Set Variable needs a key');
      const value = renderTemplate(typeof node.config.value === 'string' ? node.config.value : '{{input}}', inputText);
      await setWorkflowVariable(usageCtx.db, usageCtx.tenantId, 'run', usageCtx.workflowId, key, value);
      return { output: value };
    }
    case 'get-variable': {
      if (!usageCtx) throw new Error('The Get Variable node needs a tenant context to read state');
      const key = typeof node.config.key === 'string' ? node.config.key.trim() : '';
      if (!key) throw new Error('Get Variable needs a key');
      const value = await getWorkflowVariable(usageCtx.db, usageCtx.tenantId, 'run', usageCtx.workflowId, key);
      return { output: value };
    }
    case 'increment': {
      if (!usageCtx) throw new Error('The Increment node needs a tenant context to store state');
      const key = typeof node.config.key === 'string' ? node.config.key.trim() : '';
      if (!key) throw new Error('Increment needs a key');
      const step = typeof node.config.step === 'number' ? node.config.step : Number(node.config.step) || 1;
      // Definition-scoped (not run-scoped): the counter persists across runs of
      // the SAME workflow, matching Make's Increment function. An ad-hoc run
      // with no source definition falls back to its own workflowId so the node
      // still works (just without cross-run persistence, which nothing needs).
      const scopeId = usageCtx.workflowDefinitionId ?? usageCtx.workflowId;
      const value = await incrementWorkflowVariable(usageCtx.db, usageCtx.tenantId, scopeId, key, step);
      return { output: String(value) };
    }
    case 'sleep':
      // The delay itself is enforced by advanceCloudWorkflow's `not_before`
      // gate before this case ever runs — by the time we get here, it's due.
      return { output: inputText };
    case 'regex-match': {
      const pattern = typeof node.config.pattern === 'string' ? node.config.pattern : '';
      const flags = typeof node.config.flags === 'string' ? node.config.flags : '';
      return { output: JSON.stringify(regexMatch(pattern, flags, inputText)) };
    }
    case 'html-to-text':
      return { output: htmlToText(inputText) };
    case 'assert': {
      const ctx = contextFromInput(inputText);
      const expression = typeof node.config.expression === 'string' ? node.config.expression : '';
      const onFail = node.config.onFail === 'warn-only' ? 'warn-only' : 'fail-task';
      const holds = evaluateBool(expression, ctx);
      if (!holds && onFail === 'fail-task') throw new Error(`Assertion failed: ${expression || '(empty expression)'}`);
      try {
        const parsed = JSON.parse(inputText || '{}') as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { output: JSON.stringify({ ...parsed, $assert: holds }) };
        }
      } catch (error) {
        reportCaughtError(error, { source: "application/workflow/cloudExecutor.ts", operation: "executeCloudNode" });
      }
      return { output: inputText };
    }
    case 'healthcheck': {
      const url = renderTemplate(typeof node.config.url === 'string' ? node.config.url : '', inputText).trim();
      if (!url) throw new Error('Healthcheck needs a URL');
      const expectedStatus = typeof node.config.expectedStatus === 'number'
        ? node.config.expectedStatus
        : Number(node.config.expectedStatus) || 200;
      let status = 0;
      let up = false;
      let errorMsg: string | null = null;
      try {
        // Same SSRF guard `webFetch.ts` applies: reject internal/loopback/metadata
        // hosts up front, then a best-effort DNS-rebinding check. `redirect:
        // 'manual'` deliberately does NOT follow redirects (a 3xx is itself a
        // reportable status) rather than re-implementing per-hop re-validation
        // for a node whose whole job is "what status did this URL return".
        const parsed = assertSafeUrl(url, { allowHttp: true });
        await resolveAndAssertPublic(parsed.hostname);
        const res = await fetch(parsed.toString(), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) });
        status = res.status;
        up = status === expectedStatus;
      } catch (e) {
        errorMsg = e instanceof BlockedUrlError ? e.message : e instanceof Error ? e.message : 'fetch failed';
      }
      return { output: JSON.stringify({ url, status, expectedStatus, up, error: errorMsg }) };
    }
    case 'output':
      return { output: inputText };

    case 'gmail': {
      if (outbound?.gmail) return { output: await outbound.gmail(node.config, inputText) };
      // Send an email through the tenant's connected Gmail integration. Fields
      // support {{input}} so an upstream node's output can drive the recipient,
      // subject or body. Needs the tenant context to load the (encrypted) creds.
      if (!usageCtx) throw new Error('The Gmail node needs a tenant context to load your connected account');
      const creds = await loadGoogleCredential(env as unknown as Env, usageCtx.db, usageCtx.tenantId, 'gmail');
      if (!creds) throw new Error('Connect a Gmail integration under Settings ▸ Integrations to use the Gmail node');
      const cfg = node.config;
      const to = renderTemplate(typeof cfg.to === 'string' ? cfg.to : '', inputText).trim();
      const subject = renderTemplate(typeof cfg.subject === 'string' ? cfg.subject : '', inputText);
      const body = renderTemplate(typeof cfg.body === 'string' ? cfg.body : '{{input}}', inputText);
      const sent = await sendGmail(creds, { to, subject, body });
      return { output: JSON.stringify({ sent: true, id: sent.id, to }) };
    }

    case 'connector': {
      if (outbound?.connector) return { output: await outbound.connector(node.config, inputText) };
      // EVERY connector action — Twilio SMS/voice/WhatsApp, SendGrid, Slack,
      // Stripe, a tenant's own connector — reaches a workflow through this one
      // node. It takes the connector and action as CONFIG, so publishing a new
      // connector makes it usable in a workflow with no change here.
      if (!usageCtx) throw new Error('An integration node needs a tenant context to load your connection');
      const outcome = await executeConnectorNode(
        { db: usageCtx.db, env: env as unknown as Env, tenantId: usageCtx.tenantId },
        node.config as ConnectorNodeConfig,
        inputText,
      );
      if (!outcome.ok) throw new Error(outcome.error);
      return { output: outcome.output };
    }

    case 'mcp': {
      if (outbound?.mcp) return { output: await outbound.mcp(node.config, inputText) };
      // Every Data + Marketing palette integration lands here. The node resolves
      // the tenant's stored credential for its provider and issues the SAME HTTP
      // call the connect form's "Test connection" makes, so a green test and a
      // green node cannot mean different things (see application/workflow/mcpNode.ts).
      if (!usageCtx) throw new Error('An integration node needs a tenant context to load your connection');
      const outcome = await executeMcpNode(
        {
          db: usageCtx.db,
          tenantId: usageCtx.tenantId,
          encryptionSecret: credentialSecret(env as unknown as Env),
        },
        node.config as McpNodeConfig,
        inputText,
      );
      if (!outcome.ok) throw new Error(outcome.error);
      return { output: outcome.output };
    }

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

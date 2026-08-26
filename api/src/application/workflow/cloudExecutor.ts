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
 *     `case` runs, the delay has already elapsed.
 *
 * A per-tick task budget bounds how much work one cron invocation does; a
 * multi-stage cloud workflow advances across successive ticks.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import { workflows, workflowTasks } from '../../infrastructure/database/schema';
import { ideProxy, readProxyChoice } from '../llm/LlmProxyService';
import { loadGoogleCredential } from '../integrations/googleCredential';
import { sendGmail, searchGoogleDrive, readGoogleDriveFileText } from '../integrations/googleOAuth';
import { tenantProxyForPlan, byoAwareModel } from '../llm/tenantProxy';
import { recordProxyUsage } from '../llm/usageLedger';
import { contextFromInput, evaluateBool, renderTransform, renderValueTemplate } from '../../domain/workflowExpr';
import {
  regexMatch, htmlToText, htmlTable, htmlElements, matchElements,
  matchPatternAdvanced, replaceText, chunkText, convertEncoding,
} from '../../domain/workflowTextTools';
import { credentialSecret } from '../integrations/credentialCrypto';
import { executeMcpNode, type McpNodeConfig } from './mcpNode';
import { executeConnectorNode, type ConnectorNodeConfig } from './connectorNode';
import { getWorkflowVariable, setWorkflowVariable, incrementWorkflowVariable } from './workflowVariables';
import { assertSafeUrl, resolveAndAssertPublic, BlockedUrlError } from '../../infrastructure/net/ssrfGuard';
import { platformWebSearchBacking } from '../runtime/webSearchCredential';
import { searchWeb } from '../runtime/cloudWeb';
import { searchOwnedThenDiscover } from '../webSearch/demandSearch';
import { fetchWebDocumentCached } from '../web/webFetch';
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
  /**
   * Dependency task id → the outlet label its edge carries (0 or more entries).
   *
   * Written by `instantiateRun` from the definition's labeled edges. A dependency
   * listed here is CONDITIONAL: this task runs only if that upstream node took
   * this outlet. Absent = unconditional, which is every edge authored before
   * labels existed, so nothing that already runs changes behaviour.
   */
  depLabels?: Record<string, string>;
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

/**
 * One vision-capable turn — an image URL plus a text prompt, on whichever
 * model the tenant's BYO/operator pool routes a vision request to.
 * `poolRouting.ts`'s `hasVision` detection already promotes a vision-capable
 * model whenever it sees this EXACT `{type:'image_url'}` content shape, so no
 * vendor/model pin is needed here — same auto-routing the `llm` case's plain
 * text turns get, just with image-aware detection doing the picking. Shared by
 * `analyze-image` and `extract-document-data`, which differ only in prompt.
 */
async function completeVisionPrompt(
  env: CloudExecutorEnv,
  usageCtx: UsageContext | undefined,
  systemPrompt: string,
  userText: string,
  imageUrl: string,
  useCase: string,
): Promise<string> {
  const messages = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    {
      role: 'user' as const,
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ];
  const { proxy, byoVendors, registeredModels } = usageCtx
    ? await tenantProxyForPlan(env as unknown as Env, usageCtx.tenantId)
    : { proxy: ideProxy(env), byoVendors: new Set<string>(), registeredModels: [] as readonly string[] };
  const result = await proxy.complete({
    model: byoAwareModel(undefined, byoVendors, registeredModels),
    // The proxy's public `ChatMessage.content` type is `string` (its documented
    // surface for `llmRoutes`/`ideAiRoutes`); the actual dispatch is content-shape
    // agnostic (`poolRouting.ts` inspects it for `image_url` blocks at runtime —
    // see the module comment above), so a vision turn's multipart content is
    // asserted through rather than widening that public, "kept stable" type for
    // every caller over one workflow-node need.
    messages: messages as unknown as Parameters<typeof proxy.complete>[0]['messages'],
  });
  if (usageCtx) {
    void recordProxyUsage(usageCtx.db, env as unknown as Env, { tenantId: usageCtx.tenantId, useCase, result });
  }
  if (!result.response.ok) throw new Error(`vision call failed (${result.response.status})`);
  return (await readProxyChoice(result)).content;
}

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
  webSearch?(config: Record<string, unknown>, inputText: string): Promise<string>;
  webFetch?(config: Record<string, unknown>, inputText: string): Promise<string>;
  googleDrive?(config: Record<string, unknown>, inputText: string): Promise<string>;
  transcribeAudio?(config: Record<string, unknown>, inputText: string): Promise<string>;
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

    case 'web-search': {
      if (outbound?.webSearch) return { output: await outbound.webSearch(node.config, inputText) };
      const query = renderTemplate(
        typeof node.config.query === 'string' && node.config.query ? node.config.query : '{{input}}',
        inputText,
      ).trim();
      if (!query) throw new Error('Web Search needs a query');
      // With a tenant in scope, this checks the tenant's OWNED crawled index first and
      // only falls back to a vendor (tenant Tavily/Ollama/Exa/Linkup key → operator key
      // → SearXNG → keyless Wikipedia) to discover pages worth crawling — the SAME
      // `searchOwnedThenDiscover` primitive the cloud agent's `web_search` tool and the
      // Brain's `web.search` MCP tool use, so a workflow's research also builds the
      // tenant's index instead of discarding every result. A tenant-LESS run (a preview
      // with no usageCtx) has no index to own, so it falls back to a vendor-only call
      // against the platform backing — never null, so no "connect an integration"
      // refusal either way.
      const result = usageCtx
        ? await searchOwnedThenDiscover({ db: usageCtx.db, env: env as unknown as Env, tenantId: usageCtx.tenantId, request: { query } })
        : await searchWeb(env as unknown as Env, platformWebSearchBacking(env as unknown as Env), query);
      if (!result.ok) throw new Error(result.error ?? 'Web search failed');
      return {
        output: JSON.stringify({
          query, results: result.results ?? [], coverage: result.coverage, attribution: result.attribution,
        }),
      };
    }

    case 'web-fetch': {
      if (outbound?.webFetch) return { output: await outbound.webFetch(node.config, inputText) };
      // Reuses the SAME SSRF-guarded, redirect-revalidating, cached fetch the
      // Brain's own "read this URL" tool uses — see application/web/webFetch.ts.
      // No credential needed (any public URL), so this runs with or without a
      // tenant context, same as web-search's keyless floor.
      const url = renderTemplate(typeof node.config.url === 'string' ? node.config.url : '', inputText).trim();
      if (!url) throw new Error('Web Fetch needs a URL');
      const doc = await fetchWebDocumentCached(env as unknown as Env, url);
      return {
        output: JSON.stringify({
          url: doc.url, status: doc.status, contentType: doc.contentType,
          title: doc.title, text: doc.text, truncated: doc.truncated,
        }),
      };
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
      // Evaluate the condition and tag the payload with the taken branch. The
      // tag is read TWICE: by any downstream node that wants `$branch` in its
      // expressions, and by the drain loop, which prunes an arm whose labeled
      // edge does not match it (see `prunedByEdgeLabel`). An unlabeled graph
      // still runs both sides, exactly as before — a workflow authored without
      // labels cannot change behaviour under it.
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
      // has no condition) wins; an unmatched payload takes `fallback`. An edge
      // labeled with a route name is pruned by the drain loop when a different
      // route won; a `filter` on `$route` remains available for graphs that
      // were authored before labels existed.
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
        } catch (error) {
          // Malformed routes JSON — treat as no routes, falls through to fallback.
          reportCaughtError(error, { source: 'application/workflow/cloudExecutor.ts', operation: 'router.parseRoutes', level: 'warning' });
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
    case 'switch': {
      // Like `router`, but matches a VALUE against literal cases rather than
      // evaluating a boolean expression per route — Make's Switch module.
      // `field` names a top-level property of the JSON payload to read; empty
      // means match against the whole (trimmed) input text instead.
      const ctx = contextFromInput(inputText);
      const field = typeof node.config.field === 'string' ? node.config.field.trim() : '';
      const actual = field ? String((ctx as Record<string, unknown>)[field] ?? '') : inputText.trim();
      let cases: Array<{ match?: unknown; name?: unknown }> = [];
      if (Array.isArray(node.config.cases)) {
        cases = node.config.cases as Array<{ match?: unknown; name?: unknown }>;
      } else if (typeof node.config.cases === 'string') {
        try {
          const parsedCases = JSON.parse(node.config.cases) as unknown;
          if (Array.isArray(parsedCases)) cases = parsedCases as Array<{ match?: unknown; name?: unknown }>;
        } catch (error) {
          reportCaughtError(error, { source: 'application/workflow/cloudExecutor.ts', operation: 'switch.parseCases', level: 'warning' });
        }
      }
      let taken: string | null = null;
      for (const c of cases) {
        if (String(c?.match ?? '') === actual) { taken = typeof c?.name === 'string' && c.name ? c.name : actual; break; }
      }
      const route = taken ?? (typeof node.config.fallback === 'string' && node.config.fallback.trim() ? node.config.fallback.trim() : 'none');
      try {
        const parsed = JSON.parse(inputText || '{}') as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { output: JSON.stringify({ ...parsed, $route: route }) };
        }
      } catch (error) {
        reportCaughtError(error, { source: 'application/workflow/cloudExecutor.ts', operation: 'executeCloudNode' });
      }
      return { output: inputText };
    }
    case 'iterator': {
      // Validates the shape and hands the array back unchanged — the actual
      // per-item fan-out happens in `advanceCloudWorkflow` the moment THIS
      // task is recorded `completed`, via `planIteratorExpansion` (see its
      // docstring for the exact mechanism and its bounded scope).
      let parsed: unknown;
      try {
        parsed = JSON.parse(inputText);
      } catch (error) {
        reportCaughtError(error, { source: 'application/workflow/cloudExecutor.ts', operation: 'iterator.parseInput', level: 'warning' });
        parsed = null;
      }
      const items = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items))
          ? (parsed as { items: unknown[] }).items
          : null;
      if (!items) throw new Error('Iterator needs an array (or {"items":[...]}) as its input');
      return { output: JSON.stringify(items) };
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
    case 'numeric-aggregator': {
      // Same raw-depOutputs fan-in as `merge`, reduced to one number — Make's
      // Numeric aggregator. Non-numeric branch outputs are dropped rather than
      // failing the node (an aggregate over "the numbers that were there").
      const op = typeof node.config.op === 'string' ? node.config.op : 'sum';
      const parts = node.depOutputs ?? (inputText ? [inputText] : []);
      const nums = parts.map((p) => Number(p)).filter((n) => Number.isFinite(n));
      let result: number;
      if (op === 'avg') result = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      else if (op === 'min') result = nums.length ? Math.min(...nums) : 0;
      else if (op === 'max') result = nums.length ? Math.max(...nums) : 0;
      else if (op === 'count') result = nums.length;
      else result = nums.reduce((a, b) => a + b, 0);
      return { output: String(result) };
    }
    case 'table-aggregator': {
      // `merge`'s 'array' strategy, filtered to rows that actually parsed as an
      // object — Make's Table aggregator collects structured rows, not a mix
      // of scalars and objects.
      const parts = node.depOutputs ?? (inputText ? [inputText] : []);
      const rows = parts
        .map((p) => { try { return JSON.parse(p) as unknown; } catch { return null; } })
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
      return { output: JSON.stringify(rows) };
    }
    case 'text-aggregator': {
      const separator = typeof node.config.separator === 'string' ? node.config.separator : '\n';
      const parts = node.depOutputs ?? (inputText ? [inputText] : []);
      return { output: parts.join(separator) };
    }
    case 'set-variable': {
      if (!usageCtx) throw new Error('The Set Variable node needs a tenant context to store state');
      const key = typeof node.config.key === 'string' ? node.config.key.trim() : '';
      if (!key) throw new Error('Set Variable needs a key');
      // `renderValueTemplate`, not `renderTemplate`: a value field is a literal
      // unless it carries a span, and every span form is available — so a declared
      // output capture can name a PATH (`{{ order.id }}`) instead of being able to
      // store only the whole upstream payload. See its own doc comment.
      const value = renderValueTemplate(typeof node.config.value === 'string' ? node.config.value : '{{input}}', inputText, contextFromInput(inputText));
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
    case 'get-variables': {
      if (!usageCtx) throw new Error('The Get Variables node needs a tenant context to read state');
      const keys = typeof node.config.keys === 'string'
        ? node.config.keys.split(',').map((k) => k.trim()).filter(Boolean)
        : [];
      const out: Record<string, string> = {};
      for (const key of keys) {
        out[key] = await getWorkflowVariable(usageCtx.db, usageCtx.tenantId, 'run', usageCtx.workflowId, key);
      }
      return { output: JSON.stringify(out) };
    }
    case 'set-variables': {
      if (!usageCtx) throw new Error('The Set Variables node needs a tenant context to store state');
      // Authored as a JSON string, same convention as `router`'s `routes` and
      // `mcp`'s `params` — {"key": "value or {{input}}"} per entry.
      let values: Record<string, unknown> = {};
      if (typeof node.config.values === 'string') {
        try {
          const parsedValues = JSON.parse(node.config.values) as unknown;
          if (parsedValues && typeof parsedValues === 'object' && !Array.isArray(parsedValues)) {
            values = parsedValues as Record<string, unknown>;
          }
        } catch (error) {
          reportCaughtError(error, { source: 'application/workflow/cloudExecutor.ts', operation: 'set-variables.parseValues', level: 'warning' });
        }
      }
      const written: Record<string, string> = {};
      // One context for the whole map — parsing the payload once per node, not once
      // per key, on what is routinely the widest node in a graph.
      const valuesCtx = contextFromInput(inputText);
      for (const [key, raw] of Object.entries(values)) {
        const value = renderValueTemplate(String(raw ?? ''), inputText, valuesCtx);
        await setWorkflowVariable(usageCtx.db, usageCtx.tenantId, 'run', usageCtx.workflowId, key, value);
        written[key] = value;
      }
      return { output: JSON.stringify(written) };
    }
    case 'compose-string':
      return { output: renderTemplate(typeof node.config.template === 'string' ? node.config.template : '{{input}}', inputText) };
    case 'convert-encoding': {
      const mode = typeof node.config.mode === 'string' ? node.config.mode : 'base64-encode';
      return { output: convertEncoding(mode, inputText) };
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
    case 'html-table':
      return { output: JSON.stringify(htmlTable(inputText)) };
    case 'html-elements': {
      const tag = typeof node.config.tag === 'string' ? node.config.tag : '';
      return { output: JSON.stringify(htmlElements(inputText, tag)) };
    }
    case 'match-elements': {
      const tag = typeof node.config.tag === 'string' ? node.config.tag : '';
      const pattern = typeof node.config.pattern === 'string' ? node.config.pattern : '';
      return { output: JSON.stringify(matchElements(inputText, tag, pattern)) };
    }
    case 'match-pattern-advanced': {
      const pattern = typeof node.config.pattern === 'string' ? node.config.pattern : '';
      const flags = typeof node.config.flags === 'string' ? node.config.flags : '';
      return { output: JSON.stringify(matchPatternAdvanced(pattern, flags, inputText)) };
    }
    case 'replace': {
      const pattern = typeof node.config.pattern === 'string' ? node.config.pattern : '';
      const replacement = typeof node.config.replacement === 'string' ? node.config.replacement : '';
      const flags = typeof node.config.flags === 'string' ? node.config.flags : '';
      const literal = node.config.literal === true || node.config.literal === 'true';
      return { output: replaceText(inputText, pattern, replacement, flags, literal) };
    }
    case 'chunk-text': {
      const chunkSize = typeof node.config.chunkSize === 'number' ? node.config.chunkSize : Number(node.config.chunkSize) || 1000;
      const overlap = typeof node.config.overlap === 'number' ? node.config.overlap : Number(node.config.overlap) || 0;
      return { output: JSON.stringify(chunkText(inputText, chunkSize, overlap)) };
    }
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

    case 'analyze-image': {
      if (outbound?.llm) return { output: await outbound.llm(node.config, inputText) };
      const cfg = node.config;
      const url = renderTemplate(typeof cfg.url === 'string' && cfg.url ? cfg.url : '{{input}}', inputText).trim();
      if (!url) throw new Error('Analyze Image needs an image URL');
      const prompt = typeof cfg.prompt === 'string' && cfg.prompt ? cfg.prompt : 'Describe this image in detail.';
      const content = await completeVisionPrompt(env, usageCtx, '', prompt, url, 'workflow_analyze_image');
      return { output: content };
    }

    case 'extract-document-data': {
      if (outbound?.llm) return { output: await outbound.llm(node.config, inputText) };
      // Make's "Content Extractor" (document/invoice/receipt) is a vision call
      // with a structured-extraction prompt, not a different capability — the
      // same `completeVisionPrompt` `analyze-image` uses, above.
      const cfg = node.config;
      const url = renderTemplate(typeof cfg.url === 'string' && cfg.url ? cfg.url : '{{input}}', inputText).trim();
      if (!url) throw new Error('Extract Document Data needs a document/image URL');
      const fields = typeof cfg.fields === 'string' ? cfg.fields.trim() : '';
      const system = 'You are a document data extraction assistant. Extract exactly the requested fields from the document image. Reply with only a single valid JSON object mapping each requested field to its extracted value (or null if not found) — no markdown, no explanation.';
      const prompt = fields
        ? `Extract these fields: ${fields}`
        : 'Extract every key field visible (e.g. date, total amount, vendor/sender name, line items) as JSON.';
      const content = await completeVisionPrompt(env, usageCtx, system, prompt, url, 'workflow_extract_document');
      return { output: content };
    }

    case 'transcribe-audio': {
      if (outbound?.transcribeAudio) return { output: await outbound.transcribeAudio(node.config, inputText) };
      // Whisper is a multipart REST call, not a chat completion — genuinely a
      // different transport from every other AI Agents kind here, so it is not
      // routed through `proxy.complete()`. Operator-funded only (no per-tenant
      // BYO path exists for Whisper today, same tradeoff as TAVILY_API_KEY —
      // see `env.ts`'s `OPENAI_API_KEY` doc).
      const cfg = node.config;
      const url = renderTemplate(typeof cfg.url === 'string' && cfg.url ? cfg.url : '{{input}}', inputText).trim();
      if (!url) throw new Error('Transcribe Audio needs an audio file URL');
      const mode = cfg.mode === 'translate' ? 'translate' : 'transcribe';
      const apiKey = (env as unknown as Env).OPENAI_API_KEY;
      if (!apiKey) throw new Error('Transcribe Audio needs an operator-configured OPENAI_API_KEY');

      const parsed = assertSafeUrl(url, { allowHttp: true });
      await resolveAndAssertPublic(parsed.hostname);
      const audioRes = await fetch(parsed.toString(), { method: 'GET', signal: AbortSignal.timeout(20_000) });
      if (!audioRes.ok) throw new Error(`Could not fetch the audio file (${audioRes.status})`);
      const audioBlob = await audioRes.blob();

      const form = new FormData();
      form.append('file', audioBlob, 'audio');
      form.append('model', 'whisper-1');
      if (mode === 'transcribe' && typeof cfg.language === 'string' && cfg.language) {
        form.append('language', cfg.language);
      }
      const endpoint = mode === 'translate'
        ? 'https://api.openai.com/v1/audio/translations'
        : 'https://api.openai.com/v1/audio/transcriptions';
      const res = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message || `Whisper ${mode} failed (${res.status})`);
      return { output: JSON.stringify({ text: body.text ?? '', mode }) };
    }

    case 'google-drive': {
      if (outbound?.googleDrive) return { output: await outbound.googleDrive(node.config, inputText) };
      // Same tenant-credential path as `gmail` above (`integration_credentials`,
      // provider='google_drive') — replaces the old "Google Drive" palette entry,
      // which was `kind: 'trigger'` (inert when chained mid-flow — see DONE.md
      // 2026-08-16). NOT the separate per-USER `DriveProvider`/`driveService.ts`
      // system the canvas import picker uses (that needs an interactive
      // `userId`+`connectionId` this node has no session to supply).
      if (!usageCtx) throw new Error('The Google Drive node needs a tenant context to load your connected account');
      const driveCreds = await loadGoogleCredential(env as unknown as Env, usageCtx.db, usageCtx.tenantId, 'google_drive');
      if (!driveCreds) throw new Error('Connect a Google Drive integration under Settings ▸ Integrations to use the Google Drive node');
      const driveCfg = node.config;
      const operation = typeof driveCfg.operation === 'string' ? driveCfg.operation : 'search';
      if (operation === 'read') {
        const fileId = renderTemplate(typeof driveCfg.fileId === 'string' ? driveCfg.fileId : '', inputText).trim();
        if (!fileId) throw new Error('Google Drive read needs a file id');
        const file = await readGoogleDriveFileText(driveCreds, fileId);
        return { output: JSON.stringify(file) };
      }
      const query = renderTemplate(typeof driveCfg.query === 'string' && driveCfg.query ? driveCfg.query : '{{input}}', inputText).trim();
      if (!query) throw new Error('Google Drive search needs a query');
      const hits = await searchGoogleDrive(driveCreds, query);
      return { output: JSON.stringify({ query, files: hits }) };
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

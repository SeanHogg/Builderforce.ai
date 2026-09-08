/**
 * The container op protocol — ONE dispatch table, one handler per op.
 *
 * ── WHAT THIS REPLACED ──────────────────────────────────────────────────────
 * A 546-line `if (op === 'status') … if (op === 'heartbeat') … ` chain inside
 * `cloudAgentEngine.ts`, ending in a `return { status: 400 }` fallthrough. Fourteen
 * unrelated operations sharing one function body, one scope and one set of locals:
 * adding an op meant appending to the chain, and every op could see (and
 * accidentally depend on) every other op's variables. A dispatch table is what the
 * chain was already standing in for — {@link OP_HANDLERS} makes it the real thing,
 * so an op is a named entry with a narrow contract rather than a position in a
 * 546-line `if`.
 *
 * ── THE PROTOCOL IS SHARED BY TWO IMAGES ────────────────────────────────────
 * The Cloudflare Container and the GitHub Actions runner speak this protocol
 * verbatim, and every op is surface-agnostic — except `ask_human`, whose resume
 * must redispatch to the transport the run actually came from, which is why
 * {@link ContainerOpDeps.surface} exists. The caller knows; nothing on the
 * execution row reliably does.
 *
 * ── WHY THREE CALLBACKS RATHER THAN AN IMPORT ───────────────────────────────
 * Three ops (`llm`, `spawn`, `finalize`) drive the RUN, so they need the engine's
 * turn/loop/finalize primitives. Importing those from `cloudAgentEngine` would
 * close a cycle — the engine owns this table. They arrive instead as
 * {@link ContainerOpEngine}: a narrow, typed port of exactly three functions, not
 * a bag of engine internals. Every other op needs nothing from the engine at all,
 * which is precisely the boundary this split makes visible.
 */
import { and, eq } from 'drizzle-orm';
import { coordinationScopeKey } from '../../../domain/coordination/resourceKey';
import { isMemoryScope } from '../../../domain/memory/memoryScope';
import { ExecutionStatus, TenantRole } from '../../../domain/shared/types';
import { executions, tasks } from '../../../infrastructure/database/schema';
import { buildCoordinationCapability, claimWriteLease } from '../../coordination/coordinationCapability';
import { releaseAllForExecution } from '../../coordination/leaseService';
import {
  callBuiltinTool, cloudAgentPlatformToolSchemas, resolveCloudAgentPlatformTool,
} from '../../llm/builtinMcpService';
import { CLOUD_COMPACT_DEFAULTS, buildGatewaySummarizer, compactMessages } from '../../llm/compactMessages';
import { buildMemoryCapability } from '../../memory/memoryService';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { commitAgentFile, resolveTicketRepoContext } from '../../repos/commitFileAsPendingChange';
import { recordRepoWrite, resolveTaskRepoRouter } from '../../repos/taskRepoSet';
import { recordContextContribution } from '../../trust/trustService';
import { searchOwnedThenDiscover } from '../../webSearch/demandSearch';
import { CONTAINER_AGENT_TOOLS, CONTAINER_SURFACE_CAPS, cloudToolRegistry } from '../cloudAgentTools';
import { applyPendingSteering } from '../cloudLoopControl';
import { handleCloudRunCrash } from '../cloudSelfHeal';
import { buildOrchestrationCapability, imageHostedChildCeiling } from '../cloudSubagent';
import { recordCloudToolEvent } from '../cloudToolEvents';
import { notifyExecutionSubscribers } from '../executionEvents';
import {
  PAUSED_TOOL_RESULT_NOTE, coercePausedLoopState, pauseExecutionForQuestion, withPausedToolResults,
} from '../executionPause';
import { imageAdvertisedTools, readToolManifest } from '../imageToolHandshake';
import { cloudCrashReason } from '../orphanReasons';
import { teardownCrashedRunArtifacts } from '../runRollback';
import { scoreRunOutcome } from '../scoreRunOutcome';
import { agentCommitMessage, buildPrdCapability, gitSecret, recordTaskFileChange } from './prd';
import { readOpenAiToolCalls } from '@builderforce/agent-loop';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import type { RuntimeService } from '../RuntimeService';
import { heartbeatExecution, isExecutionCancelled, type ContainerRunContext } from './runContext';

/** What one op answers with — an HTTP status and a JSON body for the image. */
export interface ContainerOpResult {
  status: number;
  body: unknown;
}

/**
 * The three RUN-DRIVING primitives the engine owns, handed to the ops that need
 * them. Deliberately narrow: this is a port, not a window onto the engine.
 */
export interface ContainerOpEngine {
  /** ONE metered LLM turn on an image surface (`llm`, and the `spawn` op's child). */
  imageRunTurn: ImageRunTurn;
  /** The durable tool loop, for a child agent commissioned by `spawn`. */
  runCloudToolLoop: RunCloudToolLoop;
  /** The shared terminal path: commit, PR, score, release leases (`finalize`). */
  finalizeCloudRun: FinalizeCloudRun;
  /** The gateway provider a spawned child drives. */
  buildCloudProvider: BuildCloudProvider;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the engine's own signatures;
   re-stating them here would be a second declaration to keep in step. */
type ImageRunTurn = (...args: any[]) => Promise<any>;
type RunCloudToolLoop = (...args: any[]) => Promise<any>;
type FinalizeCloudRun = (...args: any[]) => Promise<any>;
type BuildCloudProvider = (...args: any[]) => any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Everything a handler is given. The identity fields are derived once, here, so
 *  fourteen handlers do not each re-destructure the run context. */
export interface ContainerOpDeps {
  env: Env;
  db: Db;
  ctx: ContainerRunContext;
  executionId: number;
  args: Record<string, unknown>;
  /** WHICH image is calling — only `ask_human` differs on it (its resume must
   *  redispatch to the transport the run actually came from). */
  surface: 'container' | 'github_actions';
  engine: ContainerOpEngine;
  /** Transitions the run's own lifecycle — only the terminal ops (`finalize`,
   *  `fail`, `ask_human`) touch it, which is why it is here and not on the context. */
  runtimeService: RuntimeService;
  /** Derived from {@link ctx} once, so fourteen handlers do not each re-destructure
   *  it. The optionality MIRRORS the context exactly — an agent-less default run
   *  genuinely has no `cloudAgentRef`, and widening that here would let a handler
   *  assume an attribution the run does not have. */
  tenantId: number;
  taskId: number;
  projectId: number;
  cloudAgentRef?: string;
  agentLabel: string;
  model?: string;
  taskRow: { id: number; title: string; description: string | null };
}

export type ContainerOpHandler = (deps: ContainerOpDeps) => Promise<ContainerOpResult>;

/**
 * Every op an image may post, and the one function that answers it.
 *
 * The table IS the protocol: adding an op is a new entry, not another branch in a
 * shared function body, and no handler can reach another handler's locals.
 */
export const OP_HANDLERS: Record<string, ContainerOpHandler> = {
  status: async (deps) => {
    const { db, executionId } = deps;
    return { status: 200, body: { cancelled: await isExecutionCancelled(db, executionId) } };
  },

  // Liveness heartbeat from the long-lived container, fired on a timer independent of
  // LLM steps so a multi-minute `run_command` (build/test) keeps the run out of the
  // orphan reaper. Returns `cancelled` so the container can abort an in-flight command
  // when the run was cancelled mid-build instead of waiting out the command timeout.
  heartbeat: async (deps) => {
    const { db, executionId } = deps;
    await heartbeatExecution(db, executionId);
    return { status: 200, body: { ok: true, cancelled: await isExecutionCancelled(db, executionId) } };
  },
  event: async (deps) => {
    const { db, executionId, args, tenantId, cloudAgentRef } = deps;
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: String(args.toolName ?? 'tool'), category: String(args.category ?? 'tool'),
      toolCallId: typeof args.toolCallId === 'string' ? args.toolCallId : undefined,
      detail: args.detail, result: typeof args.result === 'string' ? args.result : undefined,
      durationMs: typeof args.durationMs === 'number' ? args.durationMs : undefined,
    });
    return { status: 200, body: { ok: true } };
  },

  // Curated platform tool relayed from the container (it holds no DB creds). Same
  // dispatch as the durable loop: subset-only resolver refuses off-list names, run
  // in-process tenant-scoped, project defaulted to THIS run's. Records a tool event
  // so container platform actions show on the timeline like the Worker loop's.
  platform_tool: async (deps) => {
    const { env, db, ctx, executionId, args, tenantId, projectId, cloudAgentRef } = deps;
    const name = typeof args.name === 'string' ? args.name : '';
    const toolArgs = args.arguments && typeof args.arguments === 'object' ? (args.arguments as Record<string, unknown>) : {};
    const platformTool = resolveCloudAgentPlatformTool(name, ctx.originatingChatId);
    if (!platformTool) return { status: 200, body: { ok: false, error: `unknown or disallowed platform tool '${name}'` } };
    const tStart = Date.now();
    let result: Record<string, unknown>;
    try {
      const data = await callBuiltinTool(db, {
        tenantId, tool: platformTool,
        arguments: { projectId, ...toolArgs, ...(ctx.originatingChatId != null ? { chatId: ctx.originatingChatId } : {}) },
        env, userId: cloudAgentRef ?? null, agentRef: cloudAgentRef ?? null,
        role: TenantRole.MANAGER,
      });
      result = data && typeof data === 'object' ? (data as Record<string, unknown>) : { ok: true, result: data };
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: name, category: 'tool', detail: toolArgs,
      result: JSON.stringify(result).slice(0, 300), durationMs: Date.now() - tStart,
    });
    return { status: 200, body: result };
  },

  // Durable cross-run memory relayed from the container (it holds no DB creds, the
  // same reason `platform_tool` exists). Backed by the IDENTICAL capability the
  // durable loop uses — `project_facts` for a project-scoped run, the tenant-wide
  // `agent_memory` twin otherwise — so a fact remembered on one cloud surface is
  // recalled on the other. `action` is 'recall' | 'remember'. Records a tool event so
  // container memory calls appear on the timeline like the Worker loop's.
  /**
   * WEB SEARCH from the container.
   *
   * The durable/Worker surface has had `web.search` since `resolveWebSearchBacking`
   * started always resolving a backing (a tenant BYO key, the operator key, or the
   * keyless encyclopedic floor). The container did not — its capabilities come from
   * the image's own tool loop, and there was no op behind them, so advertising
   * `web.search` there would have surfaced a tool that 400s mid-run. This op is that
   * backing, and it is what lets the two cloud surfaces finally advertise the same
   * capability.
   *
   * Relayed rather than called in-process for the same reason `memory` and
   * `platform_tool` are: the container holds no credentials. Routing it through the
   * Worker also means both surfaces share ONE resolver, ONE read-through cache, ONE
   * meter, and — via {@link searchOwnedThenDiscover} — ONE owned index: a container run
   * and a durable run asking the same question hit the same cache entry and the same
   * tenant corpus, a keyed vendor is charged once, and whatever either surface
   * discovers gets crawled into the tenant's own index for next time instead of being
   * thrown away the moment this tool call returns.
   */
  search: async (deps) => {
    const { env, db, executionId, args, tenantId, cloudAgentRef } = deps;
    const query = typeof args.query === 'string' ? args.query : '';
    if (!query.trim()) return { status: 200, body: { ok: false, error: 'query is required' } };
    const tStart = Date.now();
    const result = await searchOwnedThenDiscover({ db, env, tenantId, request: { query } });
    // The same context-contribution record the durable loop writes, so a fact the
    // container found is auditable exactly like one the Worker found.
    if (result.ok) {
      await recordContextContribution(db, {
        tenantId, executionId, sourceKind: 'web_search', sourceRef: query,
        trustTier: 'external', content: JSON.stringify(result),
      }).catch((error) => {
        reportCaughtError(error, { source: 'application/runtime/cloudAgent/containerOps.ts', operation: 'containerSearch' });
      });
    }
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: 'web_search', category: 'tool',
      detail: { query }, result: result.ok ? `${result.results?.length ?? 0} results` : (result.error ?? 'failed'),
      durationMs: Date.now() - tStart,
    }).catch((error) => {
      reportCaughtError(error, { source: 'application/runtime/cloudAgent/containerOps.ts', operation: 'containerSearch' });
    });
    return { status: 200, body: result };
  },
  memory: async (deps) => {
    const { env, db, executionId, args, tenantId, taskId, projectId, cloudAgentRef } = deps;
    const action = typeof args.action === 'string' ? args.action : '';
    const memory = buildMemoryCapability({ db, env, tenantId, projectId, ticketId: taskId, origin: 'cloud-run', executionId });
    const tStart = Date.now();
    let result: Record<string, unknown>;
    let toolName = 'memory';
    try {
      if (action === 'recall') {
        toolName = 'memory_recall';
        const query = typeof args.query === 'string' ? args.query : '';
        if (!query.trim()) return { status: 200, body: { ok: false, error: 'query is required' } };
        const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : undefined;
        result = (await memory.recall(query, limit)) as unknown as Record<string, unknown>;
      } else if (action === 'remember') {
        toolName = 'memory_remember';
        const key = typeof args.key === 'string' ? args.key : '';
        const content = typeof args.content === 'string' ? args.content : '';
        if (!key.trim() || !content.trim()) return { status: 200, body: { ok: false, error: 'key and content are required' } };
        const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : undefined;
        const importance = typeof args.importance === 'number' && Number.isFinite(args.importance) ? args.importance : undefined;
        const scope = isMemoryScope(args.scope) ? args.scope : undefined;
        const ttlDays = typeof args.ttl_days === 'number' && Number.isFinite(args.ttl_days) ? args.ttl_days : undefined;
        result = (await memory.remember(key, content, { tags, importance, scope, ttlDays })) as unknown as Record<string, unknown>;
      } else if (action === 'forget') {
        // The container relays `memory_forget` through the same op (it holds no DB
        // creds), so the scoped delete stays behind the one governed service.
        toolName = 'memory_forget';
        const key = typeof args.key === 'string' ? args.key : '';
        if (!key.trim()) return { status: 200, body: { ok: false, error: 'key is required' } };
        result = (await memory.forget!(key)) as unknown as Record<string, unknown>;
      } else {
        return { status: 200, body: { ok: false, error: `unknown memory action '${action}' (expected 'recall', 'remember' or 'forget')` } };
      }
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName, category: 'tool', detail: args,
      result: JSON.stringify(result).slice(0, 300), durationMs: Date.now() - tStart,
    });
    return { status: 200, body: result };
  },

  // The ticket PRD, relayed from the container / Actions runner (neither holds DB
  // creds — the same reason `memory` and `platform_tool` exist). Backed by the
  // IDENTICAL capability the durable loop uses, so an `update_prd` call means exactly
  // the same thing on every surface. `action` is 'append' | 'section'.
  prd: async (deps) => {
    const { env, db, ctx, executionId, args, tenantId, taskId, projectId, cloudAgentRef, agentLabel } = deps;
    const action = args.action === 'section' ? 'section' : 'append';
    const content = typeof args.content === 'string' ? args.content : '';
    const heading = typeof args.section === 'string' ? args.section : undefined;
    const tStart = Date.now();
    const prd = buildPrdCapability(env, db, {
      executionId, tenantId, projectId, taskId, taskTitle: ctx.taskTitle, agentLabel,
    });
    const result = (await (action === 'section'
      ? prd.editSection(heading ?? '', content)
      : prd.append(content))) as unknown as Record<string, unknown>;
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: 'update_prd', category: 'tool', detail: args,
      result: JSON.stringify(result).slice(0, 300), durationMs: Date.now() - tStart,
    });
    return { status: 200, body: result };
  },

  // Multi-agent coordination relayed from the container. The Worker remains the
  // authority for leases and blackboard notes; the image receives only the same
  // capability-shaped results as the durable loop.
  coordinate: async (deps) => {
    const { env, db, ctx, executionId, args, tenantId, taskId, cloudAgentRef, agentLabel } = deps;
    const action = typeof args.action === 'string' ? args.action : '';
    const repo = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskId);
    const coordination = buildCoordinationCapability({
      env,
      db,
      holder: {
        tenantId,
        executionId,
        label: agentLabel,
        taskId,
        repoSlug: repo.ok ? `${repo.ctx.owner}/${repo.ctx.repo}` : '',
        branch: repo.ok ? repo.ctx.branch : '',
        scopeKey: coordinationScopeKey(taskId),
      },
    });
    let result: Record<string, unknown>;
    try {
      if (action === 'claim') {
        const resource = typeof args.resource === 'string' ? args.resource : '';
        if (!resource.trim()) return { status: 200, body: { ok: false, error: 'resource is required' } };
        result = await coordination.claim(resource, {
          mode: args.mode === 'shared' ? 'shared' : 'exclusive',
          reason: typeof args.reason === 'string' ? args.reason : undefined,
        }) as unknown as Record<string, unknown>;
      } else if (action === 'release') {
        const resource = typeof args.resource === 'string' ? args.resource : '';
        if (!resource.trim()) return { status: 200, body: { ok: false, error: 'resource is required' } };
        result = await coordination.release(resource) as unknown as Record<string, unknown>;
      } else if (action === 'note') {
        const key = typeof args.key === 'string' ? args.key : '';
        const content = typeof args.content === 'string' ? args.content : '';
        if (!key.trim() || !content.trim()) return { status: 200, body: { ok: false, error: 'key and content are required' } };
        result = await coordination.postNote(key, content) as unknown as Record<string, unknown>;
      } else if (action === 'read') {
        result = await coordination.readNotes(
          typeof args.query === 'string' ? args.query : undefined,
          typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : undefined,
        ) as unknown as Record<string, unknown>;
      } else {
        return { status: 200, body: { ok: false, error: `unknown coordinate action '${action}'` } };
      }
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: `coordinate.${action || 'unknown'}`, category: 'tool', detail: args,
      result: JSON.stringify(result).slice(0, 300),
    });
    return { status: 200, body: result };
  },

  /**
   * `spawn` — delegation from an IMAGE surface (capability `orchestrate`).
   *
   * The child RUN happens HERE, in the Worker, and that is deliberate. An image holds
   * no gateway credential, no meter and no tool registry, so a nested loop inside the
   * container process would have to reimplement all three — a third copy of exactly
   * what the shared relay module exists to prevent. Relaying instead means a sub-agent
   * spawned from a container is the SAME sub-agent the durable surface spawns:
   * `runSubagent` from the shared kernel, the same budget, the same withheld
   * capabilities, the same timeline event, the same tenant meter.
   *
   * The child's ceiling is NOT the parent's set verbatim — see `imageHostedChildCeiling`
   * for why a Worker-hosted child cannot hold the image's `shell`.
   *
   * This op blocks for as long as the child runs, which is why it heartbeats the
   * execution first: the image's own heartbeat timer keeps beating throughout, but the
   * op can outlast an LLM turn, and a delegation must never look like a dead run.
   */
  spawn: async (deps) => {
    const { env, db, ctx, executionId, args, surface, tenantId, taskId, projectId, cloudAgentRef, agentLabel, model, taskRow, engine } = deps;
    const task = typeof args.task === 'string' ? args.task.trim() : '';
    if (!task) return { status: 200, body: { ok: false, error: 'task is required — the child sees none of your conversation' } };
    const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim() : task.slice(0, 60);
    const readOnly = args.read_only !== false;
    if (await isExecutionCancelled(db, executionId)) {
      return { status: 200, body: { ok: false, error: 'this run was cancelled; do not delegate, just stop' } };
    }
    await heartbeatExecution(db, executionId);
    const repo = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskId);
    // The ceiling the CHILD is measured against, and the backing it runs on. The
    // child's own writes go through the Worker's git-API provider — the same writer the
    // durable surface uses — so a file a child commits lands on the ticket branch the
    // image is cloned from, exactly like one the image wrote through the `write` op.
    const parentCaps = imageHostedChildCeiling(CONTAINER_SURFACE_CAPS);
    const spawnWrittenPaths = new Set<string>();
    const provider = engine.buildCloudProvider({
      env, db, tenantId, projectId, executionId, taskRow, agentLabel, cloudAgentRef,
      repoCtx: repo.ok ? repo.ctx : null,
      repoMiss: repo.ok ? '' : repo.reason,
      writtenPaths: spawnWrittenPaths,
      capabilities: parentCaps,
    });
    const orchestration = buildOrchestrationCapability({
      parentCaps,
      provider,
      registry: cloudToolRegistry,
      complete: async ({ messages: childMessages, tools }) => {
        // Cancel BEFORE the paid call, on every child turn. The image polls cancel from
        // its own loop, but it is blocked on this op for the whole delegation — so
        // without this, stopping a run would leave its sub-agent spending to the end of
        // its budget. The kernel reads a failed turn as the end of the child.
        if (await isExecutionCancelled(db, executionId)) {
          return { failed: 'the run was cancelled while this sub-agent was working' };
        }
        const childTurn = await engine.imageRunTurn(
          { env, db, ctx, executionId, tenantId, projectId, taskId, cloudAgentRef, model },
          // `notify: false` — a child's turns are an implementation detail of one
          // parent tool call, not messages the run's subscribers should see.
          { messages: childMessages, tools, notify: false },
        );
        if (!childTurn.ok) return { failed: childTurn.error };
        return { content: childTurn.content, toolCalls: readOpenAiToolCalls({ tool_calls: childTurn.toolCalls }) };
      },
      record: async (event) => {
        await recordCloudToolEvent(db, {
          tenantId, cloudAgentRef, executionId,
          toolName: 'agent.subagent', category: 'tool', detail: event.detail, result: event.result,
        });
      },
    });
    const result = await orchestration.spawn({ task, label, readOnly });
    await heartbeatExecution(db, executionId);
    // A child's writes are the RUN's writes. The provider already did the Worker-side
    // bookkeeping (the commit, the `task_file_changes` row, the subscriber notify), but
    // the image owns the `writtenPaths` its own `finalize` reports — so hand them back
    // and let it merge them, or the PR would list every file except the ones the
    // sub-agent wrote.
    return { status: 200, body: { ...result, label, writtenPaths: [...spawnWrittenPaths] } };
  },
  llm: async (deps) => {
    const { env, db, ctx, executionId, args, surface, tenantId, taskId, projectId, cloudAgentRef, model, engine } = deps;
    const messages = Array.isArray(args.messages) ? (args.messages as unknown as Array<Record<string, unknown>>) : ([] as Array<Record<string, unknown>>);
    // Cooperative cancel BEFORE the paid call (GAP-S6). The container polls the
    // cancel/heartbeat ops from its own loop, but its NEXT turn arrives here — so
    // without this check a cancelled run still bought one more completion. The image
    // already stops on `cancelled` in this op's reply (its turn handler breaks on it).
    if (await isExecutionCancelled(db, executionId)) {
      return { status: 200, body: { cancelled: true, content: '', toolCalls: [], error: 'this run was cancelled' } };
    }
    // Mid-run steering for the long-lived container: drain user follow-ups posted
    // since the last step and INJECT them into this turn's messages server-side, so
    // the steer reaches the model immediately — even on a container image that
    // predates steering support (no redeploy required). They are also returned in
    // `steering` so a steering-aware container persists them into its own loop state
    // for subsequent turns; the injection here is deduped by text so that does not
    // double them. Each steer is drained exactly once (consumed_at stamped).
    const steering = await applyPendingSteering(db, { tenantId, cloudAgentRef, executionId, messages });
    // Compress the conversation BEFORE the paid call so a long container run never
    // re-sends a ballooning history. The container owns its loop state, so the
    // compacted messages are RETURNED below for it to adopt — otherwise it would
    // re-send (and re-summarize) the full history every turn.
    const compaction = await compactMessages(messages, CLOUD_COMPACT_DEFAULTS, buildGatewaySummarizer(env));
    const sendMessages = compaction.compacted ? compaction.messages : messages;
    if (compaction.compacted) {
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'context.compacted', category: 'llm',
        detail: { beforeTokens: compaction.beforeTokens, afterTokens: compaction.afterTokens, summarized: compaction.summarized, droppedMessages: compaction.droppedMessages },
        result: `compressed ~${compaction.beforeTokens} → ~${compaction.afterTokens} tokens (${compaction.summarized ? 'builder-memory summary' : 'elided'})`,
      });
    }
    const tGen0 = Date.now();
    // Route through the tenant's plan pool/key (not the fixed free pool) and apply
    // the shared cloud model rule: explicit pick = hard pin, else the plan's best
    // coding model. The container holds its own loop state, so per-op pinning is
    // the caller's explicit `model`; the default lands on a strong coding model.
    // Repo/shell tools + the curated platform subset (create tasks / update OKRs /
    // read remaining) — parity with the durable loop. The container relays each
    // `builtin_*` call back via the `platform_tool` op below (it has no DB).
    // …narrowed to what the CALLING IMAGE says it can dispatch. The image sends its
    // own tool manifest on every `llm` op, so a capability can be advertised the moment
    // its Worker-side op exists instead of having to wait for every image to be rebuilt
    // and deployed first — an older image simply does not name the new tool and is never
    // offered it. See `imageToolHandshake.ts` for the rule this replaced.
    const containerTools = imageAdvertisedTools(
      [...CONTAINER_AGENT_TOOLS, ...cloudAgentPlatformToolSchemas(ctx.originatingChatId)],
      readToolManifest(args.supportedTools),
    );
    // ONE metered turn, through the primitive the `spawn` op's child also uses — so a
    // sub-agent commissioned from an image surface is routed, funded, metered and
    // attributed exactly like the parent turn that commissioned it.
    const turn = await engine.imageRunTurn(
      { env, db, ctx, executionId, tenantId, projectId, taskId, cloudAgentRef, model },
      { messages: sendMessages, tools: containerTools, notify: true, tGen0 },
    );
    // Heartbeat: a live container keeps the run out of the orphan reaper.
    await heartbeatExecution(db, executionId);
    if (!turn.ok) return { status: 200, body: { error: turn.error, ...(turn.code ? { code: turn.code } : {}) } };
    return { status: 200, body: {
      content: turn.content, toolCalls: turn.toolCalls, steering,
      // When the history was compacted, hand the container the compacted form so it
      // adopts it as its new loop state (and doesn't re-send the full history next turn).
      ...(compaction.compacted ? { compactedMessages: compaction.messages } : {}),
      cancelled: await isExecutionCancelled(db, executionId),
    } };
  },

  /**
   * `ask_human` — the image is BLOCKED and is handing the run back to a human.
   *
   * ── WHY EXIT-AND-REDISPATCH, NOT BLOCK-AND-POLL ────────────────────────────
   * Block-and-poll (the image sits in a loop asking "answered yet?") loses on every
   * axis for this runtime. The container process holds a whole Linux box and a
   * cloned repo; a question asked on a Friday is answered on Monday, so blocking
   * bills a live container for three idle days and still dies the moment the
   * platform recycles the image — and when it dies mid-poll it has no way to report
   * anything, so the run is orphan-reaped with an inaccurate failure. The GitHub
   * Actions runner cannot block at all: a job has a hard wall-clock limit and the
   * minutes are the tenant's.
   *
   * Exit-and-redispatch inverts all of it. The image posts THIS op with its
   * conversation, the Worker persists that conversation, opens the question and
   * parks the row in `paused`, and the process exits cleanly WITHOUT a terminal op
   * — so nothing is billed while the question waits and the run is not marked
   * failed. When a human answers, `resumePausedExecution` starts a fresh process
   * seeded with the same conversation. The repo state survives because the image
   * commits every file through the `write` op onto the ticket branch, so a fresh
   * clone of that branch IS the work in progress; only the conversation had to be
   * carried, and that is exactly what this op carries.
   *
   * The approval, the needs-attention lane routing and the resume record all go
   * through the SAME primitive the durable surface uses, so a paused run means the
   * same thing on every surface.
   */
  ask_human: async (deps) => {
    const { env, db, executionId, args, surface, tenantId, taskId, projectId, cloudAgentRef, agentLabel, model, runtimeService } = deps;
    const question = typeof args.question === 'string' ? args.question.trim() : '';
    if (!question) return { status: 200, body: { ok: false, error: 'question is required to ask a human' } };
    const context = typeof args.context === 'string' && args.context.trim() ? args.context.trim() : undefined;
    // Cancelled mid-thought: do not open a question nobody can act on — tell the
    // image to stop, and let its normal cancelled finalize run.
    if (await isExecutionCancelled(db, executionId)) {
      return { status: 200, body: { ok: false, cancelled: true, error: 'this run was cancelled; do not ask, just stop' } };
    }
    // Freeze the conversation with its tool-call pairing CLOSED. The image posts
    // this op from inside its tool handler, so the `ask_human` call has no result
    // yet — and any sibling call the model emitted alongside it never runs, because
    // the loop stops here. Either dangling call would 400 the resumed run's first
    // LLM step, i.e. the moment a human finally answered.
    const loopState = coercePausedLoopState(args);
    if (loopState) {
      loopState.messages = withPausedToolResults(loopState.messages, {
        ...(typeof args.toolCallId === 'string' ? { askToolCallId: args.toolCallId } : {}),
        toolCallIds: Array.isArray(args.toolCallIds) ? (args.toolCallIds as unknown[]).filter((id): id is string => typeof id === 'string') : [],
      });
    }
    const { approvalId } = await pauseExecutionForQuestion(env, db, {
      tenantId, executionId, taskId, projectId,
      ...(cloudAgentRef ? { cloudAgentRef } : {}),
      agentLabel, question, ...(context ? { context } : {}),
      surface,
      loopState,
    });
    // Park the row. Raw update (not `runtimeService.update`) for the same reason
    // CloudRunnerDO does it: `paused` is a non-terminal hold, not a lifecycle
    // transition with lane/metric consequences.
    await db.update(executions).set({ status: 'paused', updatedAt: new Date() })
      .where(eq(executions.id, executionId))
      .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgent/containerOps.ts", operation: "handleContainerOp", context: { logMessage: '[cloud-container] pause transition failed', details: { tenantId, executionId, error } } }));
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef, executionId,
      toolName: 'ask_human', category: 'tool',
      detail: { question, context: context ?? null, surface },
      result: `Paused on a human question (approval ${approvalId}).`,
    });
    // Narrate the pause — WITH the question — into the ticket's linked Brain chats,
    // keyed by approval id so a repeat pause narrates once per Q&A cycle. Parity
    // with the durable surface's pause milestone.
    await runtimeService.postLifecycleMilestoneById(executionId, 'paused', {
      questionText: question, eventNonce: approvalId,
    });
    const updated = await runtimeService.getExecution(executionId).catch(() => null);
    if (updated) notifyExecutionSubscribers(executionId, { type: 'status_change', executionId, status: updated.status, execution: updated.toPlain(), ts: new Date().toISOString() });
    return { status: 200, body: { ok: true, paused: true, approvalId, note: PAUSED_TOOL_RESULT_NOTE } };
  },
  write: async (deps) => {
    const { env, db, ctx, executionId, args, surface, tenantId, taskId, cloudAgentRef, agentLabel } = deps;
    const path = typeof args.path === 'string' ? args.path : '';
    const content = typeof args.content === 'string' ? args.content : '';
    const isNew = args.isNew !== false;
    if (!path || !content) return { status: 200, body: { ok: false, error: 'path and content are both required' } };
    const repo = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskId);
    if (!repo.ok) return { status: 200, body: { ok: false, error: `no repo bound to this task (${repo.reason}); include the file contents in your final summary instead` } };
    // MULTI-REPO SPANNING (0956): route this path to the repo in the task's set
    // whose pathGlobs claim it. Single-repo tasks resolve to `repo.ctx` unchanged.
    const router = await resolveTaskRepoRouter(db, gitSecret(env), tenantId, taskId, { ctx: repo.ctx, reason: '' })
      .catch(() => null);
    const target = router?.forPath(path) ?? repo.ctx;
    // The container writes through the Worker rather than through the capability
    // provider, so it must take the SAME implicit lease the durable surface takes —
    // otherwise a container run and a durable run on one ticket are unsynchronised.
    const blocked = await claimWriteLease({
      env, db, path,
      holder: {
        tenantId, executionId, label: agentLabel, taskId,
        repoSlug: `${repo.ctx.owner}/${repo.ctx.repo}`,
        branch: repo.ctx.branch,
        scopeKey: coordinationScopeKey(taskId),
      },
      reason: typeof args.summary === 'string' && args.summary ? `writing: ${args.summary}` : 'writing this file',
      onRefused: (p, heldBy) => {
        void recordCloudToolEvent(db, {
          tenantId, cloudAgentRef, executionId,
          toolName: 'coordination.refused', category: 'tool',
          detail: { path: p, heldBy }, result: `write to '${p}' refused — held by ${heldBy}`,
        }).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgent/containerOps.ts", operation: "blocked", context: { logMessage: '[cloud-container] coordination refusal telemetry failed', details: { tenantId, executionId, taskId, path: p, error } } }));
      },
    });
    if (blocked) return { status: 200, body: { ok: false, error: blocked } };
    const commit = await commitAgentFile(target, path, content, agentCommitMessage(isNew ? 'Add' : 'Update', path, taskId, agentLabel));
    if (!commit.ok) return { status: 200, body: { ok: false, error: commit.reason } };
    await recordRepoWrite(db, tenantId, taskId, target);
    // Label from whether the path actually existed in the repo (commit.existed),
    // not the caller's `isNew` hint — that defaults to true and mislabels edits as "created".
    const change = commit.existed ? 'modified' : 'created';
    await recordTaskFileChange(db, tenantId, taskId, executionId, path, change, agentLabel);
    notifyExecutionSubscribers(executionId, { type: 'file_change', executionId, path, change, ts: new Date().toISOString() });
    await recordCloudToolEvent(db, { tenantId, cloudAgentRef, executionId, toolName: 'write_file', category: 'tool', detail: { path, summary: args.summary }, result: `committed to ${target.owner}/${target.repo}@${target.branch}` });
    return { status: 200, body: { ok: true, branch: target.branch, repo: `${target.owner}/${target.repo}`, commitUrl: commit.commitUrl } };
  },
  finalize: async (deps) => {
    const { env, db, ctx, executionId, args, surface, tenantId, taskId, cloudAgentRef, agentLabel, taskRow, engine, runtimeService } = deps;
    const writtenPaths = new Set<string>(Array.isArray(args.writtenPaths) ? (args.writtenPaths as unknown[]).filter((p): p is string => typeof p === 'string') : []);
    const finalOutput = typeof args.finalOutput === 'string' ? args.finalOutput : '';
    const cancelled = args.cancelled === true || (await isExecutionCancelled(db, executionId));
    const repo = await resolveTicketRepoContext(db, gitSecret(env), tenantId, taskId);
    const repoCtx = repo.ok ? repo.ctx : null;
    const repoMiss = repo.ok ? '' : repo.reason;
    // The container runs its OWN loop, so it never reaches the durable loop's terminal
    // release — without this, every file a finished container run wrote stays locked
    // until its lease lapses (15 min), blocking a peer agent on the same ticket for no
    // reason. This is that surface's equivalent of the release in `runCloudToolLoop`.
    await releaseAllForExecution(env, db, tenantId, executionId, coordinationScopeKey(taskId));
    const fin = await engine.finalizeCloudRun(env, db, { tenantId, cloudAgentRef, executionId, taskRow, agentLabel, repoCtx, repoMiss, writtenPaths, finalOutput, cancelled });
    if (!cancelled) {
      await runtimeService.update(executionId, fin.ok ? { status: ExecutionStatus.COMPLETED, result: fin.output } : { status: ExecutionStatus.FAILED, errorMessage: fin.output })
        .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgent/containerOps.ts", operation: "handleContainerOp", level: 'warning', context: { logMessage: '[cloud-container] terminal transition rejected', details: { tenantId, executionId, error } } }));
      const updated = await runtimeService.getExecution(executionId).catch(() => null);
      if (updated) notifyExecutionSubscribers(executionId, { type: 'done', executionId, status: updated.status, execution: updated.toPlain(), ts: new Date().toISOString() });
    }
    // Learned Model Routing: container-surface terminal chokepoint (covers the
    // cancelled finalize too — the row is already CANCELLED). Idempotent/best-effort.
    await scoreRunOutcome(env, db, { executionId }).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgent/containerOps.ts", operation: "handleContainerOp", context: { logMessage: '[cloud-container] terminal outcome scoring failed', details: { tenantId, executionId, error } } }));
    return { status: 200, body: { ok: fin.ok, output: fin.output } };
  },
  fail: async (deps) => {
    const { env, db, executionId, args, surface, tenantId, runtimeService } = deps;
    // The container caught its own crash mid-loop and is reporting the REAL reason
    // (vs. finalize, which implies an orderly finish). Recover it like any other
    // backplane crash: self-heal once on the durable executor, else fail carrying
    // this reason so the timeline says exactly what broke.
    const detail = typeof args.error === 'string' && args.error.trim() ? args.error.trim() : 'container run error';
    const outcome = await handleCloudRunCrash(env, db, executionId, cloudCrashReason(detail));
    if (outcome === 'ineligible') {
      const updated = await runtimeService.getExecution(executionId).catch(() => null);
      if (updated) notifyExecutionSubscribers(executionId, { type: 'done', executionId, status: updated.status, execution: updated.toPlain(), ts: new Date().toISOString() });
      // Terminal FAILURE with no PR to protect — sweep the ticket branch this run
      // half-wrote, subject to the same shared safety decision the cancel path
      // uses (never the default branch, never under an open PR, never a branch
      // carrying commits this run did not author). Best-effort.
      await teardownCrashedRunArtifacts(env, db, { executionId, secret: gitSecret(env) })
        .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgent/containerOps.ts", operation: "handleContainerOp", context: { logMessage: '[cloud-container] crashed-run artifact teardown failed', details: { tenantId, executionId, error } } }));
      // Terminal (no self-heal requeue) — score the failed run. A requeue defers
      // scoring to the durable surface's terminal chokepoint instead.
      await scoreRunOutcome(env, db, { executionId }).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgent/containerOps.ts", operation: "handleContainerOp", context: { logMessage: '[cloud-container] failed-run outcome scoring failed', details: { tenantId, executionId, error } } }));
    }
    return { status: 200, body: { ok: true, recovered: outcome === 'requeued' } };
  },
};

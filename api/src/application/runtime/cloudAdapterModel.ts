/**
 * cloudAdapterModel — the cloud run's `ModelTransport` (PRD 35 WS3): where the model runs.
 *
 * It is the metered gateway call and nothing else. The agent decides WHICH model, WHETHER to
 * re-ask and WHAT to say; this port sends one request through the tenant's plan proxy and
 * reports what answered. Around that single call it does the cloud's host work:
 *   • the run's containment check (declared limits + the A2 token cap) BEFORE the paid call —
 *     a contained run fails with the named reason, as it always did;
 *   • sampling, the D5 output cap and the reasoning levers of a hard-pinned model;
 *   • usage metering, the trace row and the `llm.complete` timeline events
 *     (`cloudAgent/cloudLlmTurn.recordCloudLlmTurn`), one per answered request;
 *   • a gateway failure as a `ModelTransportError` carrying its HTTP status, which the
 *     model policy routes around (a released pin, the cascade) — the port never decides that.
 */
import { readOpenAiToolCalls } from '@builderforce/agent-loop';
import { ModelTransportError, toolsTokensOf, type ModelCompletion, type ModelRequest, type ModelTransport, type RunMessage } from '@builderforce/agent-run';
import { isModelRole, type AgentExecParams } from '@builderforce/agent-tools';
import type { ModelFallbackSurface } from '@builderforce/agent-stall';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { ChatMessage, LlmProxyService } from '../llm/LlmProxyService';
import { reasoningParamsForModel } from '../llm/reasoningCapability';
import { catalogEntry } from '../llm/vendors/registry';
import { recordCloudLlmTurn } from './cloudAgent/cloudLlmTurn';
import type { CloudRouting } from './cloudAgent/routing';
import { cloudReasoningExecParams } from './costLoop/runLevers';
import type { CostLoopSession } from './costLoop/costLoopSession';
import type { RunLimits } from '../../domain/containment/runLimits';

export interface CloudModelPortArgs {
  env: Env;
  db: Db;
  proxy: LlmProxyService;
  run: { tenantId: number; projectId: number; taskId: number; executionId: number; meterExecutionId: number; cloudAgentRef?: string };
  routing: CloudRouting;
  /** The role the parent loop is billed as when a request names none. */
  runRole: string;
  /** The run-start pick: the degraded-model comparison is against this, not the just-locked model. */
  pickedModel: string;
  /** Caller-configured sampling — outranks the personality-derived temperature. */
  genParams: { temperature?: number; topP?: number; maxTokens?: number };
  execParams?: AgentExecParams;
  /** The A2 / declared-limit containment session; its totals ride the cursor between ticks. */
  cost: CostLoopSession;
  declaredLimits: Pick<RunLimits, 'maxFiles' | 'maxRepositories' | 'maxSpendMillicents'> | undefined;
  /** What the run has changed so far — the footprint the containment check reads. */
  footprint: () => { files: number; repositories: number };
  /** The agent's task state, rendered — a contained run tells a follow-up where to resume. */
  progress: () => string;
  /** The models a stalled run may fail over onto (the tenant's connected flagships, the coding pool). */
  fallbackSurface: ModelFallbackSurface | null;
  /** The first step this invocation runs (the kernel's absolute step on a resume). */
  startStep: number;
}

/** A transcript row in the gateway's OpenAI chat shape. */
export function toGatewayMessage(m: RunMessage): Record<string, unknown> {
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: m.content,
      tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
    };
  }
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  return { role: m.role, content: m.content };
}

/** The fields the gateway routes by, from the request the model policy built. */
function routingFields(request: ModelRequest): Record<string, unknown> {
  return {
    ...(request.role ? { role: request.role } : {}),
    ...(request.tools && request.tools.length > 0 ? { tool_choice: request.toolChoice ?? 'auto' } : {}),
    ...(request.model ? { model: request.model, ...(request.strict ? { modelStrict: true } : {}) } : {}),
    ...(request.excludeModels && request.excludeModels.length > 0 ? { excludeModels: request.excludeModels } : {}),
  };
}

/** The transport, plus what answered the latest turn (the guards' cascade record reads it). */
export interface CloudModelPort extends ModelTransport {
  servedModel(): string | undefined;
  /** The step the next request will be (the Worker surface's steering reads it between steps). */
  currentStep(): number;
  /**
   * A gateway failure the model policy did not route around ends the run: THEN it is metered and recorded, once,
   * exactly as the old engine recorded its final result — a failed first attempt that was re-asked never was.
   * Returns the gateway's error text for the run's output, or undefined when nothing failed.
   */
  flushFailure(): Promise<string | undefined>;
}

export function cloudModelPort(a: CloudModelPortArgs): CloudModelPort {
  let step = a.startStep;
  let served: string | undefined;
  let pending: (() => Promise<string | undefined>) | undefined;
  const { run } = a;

  return {
    servedModel: () => served,
    currentStep: () => step,
    window: (model) => catalogEntry(model)?.contextWindow,
    fallbackSurface: () => a.fallbackSurface,
    flushFailure: async () => {
      const flush = pending;
      pending = undefined;
      return flush ? flush() : undefined;
    },

    async complete(request, signal): Promise<ModelCompletion> {
      // A failed attempt the policy re-asked is dropped: the retry is the turn.
      pending = undefined;
      // Containment first: a run over its declared limits (or its token cap) buys no further turn. Never routable —
      // the router must not re-ask, and no transport failure is recorded against the model.
      const { files, repositories } = a.footprint();
      const contained = await a.cost.beforeTurn(step, a.declaredLimits, files, repositories, a.progress());
      if (contained) throw new ModelTransportError(contained, undefined, { routable: false });

      const messages = request.messages.map(toGatewayMessage);
      const tools = request.tools && request.tools.length > 0 ? request.tools : undefined;
      const roleName = request.role ?? a.runRole;
      const role = isModelRole(roleName) ? roleName : undefined;
      const temperature = a.genParams.temperature ?? a.execParams?.temperature;
      // The operator-configured cap outranks the role's (D5); a tool-less synthesis keeps the agent's own bound.
      const cap = a.cost.turnFields(a.genParams.maxTokens);
      const tGen0 = Date.now();
      const result = await a.proxy.complete(
        {
          messages: messages as unknown as ChatMessage[],
          ...(tools ? { tools } : {}),
          ...routingFields(request),
          ...(temperature != null ? { temperature } : {}),
          ...(a.genParams.topP != null ? { top_p: a.genParams.topP } : {}),
          ...(cap.max_tokens != null ? cap : !tools && request.maxTokens != null ? { max_tokens: request.maxTokens } : {}),
          // Reasoning levers ride a hard pin only, so they never reach a cascade vendor that would 400 on an unknown key.
          ...(request.strict && request.model
            ? reasoningParamsForModel(request.model, cloudReasoningExecParams(a.env, run.tenantId, { ...a.execParams, ...request.reasoning } as AgentExecParams, roleName), {
                isFirstTurn: !request.messages.some((m) => m.role === 'assistant'),
              }) ?? {}
            : {}),
          useCase: 'task_execution',
          prompt_cache_key: `cloud:${run.executionId}`,
        } as never,
        undefined,
        undefined,
        signal,
      );
      // Shared post-`complete` processing (metering + `llm.complete`/degraded/agent.message telemetry) — identical to the container `llm` op.
      const record = async (): Promise<Awaited<ReturnType<typeof recordCloudLlmTurn>>> => {
        await a.cost.recordTurn(result);
        return recordCloudLlmTurn(result, {
          env: a.env, db: a.db, tenantId: run.tenantId, cloudAgentRef: run.cloudAgentRef, executionId: run.meterExecutionId, taskId: run.taskId, projectId: run.projectId,
          requestedModel: a.pickedModel, fallbackModel: request.model,
          effectivePlan: a.routing.effectivePlan, premiumOverride: a.routing.premiumOverride,
          role,
          phase: request.phase as never,
          turnInput: { messages, tools: tools ?? [] } as never, toolSchemaTokens: toolsTokensOf(tools ?? []),
        }, { tGen0, step, notify: false });
      };
      const status = result.response.status;
      if (status >= 400) {
        pending = async () => {
          const failed = await record();
          return failed.ok ? undefined : failed.error;
        };
        throw new ModelTransportError(`the gateway answered ${status}`, status);
      }
      const turn = await record();
      if (!turn.ok) throw new ModelTransportError(turn.error);

      step += 1;
      served = turn.resolvedModel;
      const usage = result.usage;
      return {
        content: turn.content,
        toolCalls: readOpenAiToolCalls({ tool_calls: turn.toolCalls }),
        model: turn.resolvedModel,
        ...(usage ? { usage: { inputTokens: usage.promptTokens, outputTokens: usage.completionTokens, ...(usage.cacheReadTokens != null ? { cacheReadTokens: usage.cacheReadTokens } : {}) } } : {}),
      };
    },
  };
}

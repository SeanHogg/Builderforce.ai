/**
 * The addressed-agent reply's RUN — the cloud adapter's second caller of the one agent
 * (PRD 35 WS3). An @-reply is the same agent as a ticket run with `toolScope: 'chat-reply'`: it
 * answers AS an invited agent over the curated platform tools, with no repo and no sandbox.
 * This file builds only PORTS:
 *
 *   model      — one gateway turn, billed and traced under the reply's call context
 *                (`completeTraced`), noting which model/vendor/account served it;
 *   extensions — the reply's toolset (platform + chat-scoped tools, executed via
 *                `callBuiltinTool` with the TRIGGERING USER's role, plus the terminal `ask_user`);
 *   events     — the buffered step trace persisted once at the end of the turn.
 *
 * The stall ladder, the forced no-tools synthesis, compaction and the model hand-off are the
 * agent's (`policy/*`) — this replaces the bespoke loop in the retired `agentReplyLoop.ts`.
 */
import { ASK_USER_TOOL, askUserBlock, readOpenAiToolCalls, type StepRowInput } from '@builderforce/agent-loop';
import {
  ModelTransportError, createCompactionHook, runAgent,
  type ModelCompletion, type ModelTransport, type RunEvent, type RunPolicy, type ToolExtension,
} from '@builderforce/agent-run';
import { fileToolKind, type ToolSchema } from '@builderforce/agent-tools';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { buildGatewaySummarizer } from '../llm/gatewaySummarizer';
import { callBuiltinTool } from '../llm/builtinMcpService';
import { codingFallbackSurface } from '../llm/codingFallbackSurface';
import { readProxyChoice, type LlmProxyService } from '../llm/LlmProxyService';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { requestedModelForRole } from '../runtime/cloudAgent/routing';
import { applyVerifyPhase, commitRunMemory, describeVerifyOutcome, recordRunVerifyEvents, runVerifyPhase } from '../runtime/cloudAgent/runEndMemory';
import { toGatewayMessage } from '../runtime/cloudAdapterModel';
import { completeTraced, type BrainCallContext } from './brainLlmCall';
import type { AgentReplyToolset } from './agentReplyPrompt';
import { readByoFunded, readModel, readVendor, type ReplyTurnState } from './agentReplyState';

export interface AgentReplyRunInput {
  db: Db;
  env: Env;
  tenantId: number;
  userId: string;
  chatId: number;
  agentRef: string;
  agentName: string;
  opts?: { role?: string; authToken?: string | null; executionCtx?: ExecutionContext };
  service: LlmProxyService;
  /** The reply's opening rows: the persona system prompt, then the conversation. Rewritten with the run's transcript so the Evermind regeneration sees the tool exchange. */
  convo: Array<Record<string, unknown>>;
  toolset: AgentReplyToolset;
  userRequest: string;
  replyTemp: number;
  pinnedModel: string | undefined;
  byoVendors: ReadonlySet<string>;
  plan: { effectivePlan: 'free' | 'pro' | 'teams'; premiumOverride: boolean };
  call: BrainCallContext;
}

const textOf = (row: Record<string, unknown> | undefined): string => (typeof row?.content === 'string' ? row.content : '');

export async function runAgentReply(input: AgentReplyRunInput): Promise<ReplyTurnState> {
  const { db, env, tenantId, userId, agentRef, opts, service, convo, userRequest, replyTemp, pinnedModel, byoVendors, call } = input;
  const { tools, nameToTool } = input.toolset;
  const verifyPin = requestedModelForRole(env, 'verify');
  let wroteFiles = false;

  const s: ReplyTurnState = {
    text: '', lastModel: pinnedModel ?? '', lastVendor: '', lastByoFunded: false, lastFinish: '',
    byoFailure: null, toolCallCount: 0, iterations: 0, policy: undefined as never, trace: [],
  };
  /** Buffer a step, stamped with the instant it actually happened. */
  const record = (step: Omit<StepRowInput, 'ts'>): void => { s.trace.push({ ...step, ts: new Date().toISOString() }); };
  /** The CATALOG id a call dispatches to — what a reader greps for; a name the model invented lands verbatim. */
  const toolIdOf = (name: string): string => nameToTool.get(name) ?? name;

  // The connected-account attempt's failure: a silent cascade off the tenant's OWN account is SURFACED.
  const noteServed = (r: unknown): void => {
    const failovers = (r as { failovers?: Array<{ vendor?: string; code?: number; detail?: string }> } | undefined)?.failovers;
    const f = failovers?.find((x) => x.vendor && byoVendors.has(x.vendor));
    if (f?.vendor) s.byoFailure = { vendor: f.vendor, code: f.code ?? 0, ...(f.detail ? { detail: f.detail } : {}) };
    s.lastModel = readModel(r) || s.lastModel;
    s.lastVendor = readVendor(r) || s.lastVendor;
    s.lastByoFunded = readByoFunded(r);
  };

  const model: ModelTransport = {
    // The models this reply may fail over ONTO: the tenant's connected flagships and the plan's curated coding pool.
    fallbackSurface: () => codingFallbackSurface(byoVendors, input.plan.effectivePlan, input.plan.premiumOverride),
    async complete(request): Promise<ModelCompletion> {
      s.iterations += 1;
      const result = await completeTraced(db, service, {
        ...(request.model ? { model: request.model } : {}),
        ...(request.role ? { role: request.role } : {}),
        ...(request.excludeModels && request.excludeModels.length > 0 ? { excludeModels: request.excludeModels } : {}),
        prompt_cache_key: `brain-reply:${tenantId}:${agentRef}`,
        messages: request.messages.map(toGatewayMessage) as never,
        ...(request.tools && request.tools.length > 0 ? { tools: request.tools, ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}) } : {}),
        temperature: replyTemp,
        max_tokens: request.tools && request.tools.length > 0 ? 1200 : request.maxTokens ?? 1000,
      } as never, call);
      noteServed(result);
      const status = (result as { response?: { status?: number } }).response?.status ?? 200;
      if (status >= 400) throw new ModelTransportError(`the gateway answered ${status}`, status);
      // ProxyResult.response is an HTTP Response — the body MUST be parsed (readProxyChoice).
      const { content, toolCalls, finishReason } = await readProxyChoice(result);
      s.lastFinish = finishReason || s.lastFinish;
      // The MODEL turn itself, recorded whether or not it called anything: a turn with `toolCalls: 0` and prose that
      // merely names tools is the announced-but-untaken stall, indistinguishable from failed tools without this row.
      const advertised = request.tools?.length;
      record({
        category: 'llm', label: readModel(result) || s.lastModel || '(gateway default)', finishReason, textChars: content.length,
        ...(advertised === undefined ? { args: { synthesis: true } } : {}),
        result: {
          finishReason, toolCalls: toolCalls.length, toolNames: toolCalls.map((tc) => tc.function.name), replyChars: content.length,
          ...(advertised !== undefined ? { advertisedTools: advertised } : {}),
        },
      });
      return {
        content,
        toolCalls: readOpenAiToolCalls({ tool_calls: toolCalls }),
        model: readModel(result),
      };
    },
  };

  const extensions: ToolExtension = {
    schemas: () => tools as unknown as ToolSchema[],
    handles: (name) => name === ASK_USER_TOOL || nameToTool.has(name),
    // `ask_user` is a TERMINAL turn: the agent is blocked on the user's decision, so the reply IS the lead-in prose plus the
    // canonical ```ask-user block the UI renders as a clickable card — and the turn's sibling calls never dispatch. A malformed
    // ask with prose settles on the prose; one with neither reaches `dispatch` for the corrective result.
    terminalTurn(turn, calls) {
      const ask = calls.find((call) => call.name === ASK_USER_TOOL);
      if (!ask) return undefined;
      let block: string | null = null;
      try { block = ask.malformed ? null : askUserBlock(ask.args); } catch { block = null; }
      const lead = turn.content.trim();
      if (block) return lead ? `${lead}\n\n${block}` : block;
      return lead || undefined;
    },
    async dispatch(name, args) {
      if (name === ASK_USER_TOOL) {
        return { data: { error: 'ask_user needs { question, options:[{label}] } with 2+ options. Retry or answer in prose.' }, isError: true };
      }
      try {
        const out = await callBuiltinTool(db, {
          tenantId, tool: toolIdOf(name), arguments: args, env,
          userId, role: opts?.role as never, authToken: opts?.authToken, executionCtx: opts?.executionCtx,
          // The reply IS this agent acting: the ref is what lets a tool act "as me" and credits a replayed write to the agent.
          agentRef,
        });
        return { data: out };
      } catch (e) {
        return { data: { error: e instanceof Error ? e.message : 'tool call failed' }, isError: true };
      }
    },
  };

  const policy: RunPolicy = {
    entryPoint: 'cloud', toolScope: 'chat-reply', role: 'chat', levers: [], budgets: {},
    // A stall with nothing left to try posts what the reply said and why it stopped.
    stallExhausted: 'finish',
    inference: 'hybrid', verify: 'none', approvalGates: [], delegation: { requested: false, readsBeforeNudge: 6 },
    // The reply's own routing, as its loop always asked for it: the plain policy over the pin and the verify model — no lock
    // after the first success, no releasable pin, no decline list.
    modelStart: { plain: true, ...(pinnedModel ? { model: pinnedModel } : {}), ...(verifyPin && verifyPin !== pinnedModel ? { phaseModels: { verify: verifyPin } } : {}) },
  };
  const outcome = await runAgent({
    // `request` is the newest user turn: the stall gate tells a change request from a question by IT, not by the whole transcript.
    task: { prompt: textOf(convo[1]), persona: textOf(convo[0]), request: userRequest, agentName: input.agentName, chatId: input.chatId, dispatch: { source: 'chat' } },
    policy,
    ports: {
      model,
      capabilities: { capabilities: new Set() },
      store: { load: () => undefined, save: () => undefined },
      events: {
        emit(event: RunEvent, meta?: { durationMs?: number }) {
          if (event.kind === 'tool.dispatched' && event.tool !== ASK_USER_TOOL) {
            s.toolCallCount += 1;
            if (event.ok && fileToolKind(event.tool) && fileToolKind(event.tool) !== 'read') wroteFiles = true;
            record({ category: 'tool', label: toolIdOf(event.tool), args: event.args, result: event.result, isError: !event.ok, durationMs: meta?.durationMs ?? 0 });
          } else if (event.kind === 'loop.repetition') {
            // The kernel already cut a looped turn back to its first copy; this leaves the evidence, as its own kind so it is never counted as a turn.
            record({ category: 'repetition_loop', label: s.lastModel || '(gateway default)', result: { copies: event.copies, block: event.block.trim().slice(0, 200) } });
          } else if (event.kind === 'stall.recovered' && event.action === 'escalate') {
            // Traced, because a chat that quietly changes model is its own support ticket. A DISTINCT kind: it records a
            // decision, not a model turn, and counting it as one would corrupt the "every turn was toolless" rollup.
            record({ category: 'failover', label: String(event.detail?.to ?? 'model'), args: { from: event.detail?.from ?? null, to: event.detail?.to, attempt: event.detail?.attempt, of: event.detail?.of }, result: { notice: String(event.detail?.notice ?? event.note ?? '') } });
          }
        },
      },
      human: { ask: async () => ({ kind: 'paused' }) },
      context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
      extensions,
    },
    modules: { compaction: createCompactionHook({ summarize: (text) => buildGatewaySummarizer(env)(text, { tenantId }) }) },
  });

  s.policy = outcome.state.model;
  // The Evermind regeneration reads the transcript the reply ran on, tool exchange included.
  convo.splice(0, convo.length, ...outcome.state.messages.map((m) => toGatewayMessage(m as never)));
  // A reply that SETTLED — final prose, an `ask_user` question, an exhausted-stall notice — is the text.
  s.text = outcome.kind === 'finished' ? outcome.output : '';

  // ── VERIFY, then REMEMBER ── best-effort: a chat reply is already written, and nothing here may turn a failure into a lost answer.
  try {
    const verified = runVerifyPhase({
      surface: 'brain-reply',
      writtenPaths: wroteFiles ? ['changed'] : [],
      results: s.trace
        .filter((row) => row.category === 'tool' || row.category === 'repetition_loop')
        .map((row) => ({ command: `brain_tool:${row.label}`, exitCode: row.isError ? 1 : 0 })),
    });
    recordRunVerifyEvents({ db, tenantId, executionId: null }, verified);
    s.policy = applyVerifyPhase(s.policy);
    await commitRunMemory({
      db, env, tenantId,
      summary: s.text?.trim() || userRequest.trim().slice(0, 500),
      verifyNote: describeVerifyOutcome(verified),
    });
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/brain/agentReplyRun.ts', operation: 'runAgentReplyVerifyThenRemember',
      context: { logMessage: '[brain-reply] verify/remember tail failed; answer kept', details: { tenantId, userId, error } },
    });
  }
  return s;
}

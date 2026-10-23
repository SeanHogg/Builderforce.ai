/**
 * The addressed-agent reply's MODEL LOOP — the bounded server-side tool loop over the
 * curated platform tools, plus the forced no-tools synthesis when the loop settles
 * without prose. Split out of `BrainService.agentReply` (now `agentReply.ts`).
 *
 * Everything the caller needs afterwards — the reply text, the model/vendor/funding
 * of the final turn, the connected-account failure, the buffered step trace — comes
 * back on one {@link ReplyTurnState}.
 */

import { compactMessages, buildGatewaySummarizer, CLOUD_COMPACT_DEFAULTS } from '../llm/compactMessages';
import { readProxyChoice, type LlmProxyService } from '../llm/LlmProxyService';
import { callBuiltinTool } from '../llm/builtinMcpService';
import { codingFallbackSurface } from '../llm/codingFallbackSurface';
import { initialRunPolicy, nextTurn, resolveStallStep, type RunPolicyState } from '@builderforce/run-policy';
import { requestedModelForRole } from '../runtime/cloudAgent/routing';
import {
  applyVerifyPhase, commitRunMemory, describeVerifyOutcome, recordRunVerifyEvents, runVerifyPhase,
} from '../runtime/cloudAgent/runEndMemory';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { toolRowCodecOptions } from '../runtime/costLoop/runLevers';
import { runAgentLoop, openAiChatCodec, readOpenAiToolCalls, trimRepetitionLoop, ASK_USER_TOOL, askUserBlock, liftProseAskUser, type StepRowInput } from '@builderforce/agent-loop';
import { completeTraced, type BrainCallContext } from './brainLlmCall';
import type { AgentReplyToolset } from './agentReplyPrompt';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export const readModel = (r: unknown): string => (r as { resolvedModel?: string } | undefined)?.resolvedModel ?? '';
// The vendor + whether the tenant's OWN account served the turn — captured per
// completion so the FINAL turn's values drive both the empty-reply diagnostic and
// the per-reply provenance chip persisted on a successful turn.
export const readVendor = (r: unknown): string => (r as { resolvedVendor?: string } | undefined)?.resolvedVendor ?? '';
export const readByoFunded = (r: unknown): boolean => (r as { byoFunded?: boolean } | undefined)?.byoFunded === true;

/** What the loop learned, read by the Evermind regeneration and the outcome step. */
export interface ReplyTurnState {
  text: string;
  lastModel: string;
  lastVendor: string;
  lastByoFunded: boolean;
  lastFinish: string;
  /** The connected-account attempt's failure, when the cascade moved off it. */
  byoFailure: { vendor: string; code: number; detail?: string } | null;
  toolCallCount: number;
  iterations: number;
  policy: RunPolicyState;
  /**
   * The reply's STEPS, persisted at the end of the turn as `role:'tool'` step rows in
   * `brain_chat_messages` — the one store for run steps, the same rows the client-driven
   * Brain run loop writes (see `stepRow`).
   *
   * This loop used to leave no server-side record of what it did: steps were
   * written only by the client-driven Brain run loop, so an addressed-agent reply — the
   * ONLY path the manager's accountability chat uses — was unauditable. When the manager
   * answered "the required tools have not returned results" there was literally nothing
   * to inspect: no tool rows, no errors, no way to tell "the model never called anything"
   * from "every call failed". Those two have completely different fixes, and the surface
   * could not distinguish them.
   *
   * Buffered rather than written per tool because a Worker should not pay a round-trip
   * inside the loop; one bounded append at the end is enough for a diagnostic and cannot
   * slow the reply. Best-effort throughout — a trace failure must never cost an answer.
   *
   * Buffering is exactly why every step is stamped on the way in (see `record`):
   * the single append at the end gives all of them the same `created_at`, which cannot
   * order them and used to leave a reopened chat's timeline regrouped by kind.
   */
  trace: StepRowInput[];
}

export interface AgentReplyLoopInput {
  db: Db;
  env: Env;
  tenantId: number;
  userId: string;
  agentRef: string;
  agentName: string;
  opts?: { role?: string; authToken?: string | null; executionCtx?: ExecutionContext };
  service: LlmProxyService;
  convo: Array<Record<string, unknown>>;
  toolset: AgentReplyToolset;
  userRequest: string;
  replyTemp: number;
  pinnedModel: string | undefined;
  byoVendors: ReadonlySet<string>;
  plan: { effectivePlan: 'free' | 'pro' | 'teams'; premiumOverride: boolean };
  call: BrainCallContext;
}

export async function runAgentReplyLoop(input: AgentReplyLoopInput): Promise<ReplyTurnState> {
  const { db, env, tenantId, userId, agentRef, agentName, opts, service, convo, userRequest, replyTemp, pinnedModel, byoVendors, plan, call } = input;
  const { tools, nameToTool } = input.toolset;
  const verifyPin = requestedModelForRole(input.env, 'verify');
  let wroteFiles = false;
  const FILE_TOOLS = new Set(['write_file', 'edit_file', 'apply_patch', 'delete_file']);
  const enterVerifyTurn = (): void => {
    if (!wroteFiles || s.policy.phase === 'verify') return;
    s.policy = applyVerifyPhase(s.policy);
  };

  const s: ReplyTurnState = {
    text: '',
    lastModel: pinnedModel ?? '',
    lastVendor: '',
    lastByoFunded: false,
    lastFinish: '',
    byoFailure: null,
    toolCallCount: 0,
    iterations: 0,
    // THE model hand-off policy (`@builderforce/run-policy`), shared with every other
    // agent loop: the model this reply is currently talking to, every model already
    // tried, and the failover budget. A model that burns its whole stall budget without
    // emitting a tool call is spent; the only remedy left is a DIFFERENT model, so the
    // reply picks one itself. A base-model pin is not routed around on a transport
    // failure — the proxy's own cascade handles those.
    policy: initialRunPolicy({
      pinnedModel,
      ...(verifyPin && verifyPin !== pinnedModel ? { phaseModels: { verify: verifyPin }, reviewModel: verifyPin } : {}),
    }),
    trace: [],
  };

  // Track the connected-account attempt's failure so a silent cascade off the tenant's
  // OWN account is SURFACED (e.g. an expired subscription token 401s → the run falls to
  // a weak coder that empty-turns). The proxy records each failed attempt in
  // `failovers` with its vendor + upstream status; capture the one on a connected vendor.
  const noteByoFailure = (r: unknown): void => {
    const failovers = (r as { failovers?: Array<{ vendor?: string; code?: number; detail?: string }> } | undefined)?.failovers;
    const f = failovers?.find((x) => x.vendor && byoVendors.has(x.vendor));
    if (f?.vendor) s.byoFailure = { vendor: f.vendor, code: f.code ?? 0, ...(f.detail ? { detail: f.detail } : {}) };
  };
  /** Fold one served completion's routing facts into the turn state. */
  const noteServed = (r: unknown): void => {
    s.lastModel = readModel(r) || s.lastModel;
    s.lastVendor = readVendor(r) || s.lastVendor;
    s.lastByoFunded = readByoFunded(r);
    noteByoFailure(r);
  };

  /** Buffer a step, stamped with the instant it actually happened. */
  const record = (step: Omit<StepRowInput, 'ts'>): void => { s.trace.push({ ...step, ts: new Date().toISOString() }); };
  // Budget for the announced-but-untaken tool call recovery below (shared with the
  // Brain run loop and the agent runtime via `@builderforce/agent-stall`).
  let announcementRecoveries = 0;
  let forceToolChoice: 'required' | undefined;
  /**
   * The models this reply may fail over ONTO, in the shared preference order —
   * the tenant's own connected flagships and the plan's curated coding pool.
   *
   * This loop previously had no such surface: its failover was "drop the model pin
   * and let the cascade re-route", guarded by `if (… && pinned)`. On the DEFAULT
   * path that guard is false, because a tenant with a connected account is deliberately
   * left UNPINNED so `complete()` seeds their own flagship — so there was no pin to
   * drop and the branch was unreachable. Measured on project 11 / chat 86: 11 model
   * turns, ONE model (`xai-oauth/grok-4.3`), zero tool calls, zero failovers, and a
   * closing notice telling the user to go pick a different model by hand — which is
   * precisely the work this branch exists to do for them.
   *
   * Composed by the shared `codingFallbackSurface` (coding pool + BYO, never the
   * general plan pool — the same reason the proxy is built `codingOnly`).
   */
  const fallbackSurface = codingFallbackSurface(byoVendors, plan.effectivePlan, plan.premiumOverride);
  // Auto-compact the running transcript BEFORE each paid turn so a tool-heavy reply
  // (every tool result JSON is re-sent every turn) never balloons the request into
  // context exhaustion / a 413 failover onto a weaker model — the same guard the
  // cloud coding loop uses (cloudAgentEngine → compactMessages). Summarizes the bulky
  // MIDDLE into a concise memory (system + task + recent turns kept verbatim, tool
  // pairing preserved), falling back to elision if the summarizer is unavailable.
  const summarize = buildGatewaySummarizer(env);
  // ── THE loop ─────────────────────────────────────────────────────────────
  // The model→tools→model skeleton lives ONCE in `@builderforce/agent-loop` (the same
  // kernel the cloud engine, the embedded Brain and the canvas drive). This reply's
  // own concerns — compaction, the trace, stall recovery + failover, the terminal
  // `ask_user` turn, platform-tool dispatch — are hooks and ports closing over the
  // reply's state. Nothing below iterates.
  /** The CATALOG id a call dispatches to — the label a reader greps for, not the
   *  advertised name. A name the model invented that resolves to nothing lands in
   *  the trace verbatim, which is itself the diagnosis. */
  const toolIdOf = (name: string): string => nameToTool.get(name) ?? name;
  let tStart = 0;
  const loop = await runAgentLoop<Record<string, unknown>>({
    messages: convo,
    // Every tool result is size-capped for the transcript. With C7 on, the shared
    // tool-output policy shapes it (logs summarized, large JSON projected, read_file
    // windowed) — the same budget the cloud loop and the images use; off, the legacy
    // head slice.
    codec: openAiChatCodec<Record<string, unknown>>(
      toolRowCodecOptions(env, tenantId) ?? ((r) => JSON.stringify(r.data ?? null).slice(0, 8000)),
    ),
    // No step cap: an addressed agent asked to review forty tickets makes forty
    // calls. The kernel's consecutive-tool-failure breaker is the only limit — the
    // same one the editor Brain and the cloud engine stop on.
    budget: {},
    hooks: {
      beforeTurn: async () => {
        // Sized to the model the policy asks for next when it names one (its catalog window).
        const compaction = await compactMessages(convo, { ...CLOUD_COMPACT_DEFAULTS, tools, env, tenantId, ...(s.policy.model ? { targetModel: s.policy.model } : {}) }, summarize);
        if (compaction.compacted) convo.splice(0, convo.length, ...compaction.messages);
        return undefined;
      },
      onNoToolCalls: (_ctx, turn) => {
        const content = turn.content;
        // The model ANNOUNCED an action and then ended the turn without taking it
        // ("I'll search the codebase…" → finish: stop, 0 tool calls) — or returned
        // nothing at all. Stopping here hands the user a promise, or a 400, as the
        // answer. The SHARED stall step (`@builderforce/run-policy`, the same one the
        // cloud loops and the on-prem runtime take) re-prompts it, then moves to a
        // DIFFERENT model, then stops and says so. Its SHAPE makes the notices describe
        // what actually happened: a blank turn is not "described tool calls instead of
        // making them", and a HANDED-OFF turn ("you should run the build and push") is
        // work this reply could have handed to its own runtime via
        // `chats.execute_as_agent`, not a limit it reported.
        const stall = resolveStallStep(s.policy, {
          text: content,
          toolCallCount: 0,
          availableToolNames: tools.map((t) => t.function.name),
          requestText: userRequest,
          ...(s.lastModel ? { resolvedModel: s.lastModel } : {}),
        }, announcementRecoveries, { surface: fallbackSurface });
        s.policy = stall.policy;
        const step = stall.step;
        if (step.kind === 'nudge' || step.kind === 'failover') {
          if (step.kind === 'failover') {
            // Traced, because a chat that quietly changes model is its own support
            // ticket — and because the diagnostics report cannot otherwise tell a
            // failover that happened from one that never ran. A DISTINCT kind, not
            // another `llm` row: it records a decision, not a model turn, and counting
            // it as one would corrupt the "every turn was toolless" rollup.
            record({
              category: 'failover',
              label: step.to,
              args: { from: step.from ?? null, to: step.to, attempt: step.attempt, of: step.of },
              result: { notice: step.notice },
            });
          }
          // A failover hands the new model a full stall budget (`recoveriesUsed: 0`).
          announcementRecoveries = step.recoveriesUsed;
          forceToolChoice = step.toolChoice;
          convo.push({ role: 'assistant', content });
          convo.push({ role: 'user', content: step.nudge });
          return { action: 'continue' };
        }
        // A blank turn leaves no `content` to lead with, so the notice IS the reply —
        // and it is a far better one than the 400 this used to fall through to.
        if (step.kind === 'exhausted') {
          return { action: 'stop', ok: true, output: content ? `${content}\n\n${step.notice}` : step.notice };
        }
        // A question asked in prose instead of via `ask_user` still becomes the card.
        return { action: 'stop', ok: true, output: liftProseAskUser(content) };
      },
      // The kernel already cut a looped turn back to its first copy; this leaves the
      // evidence in the reply's trace, as its own kind so it is never counted as a turn.
      onRepetitionLoop: (_ctx, loop) => {
        record({
          category: 'repetition_loop',
          label: s.lastModel || s.policy.model || '(gateway default)',
          result: { copies: loop.copies, block: loop.block.trim().slice(0, 200) },
        });
      },
      beforeToolCalls: (_ctx, turn, calls) => {
        const message = (turn.meta as { message?: { content?: string | null } | null }).message;
        // `ask_user` is a TERMINAL turn: the agent is blocked on the user's decision, so
        // stop the loop and return the question (any lead-in prose + the canonical
        // ```ask-user block the UI renders as a clickable card). Falls through to prose
        // when the args are malformed, so a question is never swallowed.
        const askCall = calls.find((tc) => tc.name === ASK_USER_TOOL);
        if (askCall) {
          let block: string | null = null;
          try { block = askCall.malformed ? null : askUserBlock(askCall.args); } catch { block = null; }
          if (block) {
            const lead = (message?.content ?? '').trim();
            return { action: 'stop', ok: true, output: lead ? `${lead}\n\n${block}` : block };
          }
          // Malformed ask_user → keep any prose the model wrote and stop asking so we
          // don't loop; the empty-turn synthesis below covers a bare call.
          if (message?.content?.trim()) return { action: 'stop', ok: true, output: message.content.trim() };
        }
        s.toolCallCount += calls.length;
        return undefined;
      },
      beforeDispatch: (toolCall) => {
        tStart = Date.now();
        if (toolCall.name === ASK_USER_TOOL) {
          // Reached only when ask_user args were malformed AND the model wrote no prose.
          // Emit a corrective tool result (so the call isn't left unanswered) telling it
          // to retry with a valid question + options, or just answer in prose.
          return { result: { data: { error: 'ask_user needs { question, options:[{label}] } with 2+ options. Retry or answer in prose.' } } };
        }
        return undefined;
      },
      afterDispatch: (toolCall, result) => {
        if (toolCall.name === ASK_USER_TOOL) return undefined;
        record({
          category: 'tool', label: toolIdOf(toolCall.name), args: toolCall.args, result: result.data,
          isError: result.isError === true, durationMs: Date.now() - tStart,
        });
        if (result.isError !== true && FILE_TOOLS.has(toolCall.name)) wroteFiles = true;
        return undefined;
      },
    },
    ports: {
      complete: async (ctx) => {
        s.iterations = ctx.step + 1;
        const turnToolChoice = forceToolChoice;
        forceToolChoice = undefined;
        enterVerifyTurn();
        const ask = nextTurn(s.policy, { hasTools: true });
        const result = await completeTraced(db, service, {
          model: ask.model,
          role: ask.role,
          ...(ask.excludeModels.length > 0 ? { excludeModels: ask.excludeModels } : {}),
          prompt_cache_key: `brain-reply:${input.tenantId}:${input.agentRef}`,
          messages: convo as never,
          tools,
          ...(turnToolChoice ? { tool_choice: turnToolChoice } : {}),
          temperature: replyTemp,
          max_tokens: 1200,
        } as never, call);
        noteServed(result);
        // ProxyResult.response is an HTTP Response — the body MUST be parsed (readProxyChoice),
        // NOT read as if it were the choices envelope (that silently empties every reply).
        const { message, content, toolCalls, finishReason } = await readProxyChoice(result);
        s.lastFinish = finishReason || s.lastFinish;
        // The MODEL turn itself, recorded whether or not it called anything. A turn with
        // `toolCalls: 0` and prose that merely names tools is the announced-but-untaken
        // stall, and without this row it is indistinguishable from a turn whose tools all
        // failed — the two have opposite fixes.
        record({
          category: 'llm',
          label: readModel(result) || s.policy.model || '(gateway default)',
          finishReason,
          textChars: content.length,
          result: {
            finishReason,
            toolCalls: toolCalls.length,
            toolNames: toolCalls.map((tc) => tc.function.name),
            replyChars: content.length,
            advertisedTools: tools.length,
          },
        });
        return { content, toolCalls: readOpenAiToolCalls({ tool_calls: toolCalls }), meta: { message } };
      },
      dispatch: async (toolCall) => {
        if (toolCall.malformed) return { data: { error: 'malformed tool arguments' }, isError: true };
        try {
          const out = await callBuiltinTool(db, {
            tenantId, tool: toolIdOf(toolCall.name), arguments: toolCall.args, env,
            userId, role: opts?.role as never, authToken: opts?.authToken, executionCtx: opts?.executionCtx,
            // The reply IS this agent acting: the ref is what lets a tool act "as me"
            // (`chats.execute_as_agent` hands work to this agent's own runtime) and what
            // credits a replayed write to the agent rather than to the person who asked.
            agentRef,
          });
          return { data: out };
        } catch (e) {
          return { data: { error: e instanceof Error ? e.message : 'tool call failed' }, isError: true };
        }
      },
    },
  });
  // A reply that SETTLED — final prose, an `ask_user` question, an exhausted-stall
  // notice — is the text. A tripped failure breaker leaves it empty for the synthesis
  // below, which then reports what kept failing rather than an empty reply.
  s.text = loop.finished ? loop.output : '';

  // The tool loop ended with no prose (only tool calls across every iteration, or a
  // model that returned an empty turn): force ONE final synthesis WITHOUT tools so
  // the agent always speaks — a bounded extra call, not another tool round.
  if (!s.text) {
    enterVerifyTurn();
    const ask = nextTurn(s.policy, { hasTools: false });
    const finalResult = await completeTraced(db, service, {
      // The policy's model, NOT the original pin: when the loop above failed over, the pin
      // names a model that has already proven it cannot do this turn, and re-pinning it
      // for the one call that must produce the user's answer throws the failover away.
      model: ask.model,
      role: ask.role,
      ...(ask.excludeModels.length > 0 ? { excludeModels: ask.excludeModels } : {}),
      prompt_cache_key: `brain-reply:${input.tenantId}:${input.agentRef}`,
      messages: [...convo, { role: 'user', content: `Now write your reply to the team AS ${agentName}: plain prose, first person, no tool calls. Summarise what you found or did.` }] as never,
      temperature: replyTemp,
      max_tokens: 1000,
    } as never, call);
    noteServed(finalResult);
    const finalChoice = await readProxyChoice(finalResult);
    s.lastFinish = finalChoice.finishReason || s.lastFinish;
    // Outside the kernel (no tools, one call), so the loop trim is applied here: a reply
    // stuck on one sentence posts that sentence once, not the run to the output ceiling.
    s.text = trimRepetitionLoop(finalChoice.content);
    // Traced like every other model turn. This is the call that decides whether the
    // reply exists at all, and it was the ONLY one leaving no row — so an empty reply
    // produced HERE was invisible to the diagnostics report that exists to explain it.
    record({
      category: 'llm',
      label: readModel(finalResult) || s.policy.model || '(gateway default)',
      finishReason: finalChoice.finishReason,
      textChars: finalChoice.content.length,
      args: { synthesis: true },
      // No `advertisedTools`: this call is made WITHOUT tools by construction, and the
      // rollup reads the newest row that reports the field — writing 0 here would make
      // the report claim the manager was offered no tools at all.
      result: {
        finishReason: finalChoice.finishReason,
        toolCalls: 0,
        toolNames: [],
        replyChars: finalChoice.content.length,
      },
    });
  }
  // ── VERIFY, then REMEMBER ───────────────────────────────────────────────────
  // The tail a reply loop never had. It enters the run policy's `verify` phase around
  // the only real verification a chat reply HAS — the tools it just ran, whose failures
  // this loop already recorded — then commits what the reply learned.
  //
  // Both steps are best-effort: a chat reply is already written by this point, and
  // nothing here may turn a failure to verify or remember into a lost answer.
  try {
    const outcome = runVerifyPhase({
      surface: 'brain-reply',
      writtenPaths: wroteFiles ? ['changed'] : [],
      // The tools this loop actually ran, as the verification evidence they are: a
      // reply that asked the agent to change code and only READ that code did not verify.
      results: s.trace
        .filter((row) => row.category === 'tool' || row.category === 'repetition_loop')
        .map((row) => ({ command: `brain_tool:${row.label}`, exitCode: row.isError ? 1 : 0 })),
    });
    recordRunVerifyEvents({ db, tenantId, executionId: null }, outcome);
    // The declared `verify_started` event, applied through the run policy's reducer —
    // the reason the policy meant to gate runs on a verify step never saw one.
    s.policy = applyVerifyPhase(s.policy);
    await commitRunMemory({
      db, env, tenantId,
      summary: s.text?.trim() || userRequest.trim().slice(0, 500),
      verifyNote: describeVerifyOutcome(outcome),
    });
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/brain/agentReplyLoop.ts',
      operation: 'runAgentReplyVerifyThenRemember',
      context: { logMessage: '[brain-reply] verify/remember tail failed; answer kept', details: { tenantId, error } },
    });
  }
  return s;
}

/**
 * The loop's MODEL port — one turn's completion: steering in front of it, auto-
 * compaction, the relevance-selected tool menu, the request the run policy asks for
 * (packed for its model's window), the retry around a provider that broke, the
 * analysis → code re-ask, and the `llm.complete` step every diagnostics reader keys on.
 */

import { volatileTail } from '@seanhogg/builderforce-memory/handoff';
import { replayTextOf, type LoopPorts } from '@builderforce/agent-loop';
import { coderHandoffBrief, nextTurn, offersHandOff } from '@builderforce/run-policy';
import { toolNamesMentionedIn } from '@builderforce/agent-stall';
import { StreamInterruptedError, type ChatCompletionMessage, type CompletionMetadata, type StreamChatResult, type StreamHandlers } from '../streamChatCompletion';
import { turnMaxTokens } from '../effort';
import { providerFailureEvent } from '../providerFailure';
import { coderReaskTrace, providerFailureTrace, transportRetryTrace } from '../runPolicyTraces';
import { localFallbackTrace } from '../localFirstTraces';
import { selectToolsForTurn } from '../selectTools';
import { routerToolSpecs } from '../toolRouter';
import { setLastResolvedModel } from '../lastResolvedModel';
import { isCodeChangeTool } from '../localWorkspaceTools';
import { HAND_OFF_TOOL } from '../planHandoff';
import { createComposingActivity, toolCallArgBytes } from '../composingActivity';
import { hasCallMarkup } from '../xmlToolCalls';
import { turnInterruption } from '../finishReason.js';
import { takeRunSteering } from './steerInterrupt';
import { buildWorkingTranscript, summarizeMiddle } from '../workingTranscript';
import { compactionSavedTokens, stampOncePerCall } from './compactionSaved';
import { callMemoryEffect } from '../memorySavings';
import { accrueByoUnresolved, accrueProviderCap, emit, emitStreaming, nowIso, nowMs, pushTrace, runTrace, setActivity } from './runCells';
import { modelDowngradeEvent } from './modelDowngrade';
import { asLiveTurn, connectRetryStep, liveTurnModel } from './turnPersistence';
import { reportToPolicy, type RunLoopContext, type TurnMeta } from './runLoopContext';

export function completeTurnPort(run: RunLoopContext): LoopPorts<ChatCompletionMessage>['complete'] {
  const { c, chatId, runKey, req, convo, systemPrompt, metadata, recallBlockTokens, allTools, requestQuery, usedTools, canAskUser, alwaysAdvertised } = run;
  const { stream, routingMode, maxTokens, reasoning, runTool } = req;
  return async (ctx) => {
    const iter = ctx.step;
    c.streamingText = '';
    emit(c);
    // Direction that arrived while the run was working — an owner redirecting its
    // sub-agent, or a child's report reaching its owner — goes in front of this turn,
    // recorded as one `steer.applied` step.
    for (const text of takeRunSteering(c, runKey, iter)) convo.push({ role: 'user', content: text });
    // Auto-compact BEFORE the turn: summarize the older middle into a memory note
    // when the transcript exceeds the token budget (instead of silently dropping it
    // and making the model thrash into "LOOP EXHAUSTED"). Falls back to the
    // drop-oldest window when no summarizer is reachable.
    const working = await buildWorkingTranscript(
      c,
      systemPrompt,
      (msgs) => summarizeMiddle(stream, run.policy.model, msgs, c.abort?.signal),
      (dropped) => {
        pushTrace(c, {
          ts: nowIso(),
          category: 'message',
          label: 'context.compacted',
          args: { droppedMessages: dropped },
          result: `Compressed ${dropped} earlier step(s) into a memory to stay within the context window.`,
        });
        emit(c);
      },
    );
    // What memory did to THIS call's prompt — compaction kept the folded part of the
    // transcript out of it, recall added its block — carried in the metadata the call
    // already sends, so the gateway stamps it on this call's own usage row. Saved is
    // measured against what the prompt would have been WITHOUT compaction, which is
    // itself capped at the history budget — never the whole transcript.
    const trimmed = c.compactMemo
      ? compactionSavedTokens([{ role: 'system', content: systemPrompt }, ...c.transcript], working)
      : 0;
    const memoryEffect = callMemoryEffect(trimmed, recallBlockTokens);
    const memoryMetadata: CompletionMetadata = memoryEffect ? { ...metadata, memory: memoryEffect } : metadata;
    // Stamped ONCE per call: only the first request of this turn carries the effect; a
    // transport retry or the coder re-ask is the same call's prompt again, not a second
    // saving, so it rides the plain metadata.
    const nextCallMetadata = stampOncePerCall<CompletionMetadata>(memoryMetadata, metadata);
    // User hit Stop while compacting — the kernel reports it as `cancelled` (the
    // run's signal is the one it watches) and the run unwinds quietly.
    if (c.abort?.signal.aborted) throw new Error('run stopped');
    const llmStart = nowMs();
    // Time-to-first-token: stamped on the FIRST streamed delta of this turn so
    // the timeline's "Thought for Xs" reflects latency-to-first-token, not the
    // whole turn. Stays undefined for a pure tool-call / empty turn.
    let firstTokenAt: number | undefined;
    let result: StreamChatResult;
    // Advertise a RELEVANT subset rather than the whole catalog. ~300 tool
    // definitions push most providers past the point where they reliably emit any
    // tool call at all (observed: 308 tools → three consecutive turns with zero
    // calls), besides dominating the prompt budget. No-ops for small catalogs.
    const selection = selectToolsForTurn(allTools, {
      // The REQUEST, captured once before the loop — never "the latest user message".
      // The loop pushes its own `role:'user'` turns (the stall-recovery nudge, the
      // tool-budget close-out), so reading the newest one re-rolled the advertised
      // set from text WE wrote: after one recovery the query became "…made zero tool
      // calls… answer using its result…", which scores `key_results`/`dashboards`/
      // `incidents` and drops the ticket tools the user actually asked for. The tool
      // the model was told to call then genuinely did not exist, and it narrated.
      // Holding the request steady also keeps the advertised set STABLE across turns
      // — a tool must not vanish between one turn and the next.
      query: requestQuery,
      pinned: usedTools,
      // Tools the SYSTEM PROMPT instructs the model to call (e.g. the chat↔ticket
      // directive names `builtin_chats_list_tickets`) are never optional: telling a
      // model to call a tool we then decline to advertise is the exact contradiction
      // that produces a narrated call. Derived from the prompt text, so a directive
      // edit can never silently desync from this list — plus the local workspace
      // tools, which the prompt names in prose the pattern cannot see.
      // While planning, the planner's deliverable is never off-topic either.
      required: offersHandOff(run.policy) && canAskUser ? [...alwaysAdvertised, HAND_OFF_TOOL] : alwaysAdvertised,
    });
    // Once the run is coding, the plan is handed off: `hand_off` is gone from the menu,
    // so a coder can never re-plan the work it was just given.
    const selected = offersHandOff(run.policy) ? selection.tools : selection.tools.filter((t) => t.function.name !== HAND_OFF_TOOL);
    // The ROUTER rides along whenever selection actually trimmed something, so the
    // tools that missed the cut stay REACHABLE instead of silently ceasing to exist.
    // Three fixed schemas buy back the whole catalog; see toolRouter.ts.
    const advertised = selection.trimmed
      ? [...selected, ...routerToolSpecs(allTools?.length ?? 0)]
      : selected;
    const tools = advertised.length > 0 ? advertised : undefined;
    // What the model could actually call THIS turn. Kept as a set so the turn can
    // answer, at the only point that knows both halves, "did it narrate a tool it was
    // never shown?" — see `narratedUnadvertised` below.
    const advertisedNames = new Set(advertised.map((t) => t.function.name));
    if (selection.trimmed) {
      pushTrace(c, {
        ts: nowIso(),
        category: 'message',
        label: 'tools.selected',
        args: { step: iter },
        result: `${selected.length} of ${selection.available} tools advertised this turn (relevance-selected; ${usedTools.size} pinned from earlier calls)`,
      });
    }
    // The completion is open and no token has arrived yet — the phase that used to
    // be indistinguishable from a hang. It flips to `writing` on the first delta.
    setActivity(c, { phase: 'thinking', startedAt: Date.now(), step: iter });
    // A turn that emits a tool call streams its ARGUMENTS, not text — 21 KB of them
    // took 3m 23s on chat #113 while the indicator sat on "writing the reply". See
    // `composingActivity.ts`; the run store only supplies the cell's three writes.
    const composing = createComposingActivity(
      { set: (a) => { c.activity = a; }, repaint: () => emit(c), coalescedRepaint: () => emitStreaming(c) },
      { step: iter },
    );
    const handlers: StreamHandlers = {
      onModel: liveTurnModel(c),
      onConnectRetry: connectRetryStep(c, iter),
      onTextDelta: (d) => {
        c.streamingText += d;
        if (firstTokenAt === undefined) {
          firstTokenAt = nowMs();
          // First token: the reply is visibly forming, so the indicator stops
          // claiming the model is still thinking. A PHASE change, so it repaints
          // now (one repaint carrying the first token too); every later delta
          // is text only and coalesces into a frame.
          c.activity = { phase: 'writing', startedAt: Date.now(), step: iter };
          emit(c);
          return;
        }
        emitStreaming(c);
      },
      // The first argument fragment is this turn's first token too: a tool-only turn
      // recorded no ttft at all, so "Thought for Xs" covered the whole turn.
      onToolCallDelta: (index, partial) => {
        if (firstTokenAt === undefined) firstTokenAt = nowMs();
        composing.onDelta(index, partial);
      },
    };
    // The role, model and exclusions this turn asks for — a tool-less turn is
    // conversation, not analysis or code. Re-read per request: a retry or the coder
    // re-ask below asks for what the policy says AFTER the event that caused it.
    let turnRole = nextTurn(run.policy, { hasTools: !!tools }).role;
    // Consume a one-shot forced tool_choice from stall recovery (if any).
    const turnToolChoice = run.forceToolChoice;
    run.forceToolChoice = undefined;
    // `extra` rides THIS request only (the hand-off brief); it never enters the transcript.
    // What the run has already established, in front of THIS turn only — so the model
    // reasons from its own record instead of re-deriving the codebase every turn (its
    // reasoning is stripped from the transcript, and old tool results compact away).
    // A tagged volatile tail: the cache breakpoint lands before it and the packer keeps
    // it last without mistaking it for the user's request.
    const ledger = tools ? volatileTail([run.knowledge.brief()]) : null;
    const request = async (extra: ChatCompletionMessage[] = []): Promise<StreamChatResult> => {
      const ask = nextTurn(run.policy, { hasTools: !!tools });
      const callMetadata = nextCallMetadata();
      const perTurn: ChatCompletionMessage[] = ledger ? [...extra, ledger] : extra;
      const messages = await run.windowFit.prepare({ messages: perTurn.length > 0 ? [...working, ...perTurn] : working, model: ask.model, tools, maxTokens: turnMaxTokens(maxTokens, !!tools), step: iter });
      return asLiveTurn(c, () => stream(
        {
          messages, tools, tool_choice: tools ? (turnToolChoice ?? 'auto') : undefined, model: ask.model, modelStrict: ask.strict,
          // Raised to the tool-turn floor when tools are on offer: a file write is
          // output, and the Effort ceiling cut every one of them off mid-JSON.
          routingMode, maxTokens: turnMaxTokens(maxTokens, !!tools), reasoning, metadata: callMetadata, role: ask.role,
          ...(ask.excludeModels.length > 0 ? { excludeModels: ask.excludeModels } : {}),
          // Keyed on the conversation's identity OFF this machine (PRD 36): the server
          // chat, else the local chat's client id — never its local view key.
          prompt_cache_key: `brain:${run.serverChatId ?? run.req.clientChatId ?? 'local'}`,
          conversationKey: run.chatId,
          signal: c.abort?.signal,
        },
        handlers,
      ));
    };
    /** Record a failed completion on the timeline and hand the error back to rethrow. */
    const turnError = (e: unknown): unknown => {
      // The model that broke, not the requested one: under auto-routing that is 'default'.
      pushTrace(c, providerFailureTrace(nowIso(), iter, (e instanceof StreamInterruptedError && e.model) || run.policy.model, e, nowMs() - llmStart));
      return e;
    };
    /** Start the turn over on a clean slate — the discarded attempt's text already streamed. */
    const restartTurn = (): void => {
      c.streamingText = '';
      firstTokenAt = undefined;
      composing.reset();
      emit(c);
    };
    try {
      result = await request();
    } catch (e) {
      // Aborting the fetch rejects the stream — that's a user Stop; the kernel
      // reports it as `cancelled` (no error trace, no error message).
      if (c.abort?.signal.aborted) throw e;
      // The model broke AFTER the gateway committed to it (an in-band failure, or the
      // connection dropping) — which the gateway cannot fail over from — or the gateway
      // was reached and the request reset, timed out or was answered with a status the
      // policy routes around (413 / 429 / 503, a 5xx). The run policy decides whether
      // to retry the turn ONCE on another connected model instead of ending the run
      // (the "Grok starts and then stops" failure) and leaves a model that broke out of
      // every later turn. One where the gateway was NEVER reached has already been
      // retried with backoff inside the stream (`retryOnConnectFailure`); anything else
      // is not a transport failure at all, and is reported as it is.
      const failure = providerFailureEvent(e);
      const outcome = failure ? reportToPolicy(run, failure).outcome : null;
      if (!outcome || outcome.kind !== 'retry_turn') throw turnError(e);
      pushTrace(c, transportRetryTrace(nowIso(), iter, outcome, (e as Error).message));
      restartTurn();
      try {
        result = await request();
      } catch (retryError) {
        if (c.abort?.signal.aborted) throw retryError;
        throw turnError(retryError);
      }
    }
    // ANALYSIS → CODE hand-off, at the exact turn it matters. The analysis model just
    // decided to change code; that edit is the first line of the deliverable, so it is
    // re-asked of the coding model rather than written by the model that planned it.
    // The coder gets the transcript AND a brief naming the change the planner was
    // about to make (`coderHandoffBrief`) — given the transcript alone, it started the
    // analysis over. A pinned model is the user's choice for the whole run (the policy
    // declines the re-ask under one), and a tool-less chat turn is never re-asked.
    if (turnRole === 'plan' && result.toolCalls.some((tc) => isCodeChangeTool(tc.name))
      && reportToPolicy(run, { type: 'code_change_attempted' }).outcome.kind === 'reask_as_coder') {
      turnRole = nextTurn(run.policy, { hasTools: !!tools }).role;
      c.codePhaseReached = true;
      const brief = coderHandoffBrief(replayTextOf(result.text), result.toolCalls);
      pushTrace(c, coderReaskTrace(nowIso(), iter, result.resolvedModel));
      restartTurn();
      try {
        result = await request([{ role: 'user', content: brief }]);
      } catch (e) {
        if (c.abort?.signal.aborted) throw e;
        throw turnError(e);
      }
    }
    // The turn answered: the policy's per-turn retry allowance starts over.
    reportToPolicy(run, { type: 'turn_succeeded', ...(result.resolvedModel ? { model: result.resolvedModel } : {}) });
    run.windowFit.served(result.resolvedModel ?? run.policy.model);
    // The stall-recovery budget covers a STREAK of narration-only turns, not the whole
    // run. As a run-wide count, a 134-turn run's fourth narrated step anywhere was
    // silently accepted as the final answer — the run just stopped mid-task. A turn
    // that actually called a tool proves the model is acting, so the streak resets.
    if (result.toolCalls.length > 0) run.announcementRecoveries = 0;
    // The model making the code changes is the one this run's outcome grades as a
    // coder — after a hand-off the coding model, under a pin the pinned one.
    if (result.resolvedModel && result.toolCalls.some((tc) => isCodeChangeTool(tc.name))) c.codeModel = result.resolvedModel;
    // Surface a connected-but-unresolved BYO account for a live banner (and reset
    // clears it when the account is reconnected). Emit happens with the trace below.
    accrueByoUnresolved(c, result.byoUnresolved);
    // Surface any BYO provider usage cap so the user knows to manage their keys.
    accrueProviderCap(c, result.providerCap);
    // Silent-downgrade detection: the gateway can fail over mid-run to a
    // different (often smaller-window) model than we requested. That's a prime
    // context-exhaustion symptom, so surface it as its own warning step instead
    // of leaving it buried in the model field — the diagnostics block counts it.
    const resolved = result.resolvedModel ?? run.policy.model ?? 'default';
    const requested = run.policy.model ?? 'default';
    // The run's production cost so far — what its answer is cached with, and the model
    // a later memory answer in this chat is priced against.
    c.runUsage.promptTokens += result.usage?.prompt ?? 0;
    c.runUsage.completionTokens += result.usage?.completion ?? 0;
    if (result.resolvedModel) {
      c.runUsage.model = result.resolvedModel;
      c.lastServedModel = result.resolvedModel;
    }
    // Record what ACTUALLY served this turn so `builtin_session_current_model` can
    // report the exact model (an MCP call is a separate request and can't see it).
    // Keyed by CHAT: runs are concurrent on a host that owns them, so one slot would
    // let this chat's tool call answer with the model that served a different one.
    setLastResolvedModel(chatId, result.resolvedModel);
    // A pinned model answered by another, or an auto-routed turn the tenant's own
    // account could not serve (PRD 35 E7) — see `modelDowngrade.ts`.
    const downgrade = modelDowngradeEvent({
      requested, resolved, step: iter, ts: nowIso(), events: runTrace(c),
      ...(result.byoUnresolved ? { byoUnresolved: result.byoUnresolved } : {}),
    });
    if (downgrade) pushTrace(c, downgrade);
    // A local-first turn that fell over (on-device model down/refused → the cloud).
    const localFallback = localFallbackTrace(nowIso(), iter, result.localFirst);
    if (localFallback) pushTrace(c, localFallback);
    // Tool names this turn WROTE OUT as prose while emitting no structured call, that
    // were never advertised to it. Computed here because this is the only place that
    // holds BOTH the turn's text and the exact set the turn was offered — after the
    // fact a reader can only see the catalog total, which is why "the model is broken,
    // pick another one" was the standing (and sometimes wrong) verdict for a run whose
    // real fault was that the tool it was told to call had been selected away. Cheap:
    // a handful of strings, and empty on every healthy turn.
    const narratedUnadvertised =
      result.toolCalls.length === 0
        ? toolNamesMentionedIn(result.text).filter((n) => !advertisedNames.has(n))
        : [];
    // Bytes of tool-call arguments this turn emitted — taken from the ASSEMBLED calls,
    // so a turn retried after a stream break reports what the surviving attempt sent.
    const argBytes = toolCallArgBytes(result.toolCalls);
    // DURABLE, not just live: an `llm` turn carries the token usage, finish reason
    // and resolved model the A-vs-B triage runs on. Kept in memory only, a chat
    // copied after a reload reported `Turns: 0` / "Tokens: not reported" and could
    // never separate context exhaustion from model degradation. The payload is a
    // handful of scalars — no transcript text — so the row stays small.
    pushTrace(c, {
      ts: nowIso(),
      category: 'llm',
      label: 'llm.complete',
      durationMs: nowMs() - llmStart,
      ttftMs: firstTokenAt !== undefined ? firstTokenAt - llmStart : undefined,
      // `model` is the model the gateway ACTUALLY used (resolved), falling back to
      // what we requested when the gateway didn't report one. `requestedModel`
      // keeps the caller's ask (empty/'default' ⇒ gateway auto-selects) so triage
      // can tell "what I asked for" from "what answered".
      args: {
        model: resolved,
        requestedModel: requested,
        step: iter,
        // What the turn asked the gateway for (analysis vs code vs chat), so a copied
        // report shows which model planned and which one wrote the code.
        role: turnRole,
        toolCalls: result.toolCalls.length,
        // How much the turn actually EMITTED. "1 tool call(s) · 202509ms" said
        // nothing about a turn that spent three minutes streaming 21 KB of
        // `write_file` arguments — which is what a long turn usually is.
        ...(argBytes > 0 ? { argBytes } : {}),
        // Which account served the turn + any connected-BYO provider the gateway
        // could NOT resolve — so triage tells "ran on the shared pool despite a
        // connected Claude account (expired?)" apart from "nothing connected".
        account: result.account,
        byoUnresolved: result.byoUnresolved,
        // How many tools the turn was actually OFFERED, out of the whole catalog.
        // A zero here is the difference between "the model refused to act" and "it had
        // nothing to act with" — previously unanswerable from a copied report, which
        // only ever carried the registry-wide total.
        advertisedTools: advertised.length,
        catalogTools: allTools?.length ?? 0,
        ...(narratedUnadvertised.length ? { narratedUnadvertised } : {}),
        // The stream filter strips every call it lifts, so call markup still IN the text
        // is a dialect it does not know: the model tried to act and the call never ran.
        // Recorded so a copied report says "parser gap" instead of "won't call tools".
        ...(result.toolCalls.length === 0 && hasCallMarkup(result.text) ? { unliftedCallMarkup: true } : {}),
        // What the vendor's RAW response carried, counted before the gateway translated
        // it — so a text-only turn reads as "the model returned no call" or "a returned
        // call was lost on the way", never as a guess. Absent when the vendor does not report it.
        ...(result.upstream ? { upstreamFunctionCalls: result.upstream.functionCalls, upstreamRecovered: result.upstream.recovered } : {}),
      },
      // Structured diagnostics fields — the A-vs-B triage reads these directly.
      usage: result.usage,
      finishReason: result.finishReason,
      textChars: result.text.length,
      result: `${result.toolCalls.length} tool call(s) · ${result.text.length} chars · finish: ${result.finishReason ?? '—'}${result.usage?.prompt != null ? ` · prompt ${result.usage.prompt} tok` : ''}`,
    });
    if (result.text.trim()) {
      pushTrace(c, { ts: nowIso(), category: 'message', label: 'agent.message', args: { step: iter }, result: result.text });
    }
    run.lastTurnInterruption = turnInterruption(result.finishReason);
    const meta: TurnMeta = { result, resolved, requested, advertised: advertised.length, advertisedNames };
    // A host that advertised tools but cannot run them gets the turn as a final
    // answer — a tool call nobody can execute is not a tool call.
    const toolCalls = runTool
      ? result.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.args }))
      : [];
    return { content: replayTextOf(result.text), toolCalls, meta };
  };
}

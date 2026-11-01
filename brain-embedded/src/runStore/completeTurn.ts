/**
 * The loop's MODEL port — one turn's completion: steering in front of it, auto-
 * compaction, the relevance-selected tool menu, the request the run policy asks for
 * (packed for its model's window), the retry around a provider that broke, the
 * analysis → code re-ask, and the `llm.complete` step every diagnostics reader keys on.
 */

import { volatileTail } from '@seanhogg/builderforce-memory/handoff';
import { replayTextOf, type LoopPorts } from '@builderforce/agent-loop';
import { coderHandoffBrief, nextTurn } from '@builderforce/run-policy';
import { StreamInterruptedError, type ChatCompletionMessage, type CompletionMetadata, type StreamChatResult, type StreamHandlers } from '../streamChatCompletion';
import { turnMaxTokens } from '../effort';
import { providerFailureEvent } from '../providerFailure';
import { coderReaskTrace, providerFailureTrace, transportRetryTrace } from '../runPolicyTraces';
import { isCodeChangeTool } from '../localWorkspaceTools';
import { takeRunSteering } from './steerInterrupt';
import { persistSteer } from './steerPersistence';
import { steerModelContent } from '../runSteering';
import { buildWorkingTranscript } from '@seanhogg/builderforce-memory/working';
import { summarizeMiddle } from '../transcriptSummarizer';
import { recordFold } from './runFoldMarker';
import { compactionSavedTokens, stampOncePerCall } from './compactionSaved';
import { callMemoryEffect } from '../memorySavings';
import { emit, nowIso, nowMs, pushTrace } from './runCells';
import { turnMenu } from './turnMenu';
import { markPersonTurn } from './chatAsks';
import { asLiveTurn } from './turnPersistence';
import { openLiveTurn } from './turnStream';
import { recordTurn } from './turnRecorder';
import { reportToPolicy, type RunLoopContext } from './runLoopContext';

export function completeTurnPort(run: RunLoopContext): LoopPorts<ChatCompletionMessage>['complete'] {
  const { c, chatId, runKey, req, convo, systemPrompt, metadata, recallBlockTokens } = run;
  const { stream, routingMode, maxTokens, reasoning, runTool } = req;
  return async (ctx) => {
    const iter = ctx.step;
    c.streamingText = '';
    emit(c);
    // Direction that arrived while the run was working — an owner redirecting its
    // sub-agent, or a child's report reaching its owner — goes in front of this turn,
    // recorded as one `steer.applied` step. Attachments become vision parts so a
    // mid-run message with images reaches the model like a normal send.
    // Only the person's own steer is one of the chat's asks (`chatAsks.ts`); a child's
    // report or an owner's direction is not.
    for (const steer of takeRunSteering(c, runKey, iter)) {
      const msg: ChatCompletionMessage = { role: 'user', content: steerModelContent(steer) };
      convo.push(steer.fromPerson ? markPersonTurn(msg) : msg);
      // A steer no surface has shown yet (the web composer's) is saved as the run reads it.
      await persistSteer(c, chatId, req.persistence, steer, runKey);
    }
    // Auto-compact BEFORE the turn: summarize the older middle into a memory note
    // when the transcript exceeds the token budget (instead of silently dropping it
    // and making the model thrash into "LOOP EXHAUSTED"). Falls back to the
    // drop-oldest window when no summarizer is reachable.
    const working = await buildWorkingTranscript(
      c,
      systemPrompt,
      (msgs) => summarizeMiddle(stream, run.policy.model, msgs, c.abort?.signal),
      (fold) => recordFold(run, fold),
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
    let result: StreamChatResult;
    // What this turn offers: the relevance-selected menu, or a forced turn's (`turnMenu.ts`).
    const { forced, advertised, tools, advertisedNames, opening } = turnMenu(run, iter);
    // The completion is open and no token has arrived yet - the phase that used to be indistinguishable from a hang.
    // It flips to `writing` on the first delta; a tool call's ARGUMENTS stream as `composing` (`turnStream.ts`).
    const live = openLiveTurn(c, iter);
    const handlers: StreamHandlers = live.handlers;
    // The role, model and exclusions this turn asks for — a tool-less turn is
    // conversation, not analysis or code. Re-read per request: a retry or the coder
    // re-ask below asks for what the policy says AFTER the event that caused it.
    let turnRole = nextTurn(run.policy, { hasTools: !!tools }).role;
    // Consume a one-shot forced tool_choice from stall recovery (if any).
    const turnToolChoice = forced ? forced.toolChoice : run.forceToolChoice;
    run.forceToolChoice = undefined;
    // What the run has already established, in front of THIS turn only — so the model
    // reasons from its own record instead of re-deriving the codebase every turn (its
    // reasoning is stripped from the transcript, and old tool results compact away).
    const ledger = tools ? run.knowledge.brief() : '';
    // `tailSections` (a forced turn's brief) and `extra` (the coder re-ask brief) ride THIS
    // request only; neither enters the transcript. The run's record and a forced brief go
    // in ONE tagged volatile tail, LAST: the cache breakpoint lands before it and the
    // packer keeps it last without mistaking it for the user's request. An untagged forced
    // brief in front of the tail took the history breakpoint itself, so the next turn
    // missed the cache. The re-ask brief stays an untagged user turn before the tail: it is
    // the coder's directive for that one request (the packer protects it as such).
    const request = async (extra: ChatCompletionMessage[] = [], tailSections: string[] = []): Promise<StreamChatResult> => {
      const ask = nextTurn(run.policy, { hasTools: !!tools });
      const callMetadata = nextCallMetadata();
      const tail = volatileTail([ledger, ...tailSections]);
      const perTurn: ChatCompletionMessage[] = tail ? [...extra, tail] : extra;
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
    const restartTurn = (): void => live.restart();
    try {
      result = await request([], opening);
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
        result = await request([], opening);
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
    // Under a pin or lock there is no re-ask, but the run is coding all the same: the
    // phase moves so planning cannot outlive the edit.
    const codeChangeOutcome = turnRole === 'plan' && result.toolCalls.some((tc) => isCodeChangeTool(tc.name))
      ? reportToPolicy(run, { type: 'code_change_attempted' }).outcome
      : null;
    if (codeChangeOutcome?.kind === 'reask_as_coder') {
      turnRole = nextTurn(run.policy, { hasTools: !!tools }).role;
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
    const resolved = result.resolvedModel ?? run.policy.model ?? 'default';
    const requested = run.policy.model ?? 'default';
    const meta = await recordTurn(run, { result, iter, llmStart, live, role: turnRole, resolved, requested, advertised, advertisedNames });
    // A host that advertised tools but cannot run them gets the turn as a final
    // answer — a tool call nobody can execute is not a tool call.
    const toolCalls = runTool
      ? result.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.args }))
      : [];
    return { content: replayTextOf(result.text), toolCalls, meta };
  };
}

/**
 * The closing answer of a run the consecutive-failure breaker stopped (`DEFAULT_TOOL_FAILURE_STREAK`): its last N tool calls
 * all failed and it never wrote a final answer. Rather than drop the whole run with "kept calling tools without finishing",
 * force ONE final completion WITHOUT tools so the model MUST answer in prose using what it already gathered - the same
 * "always speak" guarantee the server-side addressed-agent loop gives (BrainService.agentReply). The user then reads WHAT kept
 * failing and what is needed, instead of an error; the loop error is surfaced only if THIS closing turn is also empty. This
 * does not depend on which model answered, so it also rescues a weak auto-selected model that thrashed.
 *
 * ONE copy for both engines: the Brain's loop (`runLoop.ts`) and the agent's adapter tail (`run/loopSettle.ts`) call it.
 */

import { replayTextOf } from '@builderforce/agent-loop';
import { nextTurn } from '@builderforce/run-policy';
import { servedOnDevice } from '@builderforce/local-inference';
import { windowed } from '@seanhogg/builderforce-memory/working';
import { accrueByoUnresolved, accrueProviderCap, emit, emitStreaming, nowIso, nowMs, pushTrace, recordAppended, recordRunFailure } from './runCells';
import { asLiveTurn, canonicalTurnText, connectRetryStep, liveTurnModel, provenanceMetadata } from './turnPersistence';
import { emitEvermindLearnReconcile } from './runMemory';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import type { RunLoopContext } from './runLoopContext';

/** Force the tools-free closing answer for a run stopped after `streak` failed calls at `step`, and settle it on the chat. */
export async function closeAfterFailureStreak(run: RunLoopContext, streak: number, step: number): Promise<void> {
  const { c, chatId, req, convo, systemPrompt, metadata } = run;
  const { routingMode, stream, persistence, onActivity, maxTokens, reasoning } = req;
  c.streamingText = '';
  if (!c.abort?.signal.aborted) {
    const closeStart = nowMs();
    try {
      const working: ChatCompletionMessage[] = [
        { role: 'system', content: systemPrompt },
        ...windowed(convo),
        {
          role: 'user',
          content:
            `This turn was stopped because your last ${streak} tool calls all failed. Do NOT call any more tools. Answer the user now, in prose, using what you have already gathered — say what you completed, quote what the failing calls answered, and state plainly what is blocking you and what you need (a different argument, a permission, a decision) so the next turn can succeed.`,
        },
      ];
      let closeFirstTokenAt: number | undefined;
      const closeAsk = nextTurn(run.policy, { hasTools: false });
      const closing = await asLiveTurn(c, () => stream(
        // No `tools` → the model can't call another tool and must produce text.
        { messages: working, model: closeAsk.model, modelStrict: closeAsk.strict, routingMode, maxTokens, reasoning, metadata, signal: c.abort?.signal },
        {
          onModel: liveTurnModel(c),
          onConnectRetry: connectRetryStep(c, step),
          // The first token repaints now; every later delta coalesces into a frame (as `completeTurn` does).
          onTextDelta: (d) => {
            c.streamingText += d;
            if (closeFirstTokenAt === undefined) {
              closeFirstTokenAt = nowMs();
              emit(c);
              return;
            }
            emitStreaming(c);
          },
        },
      ));
      accrueByoUnresolved(c, closing.byoUnresolved);
      accrueProviderCap(c, closing.providerCap);
      // The closing turn may have failed over: its window is the model that answered it.
      run.windowFit.served(closing.resolvedModel ?? closeAsk.model);
      const contextWindow = await run.windowFit.contextWindow?.();
      pushTrace(c, {
        ts: nowIso(),
        category: 'llm',
        label: 'llm.complete',
        durationMs: nowMs() - closeStart,
        ttftMs: closeFirstTokenAt !== undefined ? closeFirstTokenAt - closeStart : undefined,
        args: { model: closing.resolvedModel ?? closeAsk.model ?? 'default', requestedModel: closeAsk.model ?? 'default', ...(servedOnDevice(closing) ? { costMc: 0 } : {}), step: step, toolCalls: 0, forcedFinish: true, failureStreak: streak, account: closing.account, byoUnresolved: closing.byoUnresolved, ...(contextWindow ? { contextWindow } : {}) },
        usage: closing.usage,
        finishReason: closing.finishReason,
        textChars: closing.text.length,
        result: `forced final synthesis (${streak} consecutive tool failures stopped the run) · ${closing.text.length} chars · finish: ${closing.finishReason ?? '—'}`,
      });
      const closingText = canonicalTurnText(closing.text);
      if (closingText) {
        convo.push({ role: 'assistant', content: replayTextOf(closingText) });
        const meta = provenanceMetadata(closing, closeAsk.model);
        const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: closingText, ...(meta ? { metadata: meta } : {}) }]);
        c.streamingText = '';
        recordAppended(c, assistantMsg);
        emit(c);
        // A forced-final answer still contributed server-side — emit the same memory
        // provenance (learn/reconcile steps + answer cache) as the normal branch.
        emitEvermindLearnReconcile(run, assistantMsg, closingText);
        onActivity?.(chatId);
        return;
      }
    } catch (e) {
      // A user Stop during the closing turn exits quietly; any other failure falls
      // through to the loop-exhausted error below (the run still ends, just noisier).
      if (c.abort?.signal.aborted) return;
    }
  }
  if (c.abort?.signal.aborted) return;

  c.streamingText = '';
  recordRunFailure(
    c,
    'agent.loop',
    `Stopped after ${streak} consecutive failed tool calls over ${step} steps (a forced final answer without tools also came back empty)`,
  );
  c.error = `The assistant's last ${streak} tool calls all failed and it gave no answer. Read the failing steps above, then try again with what they ask for.`;
  emit(c);
}

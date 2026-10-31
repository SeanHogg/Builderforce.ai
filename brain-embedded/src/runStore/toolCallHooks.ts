/**
 * The loop hooks around a turn's TOOL CALLS — before they dispatch (a terminal
 * `ask_user` settles the run; anything the turn said is kept as its own block) and
 * after each one ran (its durable step, the read cache, and the tool pinned into every
 * later turn's selection).
 */

import type { LoopHooks } from '@builderforce/agent-loop';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { isFailedToolResult } from '../brainTriage';
import { emit, nowIso, nowMs, pushTrace } from './runCells';
import { commitTurnNarration, terminalAskReply } from './turnToolCalls';
import { emitEvermindLearnReconcile } from './runMemory';
import { metaOf, settleReply, type RunLoopContext } from './runLoopContext';
import { recordShellFileRead } from './shellReadCoverage';

type Hooks = LoopHooks<ChatCompletionMessage>;

/** `beforeToolCalls`: a terminal `ask_user` settles the run; otherwise the turn's
 *  narration is committed before the calls run. */
export function beforeToolCallsHook(run: RunLoopContext): NonNullable<Hooks['beforeToolCalls']> {
  const { c, chatId } = run;
  const { onActivity } = run.req;
  return async (ctx, turn, calls) => {
    const { result, requested } = metaOf(turn);
    // What the turn SAID it would do, judged against what its calls do (`progressGuard.ts`).
    run.progress.noteTurnText(result.text);
    // A terminal `ask_user` settles the run on the question (`turnToolCalls.ts`).
    const reply = terminalAskReply(run, result, calls, ctx.step);
    if (reply) {
      const assistantMsg = await settleReply(run, reply, result, requested);
      emit(c);
      emitEvermindLearnReconcile(run, assistantMsg, reply);
      onActivity?.(chatId);
      return { action: 'stop', ok: true, output: reply };
    }
    await commitTurnNarration(run, result, requested);
    return undefined;
  };
}

/** `afterDispatch`: the call's durable step, its read cached against the row carrying
 *  it, and the tool pinned for later turns. */
export function afterDispatchHook(run: RunLoopContext): NonNullable<Hooks['afterDispatch']> {
  const { c, readCoverage, usedTools } = run;
  return (call, result, row) => {
    // Every call the model made, cache-answered or run — the progress detector judges both.
    run.progress.observe(call.name, call.args, result);
    if (run.pendingReplay) {
      // Keep the replayed read anchored to the message that now carries it.
      const replay = run.pendingReplay;
      readCoverage.cacheResult(replay.name, replay.args, { result: replay.result, ...(replay.served !== undefined ? { served: replay.served } : {}), anchor: row });
      run.pendingReplay = null;
      return undefined;
    }
    const ran = run.pendingRun;
    run.pendingRun = null;
    // Router answers, declined confirms and dedupe stubs carry no run of their own.
    if (!ran) return undefined;
    // The host ran this call: the run touched the world again (`cacheServedStreak.ts`).
    run.cacheStreak.ran();
    const args = call.args;
    if (ran.threw) {
      pushTrace(c, { ts: nowIso(), category: 'tool', label: call.name, durationMs: nowMs() - ran.toolStart, args, result: ran.out, isError: true });
      return undefined;
    }
    // Keep what a successful read returned, anchored to the message that carries
    // it, so an exact repeat can be replayed once compaction removes that message —
    // and what the model was SERVED of it, which is all coverage may claim (PRD 35 E1:
    // the untrimmed copy claimed lines 251–534 of a file the model saw 1–250 of).
    if (ran.isReadTool && !isFailedToolResult(ran.out)) {
      readCoverage.cacheResult(call.name, args, { result: ran.out ?? null, ...(ran.served !== undefined ? { served: ran.served } : {}), anchor: row });
    } else if (!isFailedToolResult(ran.out)) {
      // A read-only shell print of one file is a read of those lines.
      recordShellFileRead(readCoverage, call.name, args, ran.out, ran.truncated !== true, row);
    }
    pushTrace(c, {
      ts: nowIso(),
      category: 'tool',
      label: call.name,
      durationMs: nowMs() - ran.toolStart,
      args,
      result: ran.out ?? null,
      isError: isFailedToolResult(ran.out),
      resultBytes: ran.bytes,
      truncated: ran.truncated,
    });
    // Pin this tool into every later turn's selection — a multi-step task must
    // never lose a tool it is mid-way through using.
    usedTools.add(call.name);
    // The run's own record — successes only, so the ledger never claims a read that failed.
    if (!isFailedToolResult(ran.out)) run.knowledge.record(call.name, args);
    return undefined;
  };
}

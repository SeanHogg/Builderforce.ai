/**
 * The loop hooks around a turn's TOOL CALLS — before they dispatch (a terminal
 * `ask_user` settles the run; anything the turn said is kept as its own block) and
 * after each one ran (its durable step, the read cache, and the tool pinned into every
 * later turn's selection).
 */

import { ASK_USER_TOOL, askUserBlock, type LoopHooks } from '@builderforce/agent-loop';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { isFailedToolResult } from '../brainTriage';
import { leftDelegationUndone } from '../delegationRequest';
import { emit, nowIso, nowMs, pushTrace, runTrace } from './runCells';
import { persistMidTurnText } from './turnPersistence';
import { emitEvermindLearnReconcile } from './runMemory';
import { metaOf, settleReply, type RunLoopContext } from './runLoopContext';
import { recordShellFileRead } from './shellReadCoverage';

type Hooks = LoopHooks<ChatCompletionMessage>;

/** `beforeToolCalls`: a terminal `ask_user` settles the run; otherwise the turn's
 *  narration is committed before the calls run. */
export function beforeToolCallsHook(run: RunLoopContext): NonNullable<Hooks['beforeToolCalls']> {
  const { c, chatId, catalogToolNames, userRequest } = run;
  const { runTool, persistence, onActivity } = run.req;
  return async (ctx, turn, calls) => {
    const { result, requested } = metaOf(turn);
    // `ask_user` is TERMINAL: the agent is blocked on the user's decision, so the run
    // settles here and the reply carries any lead-in prose plus the canonical
    // ```ask-user block the transcript renders as a clickable card. Without this the
    // editor's chat advertised a question it could never deliver — the card and the
    // "Answer needed" banner were wired on the surface with nothing able to produce
    // one, so every question arrived as prose the reader could only re-type.
    // Malformed args fall through to the prose path below, so a question is never
    // swallowed by its own formatting.
    const askCall = calls.find((tc) => tc.name === ASK_USER_TOOL);
    // The user asked for SUB-AGENTS and the run is asking how to proceed instead of
    // starting one (chat #133: "execution is disabled… no developer agents" — both
    // about the cloud, neither about a local child). The question is not settled as
    // the reply: the call dispatches and `beforeDispatch` answers it with the
    // delegation contract, so the model's next turn spawns. Once per run — asked
    // again after that, the question is the answer.
    if (askCall && runTool && !run.delegationRecoveryUsed && leftDelegationUndone({
      toolNames: catalogToolNames,
      requestText: userRequest,
      events: runTrace(c),
    })) {
      run.delegationRecoveryUsed = true;
      run.redirectAskToDelegation = true;
      pushTrace(c, {
        ts: nowIso(),
        category: 'message',
        label: 'loop.recover_undelegated_request',
        args: { step: ctx.step, via: 'ask_user' },
        result: 'The user asked for sub-agents and the run asked how to proceed without starting one — answered with the local delegation contract instead of settling the question.',
      });
    } else if (askCall) {
      let block: string | null = null;
      try { block = askCall.malformed ? null : askUserBlock(askCall.args); } catch { block = null; }
      const lead = result.text.trim();
      const reply = block ? (lead ? `${lead}\n\n${block}` : block) : lead;
      if (reply) {
        const assistantMsg = await settleReply(run, reply, result, requested);
        emit(c);
        emitEvermindLearnReconcile(run, assistantMsg, reply);
        onActivity?.(chatId);
        return { action: 'stop', ok: true, output: reply };
      }
      // A bare malformed call with no prose: let it dispatch, where `beforeDispatch`
      // answers with the corrective result telling the model how to retry.
    }
    // Commit this turn's visible narration as its OWN permanent message block
    // before we clear the streaming buffer for the next iteration. Without
    // this, the narration only lived in the transient `streamingText` bubble,
    // and the next turn's stream reused that same bubble — erasing what the
    // user just read.
    await persistMidTurnText(chatId, c, persistence, result, requested);
    c.streamingText = '';
    emit(c);
    return undefined;
  };
}

/** `afterDispatch`: the call's durable step, its read cached against the row carrying
 *  it, and the tool pinned for later turns. */
export function afterDispatchHook(run: RunLoopContext): NonNullable<Hooks['afterDispatch']> {
  const { c, readCoverage, usedTools } = run;
  return (call, _result, row) => {
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

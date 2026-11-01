/**
 * What a tool call leaves once its result row is in the transcript - the call's durable step, its read cached against the row
 * carrying it, the tool pinned for later turns. Not a loop hook by name: the Brain's loop (`runLoop.ts`, as `afterDispatch`) and
 * the agent's platform tools (`run/brainPlatformTools.ts`) both run it, so deleting the loop leaves it where it is.
 */

import type { LoopHooks } from '@builderforce/agent-loop';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { isFailedToolResult } from '../brainTriage';
import { nowIso, nowMs, pushTrace } from './runCells';
import type { RunLoopContext } from './runLoopContext';
import { recordShellFileRead } from './shellReadCoverage';

type Hooks = LoopHooks<ChatCompletionMessage>;

/** `afterDispatch`: the call's durable step, its read cached against the row carrying
 *  it, and the tool pinned for later turns. */
export function callPostStep(run: RunLoopContext): NonNullable<Hooks['afterDispatch']> {
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

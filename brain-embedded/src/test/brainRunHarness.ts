/**
 * A scripted Brain run for the adapter tests: a stream that replays completions in the
 * stream's own result shape, and the binding of one run - a claimed cell, a request over the
 * stream, the capabilities of a surface that can do nothing, and the event sink, run store and
 * steering source the Brain builds over the cell - that `buildBrainRunPorts` takes. `runBound`
 * drives a binding to its outcome. Test support only.
 */

import { runAgent, runSteeringSource, type RunOutcome } from '@builderforce/agent-run';
import type { StreamChatResult } from '../streamChatCompletion';
import { beginRun } from '../runStore/beginRun';
import { getCell } from '../runStore/runCells';
import type { BrainRunRequest } from '../runStore/runTypes';
import { brainEventSink } from '../run/eventSink';
import { loopRunStore } from '../run/loopStore';
import { brainRunPolicy, brainRunTask, buildBrainRunPorts, type BrainEntryPoint, type BrainRunBinding } from '../run/webAdapter';

/** A scripted completion in the stream's own result shape. */
export function result(over: Partial<StreamChatResult> = {}): StreamChatResult {
  return { text: '', toolCalls: [], finishReason: 'stop', resolvedModel: 'fake-model', usage: { prompt: 10, completion: 4 }, ...over };
}

/** A stream that replays `turns` and records what it was asked. */
export function scripted(turns: Array<(opts: Parameters<BrainRunRequest['stream']>[0]) => StreamChatResult | Promise<StreamChatResult>>) {
  const asked: Array<Parameters<BrainRunRequest['stream']>[0]> = [];
  let n = 0;
  const stream: BrainRunRequest['stream'] = async (opts) => {
    asked.push(opts);
    const turn = turns[n];
    n += 1;
    if (!turn) throw new Error('script exhausted');
    return turn(opts);
  };
  return { stream, asked };
}

export const persistence = { sendMessages: async () => [] } as BrainRunRequest['persistence'];

export function binding(runKey: number, stream: BrainRunRequest['stream'], entryPoint: BrainEntryPoint = 'web', extra: Partial<BrainRunRequest> = {}) {
  const cell = getCell(runKey);
  beginRun(cell, runKey);
  const req: BrainRunRequest = { resolvedSystemPrompt: 'sys', stream, persistence, ...extra };
  const rows: unknown[] = [];
  const bound: BrainRunBinding = {
    entryPoint,
    cell,
    runKey,
    req,
    request: 'Say hello, then finish.',
    capabilities: { capabilities: new Set<never>() },
    events: brainEventSink(cell, (row) => void rows.push(row)),
    store: loopRunStore(cell, { toolRowAppended: () => undefined }),
    steering: runSteeringSource(runKey),
  };
  return { cell, rows, binding: bound };
}

/** Drive a binding to its outcome through the agent, over the Brain's ports. */
export function runBound(b: BrainRunBinding): Promise<RunOutcome> {
  const signal = b.cell.abort?.signal;
  return runAgent({ task: brainRunTask(b), policy: brainRunPolicy(b), ports: buildBrainRunPorts(b), ...(signal ? { signal } : {}) });
}

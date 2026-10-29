/**
 * A scripted Brain run for the adapter tests: a stream that replays completions in the
 * stream's own result shape, and the binding of one run - a claimed cell, a request over the
 * stream, the capabilities of a surface that can do nothing - that `buildBrainRunPorts` /
 * `runViaAgent` take. Test support only.
 */

import type { StreamChatResult } from '../streamChatCompletion';
import { beginRun } from '../runStore/beginRun';
import { getCell } from '../runStore/runCells';
import type { BrainRunRequest } from '../runStore/runTypes';
import type { BrainEntryPoint, BrainRunBinding } from '../run/webAdapter';

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
  const bound: BrainRunBinding = { entryPoint, cell, runKey, req, request: 'Say hello, then finish.', capabilities: { capabilities: new Set<never>() }, reportOutcome: (row) => void rows.push(row) };
  return { cell, rows, binding: bound };
}

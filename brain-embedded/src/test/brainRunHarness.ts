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
import { applyModelPreflight } from '../runStore/modelPreflight';
import { getCell } from '../runStore/runCells';
import type { BrainRunRequest, RunEntryPoint } from '../runStore/runTypes';
import { brainEventSink } from '../run/eventSink';
import { brainRunStorePort } from '../run/brainStore';
import type { TurnObserver } from '../run/modelTransport';
import { recordedModelHook } from '../run/preflightRecorded';
import { brainRunPolicy, brainRunTask, buildBrainRunPorts, type BrainRunBinding } from '../run/webAdapter';

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

/**
 * The smallest real turn observer the transport accepts (`brainTurn.ts` is the production one): no live view, no record, the turn's
 * `max_tokens` the request's own. Every transport is built over one, so a test drives the path production runs.
 */
export const plainTurn: TurnObserver = {
  open: (request) => ({ handlers: {}, maxTokens: request.maxTokens, completed: () => undefined, failed: (error) => error }),
};

export const persistence = { sendMessages: async () => [] } as BrainRunRequest['persistence'];

export function binding(runKey: number, stream: BrainRunRequest['stream'], entryPoint: RunEntryPoint = 'web', extra: Partial<BrainRunRequest> = {}) {
  const cell = getCell(runKey);
  beginRun(cell, runKey);
  const req: BrainRunRequest = { resolvedSystemPrompt: 'sys', stream, persistence, ...extra };
  const rows: unknown[] = [];
  const bound: BrainRunBinding = {
    entryPoint,
    req,
    request: 'Say hello, then finish.',
    turn: plainTurn,
    capabilities: { capabilities: new Set<never>() },
    events: brainEventSink(cell, (row) => void rows.push(row)),
    store: brainRunStorePort(cell, { toolRowAppended: () => undefined }),
    steering: runSteeringSource(runKey),
  };
  return { cell, rows, binding: bound };
}

/** One bound run: its claimed cell, the outcome rows its sink collected and the binding `buildBrainRunPorts` takes. */
export type BoundRun = ReturnType<typeof binding>;

/**
 * The agent's modules as production hands them (`run/runPrepared.ts`): the model preflight only SAYS the verdict the preamble left on
 * the cell, so the host's check (`req.modelPreflight`) runs here the way the preamble runs it (`runStore/hostRunContext.ts`).
 */
export async function preflightedModules(h: BoundRun): Promise<{ model: ReturnType<typeof recordedModelHook> }> {
  const { req } = h.binding;
  await applyModelPreflight(h.cell, req.modelPreflight, req.model);
  return { model: recordedModelHook(h.cell, req.model) };
}

/** Drive a bound run to its outcome through the agent, over the Brain's ports. */
export async function runBound(h: BoundRun): Promise<RunOutcome> {
  const signal = h.cell.abort?.signal;
  const modules = await preflightedModules(h);
  return runAgent({ task: brainRunTask(h.binding), policy: brainRunPolicy(h.binding), ports: buildBrainRunPorts(h.binding), modules, ...(signal ? { signal } : {}) });
}

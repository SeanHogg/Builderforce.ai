/**
 * Run ONE scripted Brain run through the real `startRun` on a named engine, and read back everything an observer of it could
 * see: the stream's every request, the messages the run saved, the trace, the cell. A parity test runs the same script on the
 * `loop` engine and on the `agent` engine and holds the second to the first. Test support only.
 */

import { getRunTrace, resetBrainRunStore, startRun } from '../brainRunStore';
import type { BrainStreamFn } from '../brainRunStore';
import type { BrainTraceEvent } from '../brainTriage';
import { resetRunSteering } from '../runSteering';
import { getCell } from '../runStore/runCells';
import type { RunCell } from '../runStore/runCell';
import type { BrainRunRequest, RunEngineId } from '../runStore/runTypes';
import type { StreamChatResult } from '../streamChatCompletion';

export type StreamOpts = Parameters<BrainStreamFn>[0];
export type Saved = { role: string; content: string; metadata?: string | null };

export interface Observed {
  engine: RunEngineId;
  /** Every request the run made to the stream, in order (the summarizer's included). */
  asked: StreamOpts[];
  /** Every message the run saved (steps included). */
  saved: Saved[];
  trace: BrainTraceEvent[];
  cell: RunCell;
}

/** What a scenario hands the run: the host's request, minus what the kit owns. It is built fresh per engine, for the run key it will use. */
export type Scenario = (key: number) => Omit<BrainRunRequest, 'persistence' | 'engine' | 'resolvedSystemPrompt'> & { persistence?: BrainRunRequest['persistence']; resolvedSystemPrompt?: string };

export async function runOn(engine: RunEngineId, key: number, scenario: Scenario): Promise<Observed> {
  resetBrainRunStore();
  resetRunSteering();
  const asked: StreamOpts[] = [];
  const saved: Saved[] = [];
  let id = 0;
  const req = scenario(key);
  const persistence = req.persistence ?? ({
    sendMessages: async (chatId: number, msgs: Saved[]) => {
      saved.push(...msgs);
      return msgs.map((m) => ({ id: (id += 1), seq: id, chatId, createdAt: '', ...m, metadata: m.metadata ?? null }));
    },
  } as never);
  const stream: BrainStreamFn = async (opts, handlers) => {
    asked.push(opts);
    return req.stream(opts, handlers);
  };
  await startRun(key, { resolvedSystemPrompt: 'sys', ...req, persistence, stream, engine });
  return { engine, asked, saved, trace: getRunTrace(key), cell: getCell(key) };
}

/** The same scenario on both engines (a fresh script each), the loop first. */
export async function bothEngines(key: number, scenario: Scenario): Promise<{ loop: Observed; agent: Observed }> {
  const loop = await runOn('loop', key, scenario);
  const agent = await runOn('agent', key + 1, scenario);
  return { loop, agent };
}

/** A scripted model: replays `turns` in order and fails loudly when the run asks for more. */
export function script(turns: Array<(opts: StreamOpts) => StreamChatResult | Promise<StreamChatResult>>): BrainStreamFn {
  let n = 0;
  return async (opts) => {
    const turn = turns[n];
    n += 1;
    if (!turn) throw new Error(`script exhausted at request ${n}`);
    return turn(opts);
  };
}

export const answer = (text: string, over: Partial<StreamChatResult> = {}) => (): StreamChatResult => ({ text, toolCalls: [], finishReason: 'stop', resolvedModel: 'm', usage: { prompt: 10, completion: 4 }, ...over });

export const callTool = (name: string, args: Record<string, unknown> = {}, text = '', id = `c-${name}`, over: Partial<StreamChatResult> = {}) => (): StreamChatResult => ({
  text, toolCalls: [{ id, name, args: JSON.stringify(args) }], finishReason: 'tool_calls', resolvedModel: 'm', usage: { prompt: 10, completion: 4 }, ...over,
});

export const toolSpec = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object', properties: {} } } });

/** The labels of a trace, in order. */
export const labelsOf = (events: readonly BrainTraceEvent[]): string[] => events.map((e) => e.label);

/** The trace events with this label. */
export const stepsLabelled = (events: readonly BrainTraceEvent[], label: string): BrainTraceEvent[] => events.filter((e) => e.label === label);

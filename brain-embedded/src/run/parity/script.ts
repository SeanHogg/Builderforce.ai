/**
 * The scripted model, in the stream's own result shape. A scenario lists the turns the model takes; the
 * harness replays them identically for both engines. Nothing here knows an engine: a turn is what the
 * gateway would have returned, and a throw is what the transport would have thrown.
 */

import type { AssembledToolCall, StreamChatResult } from '../../streamChatCompletion';
import type { ScriptedTurn, TurnInput } from './types';

/** The gateway's default completion in the stream's result shape. */
export function completion(over: Partial<StreamChatResult> = {}): StreamChatResult {
  return { text: '', toolCalls: [], finishReason: 'stop', resolvedModel: 'fake-model', usage: { prompt: 10, completion: 4 }, ...over };
}

/** A tool call as the stream assembles it; `args` is the JSON string the model wrote. */
export function call(name: string, args: unknown = {}, id?: string): AssembledToolCall {
  return { id: id ?? `call_${name}_${typeof args === 'string' ? args : JSON.stringify(args)}`.slice(0, 60), name, args: typeof args === 'string' ? args : JSON.stringify(args) };
}

/** A turn that answers in prose. */
export const reply = (text: string, over: Partial<StreamChatResult> = {}): ScriptedTurn => () => completion({ text, ...over });

/** A turn that calls tools (optionally saying something first). */
export const calls = (list: AssembledToolCall[], over: Partial<StreamChatResult> = {}): ScriptedTurn => () =>
  completion({ toolCalls: list, finishReason: 'tool_calls', ...over });

/** A turn that fails the way the transport does. */
export const fails = (error: unknown): ScriptedTurn => () => { throw error; };

/** A turn that decides from the request it is handed. */
export const decide = (f: (input: TurnInput) => StreamChatResult | Promise<StreamChatResult>): ScriptedTurn => f;

/**
 * A turn that streams until the person presses Stop: it names its model, streams `deltas`, signals
 * `started`, and rejects when the request's signal aborts, as the fetch does.
 */
export function streamsUntilStopped(started: () => void, deltas: string[] = [], model: string | null = 'fake-model'): ScriptedTurn {
  return ({ opts, handlers }) => new Promise<StreamChatResult>((_resolve, reject) => {
    if (model) handlers?.onModel?.(model, 'own');
    for (const d of deltas) handlers?.onTextDelta?.(d);
    opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    started();
  });
}

/** The first line of the memory package's summarizer prompt: what makes a model call a fold's summary. */
export const SUMMARY_PROMPT_HEAD = 'You compress an in-progress AI agent transcript';

/** True for the summarizer's call (system prompt = the memory package's, no tools, no turn of the run's own). */
export function isSummaryCall(opts: { messages: Array<{ role: string; content?: unknown }>; tools?: unknown }): boolean {
  const first = opts.messages[0];
  return first?.role === 'system' && typeof first.content === 'string' && first.content.startsWith(SUMMARY_PROMPT_HEAD);
}

/** A block of prose of about `tokens` tokens (4 characters each), distinct per `tag`, for filling a window. */
export function bulk(tag: string, tokens: number): string {
  const sentence = `${tag}: the service reads the manifest, validates each entry and records the result. `;
  return sentence.repeat(Math.ceil((tokens * 4) / sentence.length)).slice(0, tokens * 4);
}

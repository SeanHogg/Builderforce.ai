/**
 * Builds a recorded run in the shapes its producers write — the run-findings tests and the chat #70776 fixture use it
 * so neither guesses at a step. Each shape names its producer:
 *  - `llm.complete` + `agent.message`: `runStore/turnRecorder.ts` (`recordTurn`): args model/requestedModel/step/role/
 *    toolCalls/argBytes/account/advertisedTools/catalogTools, plus usage/finishReason/textChars on the event;
 *  - tool steps: `runStore/callPostStep.ts` (args verbatim, result, isError, resultBytes), and the hand-off's own
 *    steps from `runStore/callPreflight.ts` (`{ …args, auto: true, reason: 'hand_off' }`);
 *  - markers: `loop.hand_off_due` (`runStore/progressBudget.ts`), `llm.role_handoff` (`runPolicyTraces.ts`),
 *    `hand_off.mode` (`handOffParallelism.ts`), `agent.stopped` (`runStore/turnPersistence.ts`).
 * `messages()` persists every step through the shared `stepRow` (agent-loop), exactly as `persistStep` does, so a
 * test reads the run back the way the VS Code host will: `traceWithPersistedSteps(messages, [])`.
 */
import { stepRow } from '@builderforce/agent-loop';
import type { BrainTraceEvent } from '../../brainTriage';
import { utf8ByteLength } from '../../composingActivity';
import { STOPPED_TURN_STEP } from '../../stoppedTurn';
import type { BrainMessage } from '../../types';

export interface BuiltCall {
  name: string;
  args: Record<string, unknown>;
  /** What the tool returned; `{ ok: true }` when omitted. */
  result?: unknown;
  durationMs?: number;
}

export interface BuiltTurn {
  role: string;
  model?: string;
  requestedModel?: string;
  calls?: BuiltCall[];
  /** Calls the model emitted that the loop answered itself (no tool step) — counted in `toolCalls`/`argBytes`. */
  loopAnswered?: BuiltCall[];
  text?: string;
  durationMs?: number;
  prompt?: number;
  completion?: number;
  advertisedTools?: number;
  argBytes?: number;
}

const json = (v: unknown): string => JSON.stringify(v);

export class TraceBuilder {
  readonly events: BrainTraceEvent[] = [];
  private clock: number;
  private step = 0;
  private readonly userAsk: string;

  constructor(ask = 'Change the code.', startIso = '2026-11-08T14:00:00.000Z') {
    this.userAsk = ask;
    this.clock = Date.parse(startIso);
  }

  private at(advanceMs: number): string {
    this.clock += Math.max(1, Math.round(advanceMs));
    return new Date(this.clock).toISOString();
  }

  /** One completed model turn and the tool steps its calls left. */
  turn(t: BuiltTurn): this {
    this.step += 1;
    const calls = t.calls ?? [];
    const emitted = [...(t.loopAnswered ?? []), ...calls];
    const argBytes = t.argBytes ?? emitted.reduce((sum, c) => sum + utf8ByteLength(json(c.args)), 0);
    const text = t.text ?? '';
    const durationMs = t.durationMs ?? 5_000;
    const prompt = t.prompt ?? 20_000;
    const completion = t.completion ?? 200;
    const model = t.model ?? 'local/kimi-code/kimi-for-coding';
    this.events.push({
      ts: this.at(durationMs),
      category: 'llm',
      label: 'llm.complete',
      durationMs,
      ttftMs: Math.min(durationMs, 1_200),
      args: {
        model,
        requestedModel: t.requestedModel ?? 'default',
        step: this.step,
        role: t.role,
        toolCalls: emitted.length,
        ...(argBytes > 0 ? { argBytes } : {}),
        account: 'byo',
        advertisedTools: t.advertisedTools ?? 38,
        catalogTools: 64,
        ...(emitted.length === 0 && text.trim() ? { answeredInProse: true } : {}),
      },
      usage: { prompt, completion, total: prompt + completion },
      finishReason: emitted.length ? 'tool_calls' : 'stop',
      textChars: text.length,
      result: `${emitted.length} tool call(s) · ${text.length} chars · finish: ${emitted.length ? 'tool_calls' : 'stop'} · prompt ${prompt} tok`,
    });
    if (text.trim()) this.events.push({ ts: this.at(1), category: 'message', label: 'agent.message', args: { step: this.step }, result: text });
    for (const c of calls) this.tool(c);
    return this;
  }

  /** A tool step as `callPostStep` records it. */
  tool(c: BuiltCall): this {
    const result = c.result ?? { ok: true };
    const failed = !!result && typeof result === 'object' && ((result as { ok?: unknown }).ok === false);
    this.events.push({
      ts: this.at(c.durationMs ?? 40),
      category: 'tool',
      label: c.name,
      durationMs: c.durationMs ?? 40,
      args: c.args,
      result,
      isError: failed,
      resultBytes: utf8ByteLength(json(result)),
      truncated: false,
    });
    return this;
  }

  /** A `message` marker (`loop.hand_off_due`, `llm.role_handoff`, `hand_off.mode`, …). */
  marker(label: string, args: Record<string, unknown>, result = ''): this {
    this.events.push({ ts: this.at(2), category: 'message', label, args: { step: this.step, ...args }, result });
    return this;
  }

  /** The user's Stop while `model` was streaming. */
  stop(model = 'local/kimi-code/kimi-for-coding', keptChars = 0): this {
    this.events.push({
      ts: this.at(500), category: 'message', label: STOPPED_TURN_STEP, args: { model }, textChars: keptChars,
      result: `Stopped by user while ${model} was streaming (${keptChars} chars kept).`,
    });
    return this;
  }

  /** The chat as the journal holds it: the user's ask, then every step persisted through `stepRow`. */
  messages(): BrainMessage[] {
    const first = this.events[0]?.ts ?? new Date(this.clock).toISOString();
    const ask: BrainMessage = { id: 1, seq: 1, role: 'user', content: this.userAsk, metadata: null, createdAt: first };
    return [ask, ...this.events.map((ev, i): BrainMessage => {
      const row = stepRow(ev);
      return { id: i + 2, seq: i + 2, role: row.role, content: row.content, metadata: row.metadata, createdAt: ev.ts };
    })];
  }
}

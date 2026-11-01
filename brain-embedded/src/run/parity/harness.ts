/**
 * Run one scenario through the REAL `startRun` on one engine and return what every observer saw.
 *
 * Production binding: `startRun` -> `driveRun` -> `prepareRunLoop` -> `runPrepared` (agent) or `runLoop`
 * (loop). The engine is chosen the way a host chooses it, on `BrainRunRequest.engine`, never by touching
 * an internal. The fake is the model stream, the host's persistence and its tool port - the three
 * things a host supplies - and nothing between them.
 */

import { transcriptSeedOf } from '../../transcriptSeed';
import { startRun } from '../../runStore/startRun';
import { resetBrainRunStore } from '../../runStore/runControl';
import { resetRunSteering } from '../../runSteering';
import type { BrainRunRequest, BrainStreamFn, RunEngineId } from '../../runStore/runTypes';
import type { BrainToolSpec, StreamChatResult } from '../../streamChatCompletion';
import { isSummaryCall, completion } from './script';
import { Recorder, copyWire } from './recorder';
import { normalise } from './normalise';
import type { HostTool, RunRecord, Scenario, ScenarioHost, ScriptedTurn, TurnInput } from './types';

const DEFAULT_KEY = 7001;
/** No scenario needs more than this many model calls; a run past it is not ending. */
const MAX_MODEL_CALLS = 120;

/** A tool spec the model is shown, for a host tool the scenario named. */
const specOf = (name: string): BrainToolSpec => ({ type: 'function', function: { name, description: `Parity tool ${name}.`, parameters: { type: 'object', properties: {} } } });

/** Tell the stream's handlers what the real transport tells them as the response arrives. */
function narrate(res: StreamChatResult, input: TurnInput): void {
  const h = input.handlers;
  if (!h) return;
  if (res.resolvedModel) h.onModel?.(res.resolvedModel, res.account);
  res.toolCalls.forEach((tc, i) => {
    h.onToolCallDelta?.(i, { id: tc.id, name: tc.name });
    h.onToolCallDelta?.(i, { argsFragment: tc.args });
  });
  if (res.text) h.onTextDelta?.(res.text);
  h.onDone?.(res.finishReason);
}

class Host implements ScenarioHost {
  private turns: ScriptedTurn[] = [];
  private summary: string | ((input: TurnInput) => string | Promise<string>) | undefined;
  private taken = 0;
  private calls = 0;
  private impl: Record<string, HostTool> | undefined;
  private confirmNames = new Set<string>();

  constructor(readonly engine: RunEngineId, readonly rec: Recorder, readonly key: number = DEFAULT_KEY) {}

  private fallback: ScriptedTurn | undefined;

  react(turn: ScriptedTurn): void {
    this.fallback = turn;
  }

  preload(rows: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, key = this.key): number[] {
    return rows.map((r) => this.rec.store(key, r.role, r.content));
  }

  saveUser(text: string, key = this.key): number {
    return this.rec.store(key, 'user', text);
  }

  seedOf(key = this.key) {
    const history = this.rec.stored.filter((m) => (m as { chatId?: number }).chatId === key);
    const { messages, ids } = transcriptSeedOf(history);
    return { seed: messages, seedIds: ids };
  }

  script(turns: ScriptedTurn[], summary?: string | ((input: TurnInput) => string | Promise<string>)): void {
    this.turns = turns;
    this.taken = 0;
    this.fallback = undefined;
    this.summary = summary;
  }

  tools(impl: Record<string, HostTool>, confirm: string[] = []): void {
    this.impl = impl;
    this.confirmNames = new Set(confirm);
  }

  private readonly stream: BrainStreamFn = async (opts, handlers) => {
    this.calls += 1;
    // A scenario whose engine never ends (a model that keeps calling tools, a loop that never closes) must fail, not hang the suite.
    if (this.calls > MAX_MODEL_CALLS) throw new Error(`parity: more than ${MAX_MODEL_CALLS} model calls - the run does not end`);
    const input: TurnInput = { opts, handlers, call: this.calls };
    const summarising = isSummaryCall(opts);
    this.rec.wire.push({ ...copyWire(opts as unknown as Record<string, unknown>), ...(summarising ? { summary: true } : {}) });
    if (summarising) {
      const note = typeof this.summary === 'function' ? await this.summary(input) : (this.summary ?? 'Earlier work, compressed.');
      return completion({ text: note });
    }
    const turn = this.turns[this.taken] ?? this.fallback;
    this.taken += 1;
    if (!turn) throw new Error('parity script exhausted');
    const res = await turn(input);
    narrate(res, input);
    return res;
  };

  private request(over: Partial<BrainRunRequest>): BrainRunRequest {
    const impl = this.impl;
    return {
      resolvedSystemPrompt: 'You are the Brain.',
      stream: this.stream,
      persistence: this.rec.persistence,
      onActivity: this.rec.onActivity,
      userTurn: 'Say hello, then finish.',
      engine: this.engine,
      reportOutcome: async (o) => { this.rec.reported.push(o); },
      recordRunOutcome: (e) => { this.rec.ended.push(e); },
      recordAvoidedCall: (a) => { this.rec.avoided.push(a); },
      ...(impl ? {
        tools: Object.keys(impl).map(specOf),
        runTool: async (name: string, args: unknown) => {
          this.rec.toolCalls.push({ name, args });
          const f = impl[name];
          if (!f) return { ok: false, error: `unknown tool ${name}` };
          return f(args);
        },
        needsConfirm: ({ name, args }: { name: string; args: unknown }) => {
          if (!this.confirmNames.has(name)) return false;
          this.rec.confirmAsks.push({ name, args });
          return true;
        },
      } : {}),
      ...over,
    };
  }

  begin(over: Partial<BrainRunRequest> = {}, key = this.key) {
    this.rec.watch(key);
    return startRun(key, this.request(over));
  }

  async start(over: Partial<BrainRunRequest> = {}, key = this.key) {
    const outcome = await this.begin(over, key);
    await this.settle();
    return outcome;
  }

  reload(): void {
    resetBrainRunStore();
    resetRunSteering();
  }

  persistedMessages() {
    return this.rec.stored.map((m) => ({ ...m, chatId: (m as { chatId?: number }).chatId ?? this.key })) as ReturnType<ScenarioHost['persistedMessages']>;
  }

  async until(ok: () => boolean, label: string): Promise<void> {
    for (let i = 0; i < 4000; i += 1) {
      if (ok()) return;
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error(`never reached: ${label}`);
  }

  async settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  }
}

/** Run `scenario` on `engine` and return its normalised record. */
export async function runScenario(scenario: Scenario, engine: RunEngineId): Promise<RunRecord> {
  resetBrainRunStore();
  resetRunSteering();
  const rec = new Recorder();
  const host = new Host(engine, rec);
  try {
    await scenario.run(host);
    await host.settle();
  } catch (e) {
    rec.scenarioError = e instanceof Error ? e.message : String(e);
  }
  return normalise(JSON.parse(JSON.stringify(rec.toRecord())) as RunRecord);
}

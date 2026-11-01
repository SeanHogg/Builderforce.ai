/**
 * What the area R tests read of a run (PRD 35 WS4 parity rulings, "tools and how a run ends"). There is ONE two-engine runner:
 * the differential harness (`../parity/harness.ts`), which drives the real `startRun` once per engine on the production binding.
 * This file only scripts a conversation on it and projects its record down to what an area R row is about - the wire's menu and
 * messages, the rows the host persisted, the trace steps, the chat's error line - so a test holds the agent to the loop on that
 * projection alone, where the parity suite holds the whole record equal.
 */

import { isMidTurnMetadata } from '@builderforce/agent-loop';
import { isVolatileContent } from '@seanhogg/builderforce-memory/handoff';
import type { BrainRunRequest, RunEngineId } from '../../runStore/runTypes';
import type { StreamChatOptions, StreamChatResult } from '../../streamChatCompletion';
import { runScenario } from '../parity/harness';
import type { RunRecord, Scenario as ParityScenario } from '../parity/types';

export const spec = (name: string, description = name) => ({ type: 'function' as const, function: { name, description, parameters: {} } });

/** What a scripted model turn is handed. */
export interface TurnCtx {
  opts: Omit<StreamChatOptions, 'transport'>;
  /** 1-based number of the model call. */
  call: number;
  key: number;
}
export type Turn = (ctx: TurnCtx) => StreamChatResult | Promise<StreamChatResult>;

/** A turn that ends the run with `text`, as `model`. */
export const say = (text: string, model = 'm1'): Turn => () => ({ text, toolCalls: [], finishReason: 'stop', resolvedModel: model });
/** A turn that calls tools. */
export const calls = (...tcs: Array<{ name: string; args?: unknown; raw?: string }>): Turn => () => ({
  text: '',
  toolCalls: tcs.map((tc, i) => ({ id: `c${i + 1}-${tc.name}`, name: tc.name, args: tc.raw ?? JSON.stringify(tc.args ?? {}) })),
  finishReason: 'tool_calls',
  resolvedModel: 'm1',
});

export interface Wire {
  tools: string[];
  toolChoice: unknown;
  model: string | undefined;
  maxTokens: number | undefined;
  /** Every row but the system prompt and the per-request volatile tail. */
  messages: Array<{ role: string; content: string }>;
}

export interface Row { role: string; content: string; midTurn: boolean }

export interface Capture {
  wire: Wire[];
  /** The chat rows the host persisted (steps excluded), in order. */
  rows: Row[];
  trace: Array<{ label: string; args: Record<string, unknown> | undefined; result: unknown; isError: boolean }>;
  transcript: Array<{ role: string; content: string }>;
  error: string;
  toolCalls: Array<{ name: string; args: unknown }>;
  activity: number;
  threw: unknown;
  /** With a `follow`: how many model calls the first run made. */
  firstRunCalls?: number;
}

export interface Scenario {
  /** Kept for the reader: the parity host owns the run key. */
  key: number;
  script(): Turn[];
  request?(engine: RunEngineId): Partial<BrainRunRequest>;
  /** The host's tools by name (`runTool`); a name not here answers `{ ok: true }`. */
  tools?: Record<string, (args: unknown) => unknown>;
  /** A second run in the same chat, started when the first has settled (the model script goes on where it stopped). */
  follow?: { userTurn: string };
}

const textOf = (content: unknown): string => (typeof content === 'string' ? content : JSON.stringify(content));

/** The parity record of one engine, as the projection the area R tests read. */
function project(rec: RunRecord, key: number): Omit<Capture, 'firstRunCalls'> {
  const cell = rec.host.cell[String(key)] as { transcript?: Array<{ role: string; content: unknown }> } | undefined;
  return {
    wire: rec.wire.filter((w) => !w.summary).map((w) => ({
      tools: (w.tools ?? []).map((t) => t.function.name),
      toolChoice: w.tool_choice,
      model: w.model,
      maxTokens: w.maxTokens,
      messages: (w.messages as Array<{ role: string; content: unknown }>)
        .filter((m, i) => !(i === 0 && m.role === 'system') && !(m.role === 'user' && isVolatileContent(m.content as never)))
        .map((m) => ({ role: m.role, content: textOf(m.content) })),
    })),
    rows: rec.persisted.filter((r) => r.role !== 'tool').map((r) => ({ role: r.role, content: r.content, midTurn: isMidTurnMetadata(r.metadata) })),
    trace: (rec.trace[String(key)] ?? []).map((e) => {
      const ev = e as { label: string; args?: Record<string, unknown>; result?: unknown; isError?: boolean };
      return { label: ev.label, args: ev.args, result: ev.result, isError: ev.isError === true };
    }),
    transcript: (cell?.transcript ?? []).map((m) => ({ role: m.role, content: textOf(m.content) })),
    error: rec.error[String(key)]?.message ?? '',
    toolCalls: rec.host.toolCalls,
    activity: Object.values(rec.host.activityCalls).reduce((a, b) => a + b, 0),
    threw: rec.scenarioError,
  };
}

/** Run the scenario on one engine, through the parity harness. */
export async function runOn(engine: RunEngineId, s: Scenario): Promise<Capture> {
  let calledByFirstRun: number | undefined;
  let key = 0;
  const parity: ParityScenario = {
    id: `area-r-${s.key}`,
    rows: [],
    title: 'area R',
    async run(h) {
      key = h.key;
      let n = 0;
      h.script(s.script().map((turn) => (input) => { n += 1; return turn({ opts: input.opts, call: input.call, key: h.key }); }));
      // Any tool name answers; the catalog the model is shown is the request's own.
      h.tools(new Proxy({} as Record<string, (args: unknown) => unknown>, { get: (_t, name) => s.tools?.[String(name)] ?? (() => ({ ok: true })) }));
      await h.start({ userTurn: 'find the request handler', ...s.request?.(engine) });
      if (s.follow) {
        calledByFirstRun = n;
        await h.start({ userTurn: s.follow.userTurn, ...s.request?.(engine) });
      }
    },
  };
  const rec = await runScenario(parity, engine);
  return { ...project(rec, key || 7001), ...(calledByFirstRun !== undefined ? { firstRunCalls: calledByFirstRun } : {}) };
}

/** The same scenario through the loop, then through the agent. */
export async function bothEngines(s: Scenario): Promise<{ loop: Capture; agent: Capture }> {
  const loop = await runOn('loop', s);
  const agent = await runOn('agent', s);
  return { loop, agent };
}

/** The trace steps carrying `label`, as `[args, result]`. */
export const stepsLabelled = (cap: Capture, label: string) => cap.trace.filter((e) => e.label === label);

/** The assistant rows the host persisted. */
export const assistantRows = (cap: Capture): Row[] => cap.rows.filter((r) => r.role === 'assistant');

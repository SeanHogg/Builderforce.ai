/**
 * The conformance ports an adapter-shaped test builds: a scripted `ModelTransport`, a
 * trace-recording `EventSink`, a store that round-trips its state through JSON the way a
 * session file or a Durable Object cursor does, and the run's policy/task defaults.
 *
 * The same shapes `conformance.test.ts` builds inline; kept here for the adapter cases
 * (one per entry point) so none of them restates a harness. No `node:*`, no DOM.
 */

import type { Capability, CapabilityProvider } from "@builderforce/agent-tools";
import type {
  ModelCompletion,
  ModelRequest,
  ModelTransport,
  RunEvent,
  RunPolicy,
  RunState,
  RunTask,
} from "../../src/index.js";

/** One scripted model turn. */
export interface ScriptedTurn {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  model?: string;
}

/** A model that replays a script, one completion per call, recording every request it was asked. */
export function recordingModel(script: ScriptedTurn[], requests: ModelRequest[] = []): ModelTransport {
  let index = 0;
  return {
    complete: async (request: ModelRequest): Promise<ModelCompletion> => {
      requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
      const turn = script[index];
      index += 1;
      if (!turn) throw new Error(`recordingModel: script exhausted after ${index - 1} call(s)`);
      return {
        content: turn.content ?? "",
        ...(turn.toolCalls && turn.toolCalls.length > 0 ? { toolCalls: turn.toolCalls } : {}),
        ...(turn.model ? { model: turn.model } : {}),
      };
    },
  };
}

/** A store whose saved state is bytes, not a pointer — a real cross-process resume. */
export function jsonStore() {
  let saved: RunState | undefined;
  return {
    load: () => saved,
    save: (state: RunState) => {
      saved = JSON.parse(JSON.stringify(state)) as RunState;
    },
    get saved(): RunState | undefined {
      return saved;
    },
  };
}

/** A trace-recording sink: every event, and the single outcome row. */
export function traceSink() {
  const events: RunEvent[] = [];
  const outcomes: Array<{ entryPoint: string; [k: string]: unknown }> = [];
  return {
    sink: {
      emit: (event: RunEvent) => {
        events.push(event);
      },
      outcome: (row: { entryPoint: string }) => {
        outcomes.push(row);
      },
    },
    events,
    outcomes,
  };
}

/** A provider backing the given capabilities; the services the test needs ride in `services`. */
export function providerOf(caps: readonly Capability[], services: Partial<CapabilityProvider> = {}): CapabilityProvider {
  return { capabilities: new Set(caps), ...services };
}

/** The policy an entry point hands the agent. Only `entryPoint` differs between adapters. */
export function policyFor(entryPoint: RunPolicy["entryPoint"], over: Partial<RunPolicy> = {}): RunPolicy {
  return {
    entryPoint,
    toolScope: "ticket",
    role: "code",
    levers: [],
    budgets: {},
    inference: "hybrid",
    verify: "none",
    approvalGates: [],
    delegation: { requested: false, readsBeforeNudge: 6 },
    ...over,
  };
}

export const SCRIPTED_TASK: RunTask = { prompt: "Say hello, then finish.", dispatch: { source: "manual" } };

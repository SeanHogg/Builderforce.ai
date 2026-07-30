/**
 * Run one chat turn through the REAL VSIX brain, offline.
 *
 * What is real here: the agent loop (`startRun` from the brain package), the IDE system
 * prompt, the extension's own tool definitions, per-turn tool selection, stall recovery,
 * model failover, durable step persistence, and — the part that matters most for triage
 * — `buildTranscript`, the exact function behind the chat's "Copy" button. A scenario's
 * `transcript` is therefore byte-for-byte what a user would paste into a bug report.
 *
 * What is faked: the gateway (a script — see `fakeGateway`), the API (an in-memory
 * message store), and tool execution (canned results). Nothing on the path between a
 * model's output and a diagnostics verdict is stubbed, because that path is what the
 * scenarios exist to hold still.
 *
 * The point of the exercise: a VSIX change used to be validated by building a `.vsix`,
 * installing it, reopening a chat, reproducing the failure by hand and copying the
 * output. Every one of those steps is now a function call.
 */

import {
  buildBrainTriageReport,
  computeBrainDiagnostics,
  getRunTrace,
  resetBrainRunStore,
  startRun,
  toolSpecsFor,
  traceWithPersistedSteps,
  type BrainDiagnostics,
  type BrainMessage,
  type BrainTraceEvent,
} from '@seanhogg/builderforce-brain-embedded';
import { buildIdeSystemPrompt } from '../webview/src/systemPrompt';
import { buildTranscript } from '../webview/src/transcript';
import { fakeGateway, type GatewayScript, type RecordedRequest } from './fakeGateway';
import { harnessTools, memoryPersistence, type ToolResponder } from './host';

export interface Scenario {
  /** Short id used in the CLI report and in test names. */
  id: string;
  /** What failure this reproduces, in one line. */
  what: string;
  /** The user's message. */
  prompt: string;
  /** How the model behaves, turn by turn. */
  script: GatewayScript;
  /** Restrict the advertised tools (default: the extension's real local + platform set). */
  tools?: string[];
  /** Advertise NO tools — models a failed gateway catalog fetch. */
  noTools?: boolean;
  /** Canned tool results by tool name. */
  toolResults?: Record<string, ToolResponder>;
  /** Pin a model (default: gateway auto-select, as the VSIX ships). */
  model?: string;
  /** Models offered to the loop's tool-call failover, in order. */
  fallbackModels?: string[];
  /** The chat's project id. Enables the loop's code-change→ticket backstops. */
  projectId?: number | null;
  /** Whether the host has an open workspace folder (shapes the IDE persona). */
  hasWorkspace?: boolean;
}

export interface ScenarioRun {
  scenario: Scenario;
  /** The merged live + durable trace — what the diagnostics actually read. */
  events: BrainTraceEvent[];
  messages: BrainMessage[];
  /** Every completion the loop requested, in order. */
  requests: RecordedRequest[];
  /** Every tool dispatch, in order. */
  toolCalls: Array<{ name: string; args: unknown }>;
  diagnostics: BrainDiagnostics;
  /** EXACTLY what the chat's Copy button would put on the clipboard. */
  transcript: string;
  /** The web surface's equivalent capture, so both copy paths are covered at once. */
  triageReport: string;
  /** The error the run surfaced to the user, if any. */
  error: string;
}

const CHAT_ID = 85;

/** Run a scenario to completion and collect everything a triager would look at. */
export async function runScenario(scenario: Scenario): Promise<ScenarioRun> {
  // The run store is a module-level singleton keyed by chat id (a run must survive the
  // unmount of the panel that started it). Scenarios share the id, so reset between them
  // or the second one joins the first one's cell.
  resetBrainRunStore();

  const gateway = fakeGateway(scenario.script);
  const persistence = memoryPersistence();
  const tools = harnessTools({
    ...(scenario.tools ? { names: scenario.tools } : {}),
    ...(scenario.noTools ? { none: true } : {}),
    ...(scenario.toolResults ? { responses: scenario.toolResults } : {}),
  });

  const fallbacks = [...(scenario.fallbackModels ?? [])];

  await persistence.sendMessages(CHAT_ID, [{ role: 'user', content: scenario.prompt }]);

  await startRun(CHAT_ID, {
    resolvedSystemPrompt: buildIdeSystemPrompt({ hasWorkspace: scenario.hasWorkspace ?? true }),
    tools: toolSpecsFor(tools.specs),
    ...(scenario.model ? { model: scenario.model } : {}),
    pickFallbackModel: (tried) => fallbacks.find((m) => !tried.includes(m)),
    runTool: tools.runTool,
    stream: gateway.stream,
    persistence,
    userTurn: scenario.prompt,
    ...(scenario.projectId !== undefined ? { projectId: scenario.projectId } : {}),
  });

  const messages = persistence.messages(CHAT_ID);
  const live = getRunTrace(CHAT_ID);
  const events = traceWithPersistedSteps(messages, live);
  const diagnostics = computeBrainDiagnostics(events, scenario.model, messages);

  // The run store surfaces its error on the snapshot; the loop's unrecoverable-stall
  // notice is also a trace step, which is what a copied report carries. Read the step,
  // so the harness reports what a USER would see rather than internal state.
  const error = String(
    events.find((e) => e.label === 'loop.stall_unrecovered' || (e.category === 'error' && e.label === 'agent.loop'))?.result ?? '',
  );

  return {
    scenario,
    events,
    messages,
    requests: gateway.requests,
    toolCalls: tools.calls,
    diagnostics,
    transcript: buildTranscript({
      messages,
      trace: live,
      assistantName: 'BuilderForce',
      model: scenario.model,
      error,
      project: scenario.projectId != null ? { id: scenario.projectId, name: 'Harness project' } : null,
      chatTitle: scenario.what,
      chatId: CHAT_ID,
    }),
    triageReport: buildBrainTriageReport({
      capturedAt: '2026-01-01T00:00:00.000Z',
      events: live,
      messages,
      chatId: CHAT_ID,
      chatTitle: scenario.what,
      surface: 'VS Code (VSIX)',
      configuredModel: scenario.model,
      error,
    }),
    error,
  };
}

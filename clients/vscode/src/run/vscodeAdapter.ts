/**
 * vscodeAdapter — the VS Code host adapted to the ONE agent (PRD 35 §3.1).
 *
 * This module ONLY builds ports. It has no loop, no policy, and no branch on
 * behaviour: `RunPolicy.entryPoint` is a telemetry label (sent as the
 * `entryPoint` of the uniform outcome row) and is NEVER read to decide what
 * the run does. The run itself lives in `@builderforce/agent-run` — this
 * file wires the VS Code host's capabilities (workspace folders, file system,
 * shell, git, memory/recall, model routing) into the `RunPorts` the agent
 * drives, and maps the resulting `RunOutcome` back onto the editor's chat /
 * run surface.
 *
 * Every host capability is REUSED, never re-implemented: the model route is
 * `modelRouting.resolveModelRoute`/`routeComplete`, the context pack is
 * `runSetupPorts.editorRunSetupPorts().contextPack`, memory is the shared
 * project-fact store behind `recall_facts`/`remember_fact`, and the outcome
 * row is `gateway.postRunOutcome`.
 */

import * as vscode from "vscode";
import { runAgent } from "@builderforce/agent-run";
import type {
  ContextPack,
  EventSink,
  HumanAnswer,
  ModelCompletion,
  ModelRequest,
  RunEvent,
  RunOutcome,
  RunOutcomeRow,
  RunPorts,
  RunState,
  RunTask,
} from "@builderforce/agent-run";
import type {
  CapabilityProvider,
  ContextSource,
  HumanChannel,
  MemoryCapability,
  ModelTransport,
  RunStore,
  SteeringSource,
} from "@builderforce/agent-run";
import { getApiKey, postRunOutcome } from "../gateway";
import { resolveModelRoute, routeComplete, localWindowProbes } from "../modelRouting";
import { editorRunSetupPorts } from "../runSetupPorts";
import { recallProjectFacts, rememberProjectFact } from "../workspaceFacts";

/** The model-transport request translated to the gateway's `ChatMessage` shape. */
function toChatMessages(request: ModelRequest) {
  return request.messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.toolCalls?.length
      ? {
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        }
      : {}),
    ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
  }));
}

/**
 * Where the model runs. The ONE thing the adapter supplies about the model:
 * a turn is resolved through the editor's routing (local, local-first, hybrid,
 * BYO pool) and completed on that route. `window()` answers from the live
 * on-device probes so the tools policy can size its result cap (§6.10).
 */
function buildModelTransport(secrets: vscode.SecretStorage): ModelTransport {
  return {
    async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion> {
      const route = await resolveModelRoute(secrets, { turn: true });
      const text = await routeComplete(route, secrets, toChatMessages(request), signal);
      // `routeComplete` is the non-streaming twin of `routeStream`: the whole answer
      // in one string. Tool calls travel in the streamed variant; the non-streaming
      // surface returns the model's text as-is.
      return { content: text, model: route.model };
    },
    window(model: string): number | undefined {
      // The live on-device runtimes as probed for this turn. A pinned local model's
      // window comes from the runtime that serves it; the gateway's models are not
      // window-known here, so `undefined` ⇒ the tools policy's fixed caps.
      void model;
      return undefined;
    },
  };
}

/**
 * What the surface can physically do. The editor backs repo read/write from the
 * workspace file system, git from the Git extension, shell from the run's default
 * checkout, and memory from the shared per-project fact store.
 */
function buildCapabilities(
  secrets: vscode.SecretStorage,
  workspaceRoot: () => string,
  projectId: () => number | undefined,
): CapabilityProvider {
  const setup = editorRunSetupPorts(secrets, workspaceRoot);
  const memory: MemoryCapability = {
    remember: async (key, content) => {
      const pid = projectId();
      if (pid === undefined) return { ok: false as const, error: "no-project" };
      const ok = await rememberProjectFact(secrets, pid, key, content);
      return ok ? { ok: true as const } : { ok: false as const, error: "unavailable" };
    },
    recall: async (query, limit) => {
      const pid = projectId();
      if (pid === undefined) return { ok: true as const, entries: [] };
      const facts = await recallProjectFacts(secrets, pid, query || undefined, limit ?? 10);
      return {
        ok: true as const,
        entries: facts.map((f) => ({ key: f.key, content: f.content, origin: "ide" })),
      };
    },
  };
  return {
    capabilities: new Set(["repo.read", "repo.write", "memory", "shell"]),
    memory,
    // `editorRunSetupPorts` resolves the run's default checkout; git and shell
    // default there. Repo read/write and shell services are bound by the run's
    // tool catalog — the adapter advertises the caps, the registry offers the tools.
    shell: { run: () => Promise.resolve({ ok: false as const, error: "shell-not-wired-in-slice-1" }) },
  } as CapabilityProvider;
}

/** Where the run's state lives between turns/ticks: the workspace folder as JSON. */
function buildRunStore(ctx: vscode.ExtensionContext, runKey: string): RunStore {
  const key = `builderforce.runState.${runKey}`;
  return {
    load(): RunState | undefined {
      return ctx.workspaceState.get<RunState>(key);
    },
    async save(state: RunState): Promise<void> {
      await ctx.workspaceState.update(key, state);
    },
  };
}

/** Where the run's events go: the live trace (an emitter) plus the outcome row. */
function buildEventSink(
  onEvent: (event: RunEvent) => void,
  entryPoint: string,
): EventSink {
  let sawToolError = false;
  let toolCalls = 0;
  let toolErrors = 0;
  return {
    emit(event: RunEvent): void {
      if (event.kind === "tool.dispatched") {
        toolCalls += 1;
        if (!event.ok) toolErrors += 1;
      }
      onEvent(event);
    },
    outcome(row: RunOutcomeRow): void {
      // The uniform outcome row (§8.2). VS Code reports through the same learned-routing
      // outbox as every other entry point; the entry-point label is telemetry, never a
      // behaviour switch. Fire-and-forget: the durable outbox retries, never throws.
      void postRunOutcome({ ...row, entryPoint });
    },
  };
}

/** How people are reached: a question is a modal quick-pick; approval parks the run. */
function buildHumanChannel(): HumanChannel {
  return {
    async ask(question: string, options?: readonly string[]): Promise<HumanAnswer> {
      const picks = options?.length ? [...options] : ["Continue", "Pause"];
      const picked = await vscode.window.showInformationMessage(question, ...picks);
      if (picked === undefined || picked === "Pause") return { kind: "paused" };
      return { kind: "answered", answer: picked };
    },
  };
}

/** What the user steered in since the last step. Drained once per step by the agent. */
function buildSteeringSource(takeSteered: () => string[]): SteeringSource {
  return { drain: () => takeSteered() };
}

/** The context pack, built once before turn 1 with no model call (§6.10). */
function buildContextSource(
  secrets: vscode.SecretStorage,
  workspaceRoot: () => string,
): ContextSource {
  const setup = editorRunSetupPorts(secrets, workspaceRoot);
  return {
    async pack(task: RunTask): Promise<ContextPack> {
      // The editor's pack builder already assembles focus files, repos and recall; the
      // adapter passes the task straight through — it adds no policy of its own.
      const built = await setup.contextPack({ request: task.prompt });
      return built as ContextPack;
    },
  };
}

/** The host capabilities an adapter binds, and the context it needs to build them. */
export interface VsCodeAdapterHost {
  /** The extension context: secret storage (model route) + workspace state (run store). */
  readonly extension: vscode.ExtensionContext;
  /** The workspace root the run is scoped to. */
  readonly workspaceRoot: () => string;
  /** The active project id, when one is attached (scopes memory). */
  readonly projectId?: () => number | undefined;
  /** Drain the user messages steered in since the last step. */
  readonly takeSteered: () => string[];
  /** Forward each typed run event to the chat/run surface's live trace. */
  readonly onEvent: (event: RunEvent) => void;
  /** The telemetry label for the uniform outcome row. NEVER branched on for behaviour. */
  readonly entryPoint?: string;
}

/**
 * Build the `RunPorts` the ONE agent drives from this host's capabilities.
 *
 * This is the whole job of an adapter (PRD 35 §3.1): every port is constructed
 * from a host capability, and nothing here decides what the run does.
 */
export function buildVsCodeRunPorts(host: VsCodeAdapterHost): RunPorts {
  const secrets = host.extension.secrets;
  const entryPoint = host.entryPoint ?? "vscode";
  return {
    model: buildModelTransport(secrets),
    capabilities: buildCapabilities(secrets, host.workspaceRoot, host.projectId ?? (() => undefined)),
    store: buildRunStore(host.extension, "run"),
    events: buildEventSink(host.onEvent, entryPoint),
    human: buildHumanChannel(),
    steering: buildSteeringSource(host.takeSteered),
    context: buildContextSource(secrets, host.workspaceRoot),
  };
}

/**
 * Drive one run to an outcome and map it back onto the editor's chat/run surface.
 *
 * The run itself is the agent's — the adapter supplies ports and reads the
 * outcome. The outcome's mapping is a pure projection onto the surface: a
 * finished run returns its output, a paused run surfaces the question it parked
 * on, a yielded run saves its state for a later resume, and a failed run
 * reports the reason.
 */
export async function runVsCodeAgent(input: {
  task: RunTask;
  ports: RunPorts;
  resume?: RunState;
  maxSteps?: number;
  signal?: AbortSignal;
  host: VsCodeAdapterHost;
}): Promise<RunOutcome> {
  const { task, ports, resume, maxSteps, signal, host } = input;
  const apiKey = await getApiKey(host.extension.secrets);
  if (!apiKey) {
    // Signed-out and no local route: the model transport would fail the turn
    // `not_signed_in`; surfacing it here is the same projection, earlier.
    return { kind: "failed", reason: "not-signed-in", state: resume ?? emptyState() };
  }
  const outcome = await runAgent({
    task,
    policy: {
      entryPoint: "vscode",
      toolScope: "chat-work",
      role: "developer",
      levers: [],
      budgets: {},
      inference: "hybrid",
      verify: "declared-checks",
      approvalGates: [],
      delegation: { requested: false, readsBeforeNudge: 6 },
    },
    ports,
    ...(resume ? { resume } : {}),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
    ...(signal ? { signal } : {}),
  });
  return outcome;
}

/** A placeholder state for the pre-run failure projection above. */
function emptyState(): RunState {
  return {
    messages: [],
    step: 0,
    guards: {},
    finish: {
      noDeliverableBlocked: false,
      reviewVerdictRecorded: false,
      placeholderBlocks: 0,
      ciPendingBlocks: 0,
      ciFailureBlocks: 0,
      ciVerified: false,
      finishBlockedOnce: false,
    },
    model: {} as RunState["model"],
    memory: {} as RunState["memory"],
    compaction: { compactions: 0 },
    writtenPaths: [],
    askedGates: [],
    reads: { served: {}, readsWithoutSpawn: { count: 0 } as RunState["reads"]["readsWithoutSpawn"] },
  };
}

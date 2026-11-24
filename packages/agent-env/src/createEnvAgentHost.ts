/**
 * createEnvAgentHost — the host that runs a Web Container's declared agents (W12 phase 3), as the runtime's `AgentHostPort`.
 *
 * Every run goes through `openRun`, the ONE entry (`scripts/check-one-execution.mjs`). Like the Brain's `webAdapter`, this file only
 * BUILDS PORTS and the policy DATA: no loop, no branch on behaviour.
 *  - `model`: the host's role-routed transport. The declaration's `role` is policy data (`RunPolicy.role`); no model id is named.
 *  - `capabilities` / `platform`: (catalog ∩ allowlist) plus the environment's `env.*` port (`envCapabilities.ts`).
 *  - `store`, `human`, `context`: injected. `events`: injected, each event stamped with the run's `EnvCorrelation`.
 * Everything persisted (state, appended rows, memory) or emitted (events, the outcome row, the host's own stream) passes through
 * `redactDeep` first, so a credential the run saw is never written or sent as it was.
 */
import {
  openRun,
  type CapabilityProvider,
  type ContextSource,
  type EventSink,
  type HumanChannel,
  type ModelTransport,
  type RunEvent,
  type RunOutcome,
  type RunPolicy,
  type RunPorts,
  type RunStore,
  type SteerInput,
  type SteeringSource,
} from "@builderforce/agent-run";
import { redactDeep } from "@builderforce/secret-redaction";
import { createEnvCapabilities } from "./envCapabilities.js";
import type { AgentHostEvent, AgentHostPort, EnvCorrelation, EnvironmentToolPort } from "./envContract.js";

/** A role or agent id: a lowercase vocabulary key the host's model router resolves (core `AGENT_ROLE_PATTERN`). */
export const AGENT_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

/** The run's telemetry label: agents in a Web Container run in the web app. A label, never a switch. */
export const ENV_AGENT_ENTRY_POINT: RunPolicy["entryPoint"] = "web";

/** Reads before the delegation nudge: an environment agent is never nudged to delegate (`delegation.requested` is false). */
const NO_DELEGATION: RunPolicy["delegation"] = { requested: false, readsBeforeNudge: 0 };

/** Between the agent's brief and the line naming its tools, in its persona. */
const PERSONA_SEPARATOR = "\n\n";

/** The host's own events on a run's stream, beside the run's `RunEvent` kinds. */
export const HOST_EVENT = { settled: "host.settled", failed: "host.failed" } as const;

/** One declared agent, as the validated manifest gives it (its allowlist already narrowed by the environment's ceilings). */
export interface EnvAgentDeclaration {
  id: string;
  role: string;
  tools: readonly string[];
  /** The agent's brief (its `agents/<role>.md`), read by the host. */
  instructions?: string;
  budget?: { tokens?: number; usd?: number; steps?: number };
}

export interface EnvAgentHostDeps {
  agents: readonly EnvAgentDeclaration[];
  /** The host's role-routed model transport. */
  model: ModelTransport;
  /** The environment's tool port, bound to one agent (its allowlist, its environment's services, the Shield). */
  environment(agent: EnvAgentDeclaration): EnvironmentToolPort;
  /** Where one run's state lives. */
  store(runId: string, agent: EnvAgentDeclaration): RunStore;
  human: HumanChannel;
  context: ContextSource;
  /** Where every run's (redacted, correlated) events go, beside each run's own stream. */
  events?: EventSink;
  /** The host's catalog services; an agent sees only the capabilities its allowlist names. */
  catalog?: CapabilityProvider;
  /** A fresh run id. Default `crypto.randomUUID()`. */
  newRunId?: () => string;
  /** Clock, for tests. Default `Date.now`. */
  now?: () => number;
}

export interface EnvAgentHost extends AgentHostPort {
  /** The run's outcome once it settles; rejects with the run's failure when a port threw. */
  settled(runId: string): Promise<RunOutcome>;
}

/** A run id the host never started (or a declaration it does not hold). */
export class UnknownAgentRunError extends Error {
  constructor(what: string) {
    super(what);
    this.name = "UnknownAgentRunError";
  }
}

/** One run's live stream: what happened so far, and the readers waiting for more. */
function eventChannel() {
  const history: AgentHostEvent[] = [];
  const waiters = new Set<() => void>();
  let closed = false;
  const wake = () => {
    for (const waiter of [...waiters]) waiter();
    waiters.clear();
  };
  return {
    push(event: AgentHostEvent) {
      history.push(event);
      wake();
    },
    close() {
      closed = true;
      wake();
    },
    async *read(): AsyncIterable<AgentHostEvent> {
      for (let next = 0; ; ) {
        while (next < history.length) yield history[next++]!;
        if (closed) return;
        await new Promise<void>((resolve) => waiters.add(resolve));
      }
    },
  };
}

/** A run's steered messages, drained between steps. */
function steeringQueue(): SteeringSource & { push(text: string): void } {
  let queued: SteerInput[] = [];
  return {
    push: (text) => void queued.push({ text }),
    drain: () => {
      const drained = queued;
      queued = [];
      return drained;
    },
  };
}

/** The run store, redacting every state, row and memory it is handed before the host's store keeps it. */
function redactingStore(store: RunStore): RunStore {
  return {
    load: () => store.load(),
    save: (state) => store.save(redactDeep(state)),
    ...(store.commitMemory ? { commitMemory: (consolidated: unknown) => store.commitMemory!(redactDeep(consolidated)) } : {}),
    ...(store.appended ? { appended: (row: Parameters<NonNullable<RunStore["appended"]>>[0]) => store.appended!(redactDeep(row)) } : {}),
    ...(store.isResumable ? { isResumable: (err: unknown) => store.isResumable!(err) } : {}),
  };
}

function validateDeclaration(agent: EnvAgentDeclaration): void {
  if (!AGENT_KEY_PATTERN.test(agent.id)) throw new TypeError(`Agent id "${agent.id}" must match ${AGENT_KEY_PATTERN}.`);
  if (!AGENT_KEY_PATTERN.test(agent.role)) throw new TypeError(`Agent "${agent.id}" role "${agent.role}" must match ${AGENT_KEY_PATTERN}: agents are declared by role, never by model.`);
}

/** The policy DATA of one agent's run: its role and budgets, read off its declaration. */
function agentPolicy(agent: EnvAgentDeclaration): RunPolicy {
  return {
    entryPoint: ENV_AGENT_ENTRY_POINT,
    toolScope: "subagent",
    role: agent.role,
    levers: [],
    budgets: { ...agent.budget },
    inference: "hybrid",
    verify: "none",
    approvalGates: [],
    delegation: NO_DELEGATION,
  };
}

export function createEnvAgentHost(deps: EnvAgentHostDeps): EnvAgentHost {
  for (const agent of deps.agents) validateDeclaration(agent);
  const byId = new Map(deps.agents.map((agent) => [agent.id, agent]));
  const now = deps.now ?? Date.now;
  const newRunId = deps.newRunId ?? (() => crypto.randomUUID());
  const runs = new Map<string, { abort: AbortController; steering: ReturnType<typeof steeringQueue>; channel: ReturnType<typeof eventChannel>; outcome: Promise<RunOutcome> }>();

  const runOf = (runId: string) => {
    const run = runs.get(runId);
    if (!run) throw new UnknownAgentRunError(`No agent run "${runId}" on this host.`);
    return run;
  };

  return {
    async start(agentId, input) {
      const agent = byId.get(agentId);
      if (!agent) throw new UnknownAgentRunError(`No agent "${agentId}" is declared in this environment.`);
      const runId = newRunId();
      const correlation: EnvCorrelation = { ...input.correlation, agentId: agent.id };
      const channel = eventChannel();
      const publish = (type: string, payload: unknown) => channel.push({ type, correlation, payload: redactDeep(payload), ts: now() });

      const events: EventSink = {
        async emit(event, meta) {
          const stamped = redactDeep({ ...event, ...correlation } as RunEvent);
          await deps.events?.emit(stamped, meta);
          channel.push({ type: stamped.kind, correlation, payload: stamped, ts: now() });
        },
        outcome: async (row) => deps.events?.outcome?.(redactDeep(row)),
        workflow: async (metric) => deps.events?.workflow?.(redactDeep(metric)),
      };
      const { capabilities, platform, brief } = createEnvCapabilities({ port: deps.environment(agent), allowlist: agent.tools, runId, ...(deps.catalog ? { catalog: deps.catalog } : {}) });
      const steering = steeringQueue();
      const abort = new AbortController();
      const ports: RunPorts = {
        model: deps.model,
        capabilities,
        platform,
        store: redactingStore(deps.store(runId, agent)),
        events,
        human: deps.human,
        steering,
        context: deps.context,
      };
      const outcome = openRun({
        task: { runId, prompt: input.task, agentName: agent.id, persona: [agent.instructions, brief].filter(Boolean).join(PERSONA_SEPARATOR), dispatch: { source: "manual" } },
        policy: agentPolicy(agent),
        ports,
        signal: abort.signal,
      });
      runs.set(runId, { abort, steering, channel, outcome });
      // The stream ends on the outcome or the failure; the failure itself is the caller's through `settled`, never dropped.
      void outcome.then(
        (settled) => publish(HOST_EVENT.settled, settled.kind === "finished" ? { kind: settled.kind, output: settled.output } : { kind: settled.kind, ...("reason" in settled ? { reason: settled.reason } : {}) }),
        (error: unknown) => publish(HOST_EVENT.failed, { error: error instanceof Error ? error.message : String(error) }),
      ).finally(() => channel.close());
      return { runId };
    },
    async steer(runId, message) {
      runOf(runId).steering.push(message);
    },
    async cancel(runId) {
      runOf(runId).abort.abort();
    },
    events: (runId) => runOf(runId).channel.read(),
    settled: (runId) => runOf(runId).outcome,
  };
}

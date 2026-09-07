/**
 * Cloud sub-agents — the backing for capability `orchestrate` on the Worker/durable
 * surface.
 *
 * A sub-agent is a CHILD run of the same kernel: same tool definitions, same
 * capability backing, its own transcript. The parent sends one brief and receives one
 * answer, so an exploration that would otherwise spend twenty turns filling the
 * parent's context with dead ends costs it a paragraph. That isolation is the point;
 * a child sharing the parent's messages would just be a more expensive turn.
 *
 * Why this is its own module and not another section of `cloudAgentEngine`: nothing
 * here is cloud-specific. It needs a capability provider, a tool registry and a way to
 * take one model turn — all injected — so the same builder backs a sub-agent on any
 * surface that can afford a nested run. The engine supplies the concretions.
 *
 * Two invariants the surface does NOT get to configure:
 *   • The child's capability set never contains `orchestrate`, so a child cannot
 *     spawn. Recursion is impossible by CONSTRUCTION rather than by a depth counter
 *     someone has to remember to decrement.
 *   • The child never gets `human`. A run pauses for a person by ending the whole
 *     execution and waiting for an answer to arrive on resume; a child that could
 *     trigger that would strand the parent mid-turn with no way back.
 */

import {
  type Capability,
  type CapabilityProvider,
  type OrchestrationCapability,
  type SubagentRequest,
  type SubagentResult,
  type ToolContext,
  type ToolRegistry,
  type ToolSchema,
} from '@builderforce/agent-tools';
import { openAiChatCodec, runAgentLoop, type LoopPorts, type LoopTurnResult } from '@builderforce/agent-loop';

/**
 * Never handed to a child, whatever the parent holds.
 *
 * `orchestrate` and `human` are the two structural ones (see the module comment).
 * `skill.author` is withheld for the reason the tool exists at all: a skill is a
 * procedure every FUTURE run is told to follow, and the run accountable for proposing
 * one is the run a person can ask about it — not an anonymous child the parent
 * commissioned and summarised in a sentence.
 */
export const NON_DELEGABLE_CAPABILITIES: readonly Capability[] = ['orchestrate', 'human', 'skill.author'];

/**
 * Additionally withheld from a READ-ONLY child (the default). Anything that can change
 * the working tree, the ticket's PRD, the shared blackboard or durable memory — plus
 * `shell` and `process`, which are write capabilities wearing a different hat.
 */
export const MUTATING_CAPABILITIES: readonly Capability[] = [
  'repo.write', 'repo.edit', 'repo.delete', 'git.write', 'shell', 'process',
  'prd.write', 'coordinate', 'memory.forget',
];

/** Steps a child may take before it is cut off and its last word returned as partial. */
export const SUBAGENT_MAX_STEPS = 8;

/** How much of the child's answer the parent is given. A child that rambles must not
 *  be able to spend the parent's context — the whole point of delegating was to save it. */
export const SUBAGENT_OUTPUT_CHARS = 4000;

/** The child's capability set: the parent's, minus what is never delegable, minus the
 *  mutating half when the delegation is read-only. Pure — this is the security
 *  boundary, so it is tested directly rather than only through a run. */
export function childCapabilities(parent: ReadonlySet<Capability>, readOnly: boolean): ReadonlySet<Capability> {
  const withheld = new Set<Capability>([
    ...NON_DELEGABLE_CAPABILITIES,
    ...(readOnly ? MUTATING_CAPABILITIES : []),
  ]);
  return new Set([...parent].filter((c) => !withheld.has(c)));
}

/** The child's standing instructions. It has no ticket, no history and no PR to open:
 *  its entire job is to answer the one brief it was given, and `finish` is how it
 *  hands that answer back. */
export function subagentSystemPrompt(readOnly: boolean): string {
  return [
    'You are a sub-agent. Another agent delegated ONE self-contained question to you and is blocked until you answer.',
    'You cannot see its conversation, its ticket or its plan, and it cannot see yours — it receives only your final summary, so that summary must stand alone.',
    readOnly
      ? 'You are READ-ONLY: investigate, read and search, but do not attempt to change anything.'
      : 'You may make the change you were asked to make, and nothing beyond it.',
    'Work efficiently — you have a small step budget. When you have the answer, call the finish tool with it: concrete findings, exact file paths and names, and an explicit "not found" where that is the honest result.',
    'Never finish with a promise to continue; there is no next turn after it.',
  ].join('\n');
}

type Row = Record<string, unknown>;

export interface SubagentDeps {
  /** The PARENT surface's capability set — the ceiling on what a child can hold. */
  parentCaps: ReadonlySet<Capability>;
  /** The parent's capability backing. The child reuses it (same repo, same branch,
   *  same bookkeeping) with a narrowed capability set — never a second connection. */
  provider: CapabilityProvider;
  registry: ToolRegistry;
  /** Take one model turn on the child's transcript. The surface owns metering,
   *  model selection and telemetry; this module owns the loop. */
  complete(args: { messages: Row[]; tools: ToolSchema[]; step: number }): Promise<LoopTurnResult>;
  /** The parent run's cancel signal — a cancelled run must not leave a child spending. */
  signal?: AbortSignal;
  maxSteps?: number;
  /** Timeline recorder, so a delegation is visible in Observability rather than
   *  appearing as an unexplained gap in the parent's turns. */
  record?(event: { label: string; detail: Record<string, unknown>; result: string }): Promise<void>;
}

/**
 * Build the `orchestrate` backing. Every failure inside a child is returned as
 * `{ok:false}` for the PARENT's model to read and route around — a delegation that
 * went wrong is information, not a reason to end the parent's run. The one exception
 * is cancellation, which is rethrown so the parent's kernel reports the run cancelled
 * instead of treating a killed child as a failed tool call.
 */
export function buildOrchestrationCapability(deps: SubagentDeps): OrchestrationCapability {
  const maxSteps = deps.maxSteps ?? SUBAGENT_MAX_STEPS;

  return {
    async spawn(input: SubagentRequest): Promise<SubagentResult> {
      const readOnly = input.readOnly !== false;
      const caps = childCapabilities(deps.parentCaps, readOnly);
      // Drop the parent's own orchestration backing rather than relying solely on the
      // capability gate: the child then has no reference to a spawner at all.
      const { orchestration: _parentSpawner, ...backing } = deps.provider;
      const childProvider: CapabilityProvider = { ...backing, capabilities: caps };
      const ctx: ToolContext = { caps: childProvider, ...(deps.signal ? { signal: deps.signal } : {}) };
      const tools = deps.registry.schemasForCapabilities(caps);

      const messages: Row[] = [
        { role: 'system', content: subagentSystemPrompt(readOnly) },
        { role: 'user', content: input.task },
      ];
      const ports: LoopPorts<Row> = {
        complete: (loopCtx) => deps.complete({ messages, tools, step: loopCtx.step }),
        dispatch: async (call) => {
          const dispatched = await deps.registry.dispatch(call.name, call.args, ctx);
          return { data: dispatched.data, ...(dispatched.control ? { control: dispatched.control } : {}) };
        },
      };

      const started = Date.now();
      try {
        const loop = await runAgentLoop<Row>({
          messages,
          codec: openAiChatCodec<Row>(),
          ports,
          budget: { stepCap: maxSteps },
          ...(deps.signal ? { signal: deps.signal } : {}),
        });
        const output = loop.output.slice(0, SUBAGENT_OUTPUT_CHARS);
        const result: SubagentResult = loop.cancelled
          ? { ok: false, error: 'the run was cancelled while this sub-agent was working', steps: loop.step }
          : { ok: loop.ok && loop.finished, output, steps: loop.step, truncated: loop.exhausted };
        await deps.record?.({
          label: input.label,
          detail: { readOnly, steps: loop.step, maxSteps, truncated: loop.exhausted, ms: Date.now() - started, tools: tools.length },
          result: result.ok
            ? `${input.label} → ${output.slice(0, 200)}`
            : `${input.label} → ${result.error ?? 'the sub-agent stopped without an answer'}`,
        });
        return result;
      } catch (error) {
        // A cancel aborts the child's in-flight fetch, which throws here. That is the
        // parent's cancellation, not a tool failure — let the parent's kernel see it.
        if (deps.signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        await deps.record?.({ label: input.label, detail: { readOnly, ms: Date.now() - started }, result: `${input.label} → failed: ${message}` });
        return { ok: false, error: message };
      }
    },
  };
}

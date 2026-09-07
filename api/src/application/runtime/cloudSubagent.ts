/**
 * Cloud sub-agents — the backing for capability `orchestrate` on the Worker/durable
 * surface.
 *
 * The child RUN itself is not here: it is `runSubagent` in `@builderforce/agent-loop`,
 * shared with the extension host so both surfaces delegate on identical terms (same
 * brief, same budget, same meaning for a truncated answer). What this module owns is
 * the one thing that is genuinely cloud-shaped — deciding what a child may TOUCH.
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
import { runSubagent, SUBAGENT_MAX_STEPS, type LoopTurnResult } from '@builderforce/agent-loop';

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

export interface SubagentDeps {
  /** The PARENT surface's capability set — the ceiling on what a child can hold. */
  parentCaps: ReadonlySet<Capability>;
  /** The parent's capability backing. The child reuses it (same repo, same branch,
   *  same bookkeeping) with a narrowed capability set — never a second connection. */
  provider: CapabilityProvider;
  registry: ToolRegistry;
  /** Take one model turn on the child's transcript. The surface owns metering,
   *  model selection and telemetry; the kernel owns the loop. */
  complete(args: { messages: Record<string, unknown>[]; tools: ToolSchema[]; step: number }): Promise<LoopTurnResult>;
  /** The parent run's cancel signal — a cancelled run must not leave a child spending. */
  signal?: AbortSignal;
  maxSteps?: number;
  /** Timeline recorder, so a delegation is visible in Observability rather than
   *  appearing as an unexplained gap in the parent's turns. */
  record?(event: { label: string; detail: Record<string, unknown>; result: string }): Promise<void>;
}

/**
 * Build the `orchestrate` backing. Every failure inside a child is returned as
 * `{ok:false}` for the PARENT's model to read and route around — a delegation that went
 * wrong is information, not a reason to end the parent's run. The one exception is
 * cancellation, which is rethrown so the parent's kernel reports the run cancelled
 * instead of treating a killed child as a failed tool call.
 */
export function buildOrchestrationCapability(deps: SubagentDeps): OrchestrationCapability {
  return {
    async spawn(input: SubagentRequest): Promise<SubagentResult> {
      const readOnly = input.readOnly !== false;
      const caps = childCapabilities(deps.parentCaps, readOnly);
      // Drop the parent's own orchestration backing rather than relying solely on the
      // capability gate: the child then holds no reference to a spawner at all.
      const { orchestration: _parentSpawner, ...backing } = deps.provider;
      const childProvider: CapabilityProvider = { ...backing, capabilities: caps };
      const ctx: ToolContext = { caps: childProvider, ...(deps.signal ? { signal: deps.signal } : {}) };
      const tools = deps.registry.schemasForCapabilities(caps);
      const maxSteps = deps.maxSteps ?? SUBAGENT_MAX_STEPS;
      const started = Date.now();

      try {
        const run = await runSubagent<ToolSchema>({
          task: input.task,
          readOnly,
          tools,
          complete: deps.complete,
          dispatch: async (call) => {
            const dispatched = await deps.registry.dispatch(call.name, call.args, ctx);
            return { data: dispatched.data, ...(dispatched.control ? { control: dispatched.control } : {}) };
          },
          maxSteps,
          ...(deps.signal ? { signal: deps.signal } : {}),
        });
        const result: SubagentResult = run.cancelled
          ? { ok: false, error: 'the run was cancelled while this sub-agent was working', steps: run.steps }
          : { ok: run.ok, output: run.output, steps: run.steps, truncated: run.truncated };
        await deps.record?.({
          label: input.label,
          detail: { readOnly, steps: run.steps, maxSteps, truncated: run.truncated, ms: Date.now() - started, tools: tools.length },
          result: result.ok
            ? `${input.label} → ${run.output.slice(0, 200)}`
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

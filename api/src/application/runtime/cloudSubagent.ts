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
  type ModelRole,
  staffDelegation,
  inScope,
  type OrchestrationCapability,
  type RepoWriteCapability,
  type SubagentRequest,
  type SubagentResult,
  type ToolContext,
  type ToolRegistry,
  type ToolSchema,
} from '@builderforce/agent-tools';
import { runSubagent, SUBAGENT_MAX_STEPS, type LoopTurnResult } from '@builderforce/agent-loop';
import { CLOUD_SURFACE_CAPS } from './cloudAgentTools';

/**
 * Never handed to a child, whatever the parent holds.
 *
 * `orchestrate` and `human` are the two structural ones (see the module comment).
 * `skill.author` is withheld for the reason the tool exists at all: a skill is a
 * procedure every FUTURE run is told to follow, and the run accountable for proposing
 * one is the run a person can ask about it — not an anonymous child the parent
 * commissioned and summarised in a sentence.
 */
export const NON_DELEGABLE_CAPABILITIES: readonly Capability[] = ['orchestrate', 'orchestrate.fanout', 'human', 'skill.author'];

/**
 * Additionally withheld from a READ-ONLY child (the default). Anything that can change
 * the working tree, the ticket's PRD, the shared blackboard or durable memory — plus
 * `shell` and `process`, which are write capabilities wearing a different hat.
 */
export const MUTATING_CAPABILITIES: readonly Capability[] = [
  'repo.write', 'repo.edit', 'repo.delete', 'git.write', 'shell', 'process',
  'prd.write', 'coordinate', 'memory.forget',
];

/**
 * Withheld from a SCOPED child — one writing beside siblings in the same tree
 * (`spawn_agents`). A shell, a process or a git write reaches the whole tree whatever
 * the child's paths say, so only the file writers a scope can check are left.
 */
export const TREE_WIDE_CAPABILITIES: readonly Capability[] = ['shell', 'process', 'git.write'];

/** The child's capability set: the parent's, minus what is never delegable, minus the
 *  mutating half when the delegation is read-only, minus the tree-wide writers when it
 *  is scoped. Pure — this is the security boundary, so it is tested directly rather than
 *  only through a run. */
export function childCapabilities(parent: ReadonlySet<Capability>, readOnly: boolean, scoped = false): ReadonlySet<Capability> {
  const withheld = new Set<Capability>([
    ...NON_DELEGABLE_CAPABILITIES,
    ...(readOnly ? MUTATING_CAPABILITIES : []),
    ...(scoped ? TREE_WIDE_CAPABILITIES : []),
  ]);
  return new Set([...parent].filter((c) => !withheld.has(c)));
}

/**
 * The ceiling for a child spawned by an IMAGE-run surface (the Cloudflare Container or
 * the GitHub Actions runner).
 *
 * Those parents run their own loop in their own process, but a child they commission
 * runs HERE, in the Worker — so the child cannot simply inherit the parent's set. The
 * parent holds `shell`, and there is no shell in a Worker; a child handed it would be
 * offered `run_command` with nothing behind it, which is the exact failure the
 * capability sets exist to prevent.
 *
 * So the ceiling is the parent's set narrowed to what this host can actually back, with
 * one deliberate translation: an image parent greps its clone THROUGH the shell, which
 * is why `repo.search` never appears in its capability set even though searching the
 * repo is plainly something it can do. Dropping the shell would therefore leave the
 * child unable to search at all — and searching is most of what a delegated
 * investigation IS. `repo.search` is added back as the Worker's form of that same
 * read authority. Only the READ half is translated: nothing here grants a child the
 * ability to execute, which is the other half of what a shell is.
 *
 * Pure, and the security boundary for two surfaces, so it is tested directly.
 */
export function imageHostedChildCeiling(parentCaps: ReadonlySet<Capability>): ReadonlySet<Capability> {
  const ceiling = new Set<Capability>([...parentCaps].filter((c) => CLOUD_SURFACE_CAPS.has(c)));
  if (parentCaps.has('shell')) ceiling.add('repo.search');
  return ceiling;
}

export interface SubagentDeps {
  /** The PARENT surface's capability set — the ceiling on what a child can hold. */
  parentCaps: ReadonlySet<Capability>;
  /** The parent's capability backing. The child reuses it (same repo, same branch,
   *  same bookkeeping) with a narrowed capability set — never a second connection. */
  provider: CapabilityProvider;
  registry: ToolRegistry;
  /** Take one model turn on the child's transcript. The surface owns metering,
   *  model selection and telemetry; the kernel owns the loop. `role` is the
   *  delegation's declared purpose (defaulted from `readOnly` by the tool before
   *  the request ever reaches `spawn`), so the surface can pick a model suited to
   *  the work instead of inheriting the parent's pin verbatim. */
  complete(args: { messages: Record<string, unknown>[]; tools: ToolSchema[]; step: number; role?: ModelRole }): Promise<LoopTurnResult>;
  /** The parent run's cancel signal — a cancelled run must not leave a child spending. */
  signal?: AbortSignal;
  maxSteps?: number;
  /**
   * Resolve one of the WORKSPACE's agents (by id or name) to the persona a child should
   * run as — operator decision 2026-09-15.
   *
   * Injected rather than imported for the same reason `complete` is: this module owns
   * what a child may TOUCH, not what a workspace knows. Absent on a surface that has no
   * roster, in which case `asAgent` is refused rather than silently ignored — a parent
   * that asked for Ada and got an anonymous helper would never learn it did not get her.
   */
  personaBrief?(agent: string): Promise<{ name: string; brief: string; roleKeys?: readonly string[] } | null>;
  /** Timeline recorder, so a delegation is visible in Observability rather than
   *  appearing as an unexplained gap in the parent's turns. */
  record?(event: { label: string; detail: Record<string, unknown>; result: string }): Promise<void>;
  /**
   * One child FINISHED — post its report into the chat the run belongs to. Called for
   * every child, failed ones included, the moment it is back, so a fan-out reads in the
   * chat as one report per ticket rather than one summary at the end. Best-effort.
   */
  report?(input: SubagentRequest, result: SubagentResult): Promise<void>;
}

/**
 * The child's file writers, held to its scope and to ONE writer at a time.
 *
 * Children of one fan-out run concurrently but commit to the same branch, and a commit
 * over the git API reads the ref, writes a tree and moves the ref: two at once and the
 * second loses the first. Every write therefore queues on the orchestration's single
 * chain — the children still THINK in parallel; only their commits take turns. A scoped
 * child is refused a write outside its paths before anything is sent.
 */
function guardedRepoWrite(
  write: RepoWriteCapability,
  serialize: <T>(fn: () => Promise<T>) => Promise<T>,
  scope: readonly string[] | undefined,
  changed: Set<string>,
): RepoWriteCapability {
  const outside = (path: string): { ok: false; error: string } | null =>
    scope && !inScope(path, scope)
      ? { ok: false, error: `'${path}' is outside this workstream's paths (${scope.join(', ')}) — another workstream may own it. Change only files inside your paths, and name anything else you believe must change in your answer.` }
      : null;
  const track = <R extends { ok: boolean }>(path: string, result: R): R => {
    if (result.ok) changed.add(path);
    return result;
  };
  return {
    async writeFile(path, content, summary) {
      return outside(path) ?? track(path, await serialize(() => write.writeFile(path, content, summary)));
    },
    async editFile(path, oldString, newString, replaceAll) {
      return outside(path) ?? track(path, await serialize(() => write.editFile(path, oldString, newString, replaceAll)));
    },
    async deleteFile(path, reason) {
      return outside(path) ?? track(path, await serialize(() => write.deleteFile(path, reason)));
    },
  };
}

/**
 * Build the `orchestrate` backing. Every failure inside a child is returned as
 * `{ok:false}` for the PARENT's model to read and route around — a delegation that went
 * wrong is information, not a reason to end the parent's run.
 *
 * Cancellation is named as cancellation rather than as a child that could not answer.
 * The kernel absorbs an aborted fetch into `cancelled`, so it arrives as a result, and
 * the parent's own cancel check ends the run at the next step boundary; what matters
 * here is that the timeline does not report a failed sub-agent when someone pressed
 * stop. A throw from OUTSIDE the kernel while the run is aborting is not the child's
 * failure to report, so it goes back up.
 */
export function buildOrchestrationCapability(deps: SubagentDeps): OrchestrationCapability {
  // ONE write chain for every child this run spawns (see `guardedRepoWrite`).
  let chain: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  const spawn = async (input: SubagentRequest): Promise<SubagentResult> => {
      const readOnly = input.readOnly !== false;
      const scope = !readOnly && input.scope?.length ? input.scope : undefined;
      const caps = childCapabilities(deps.parentCaps, readOnly, !!scope);
      // Drop the parent's own orchestration backing rather than relying solely on the
      // capability gate: the child then holds no reference to a spawner at all.
      const { orchestration: _parentSpawner, ...backing } = deps.provider;
      const changed = new Set<string>();
      const childProvider: CapabilityProvider = {
        ...backing,
        capabilities: caps,
        ...(!readOnly && backing.repoWrite ? { repoWrite: guardedRepoWrite(backing.repoWrite, serialize, scope, changed) } : {}),
      };
      /** What the child produced and owns, echoed on every result. */
      const produced = () => ({
        ...(changed.size ? { changedFiles: [...changed] } : {}),
        ...(input.ticket ? { ticket: input.ticket } : {}),
      });
      const ctx: ToolContext = { caps: childProvider, ...(deps.signal ? { signal: deps.signal } : {}) };
      const tools = deps.registry.schemasForCapabilities(caps);
      const maxSteps = deps.maxSteps ?? SUBAGENT_MAX_STEPS;
      const started = Date.now();

      // Delegating AS one of the workspace's agents. A ref that resolves to nobody is
      // returned as a failed delegation, NOT run anonymously: the parent asked for a
      // named teammate, and quietly substituting a generic child would produce an answer
      // attributed to expertise nobody applied. A delegation to nobody is information.
      const asAgent = typeof input.asAgent === 'string' ? input.asAgent.trim() : '';
      let persona: { name: string; brief: string } | undefined;
      // Set when the named agent lacks the slice's delivery role (Developer for code, QA
      // for verify): the child runs as an on-demand role persona, NOT as that agent, and
      // this says so — the editor's children run the same rule (`staffDelegation`).
      let staffing: string | undefined;
      if (asAgent) {
        const resolved = await deps.personaBrief?.(asAgent);
        if (!resolved) {
          const result: SubagentResult = { ok: false, error: `no agent named "${asAgent}" in this workspace` };
          await deps.record?.({
            label: input.label,
            detail: { readOnly, asAgent, ms: Date.now() - started },
            result: `${input.label} → ${result.error}`,
          });
          return result;
        }
        const staffed = input.role ? staffDelegation(resolved, input.role) : { kind: 'as-agent' as const };
        if (staffed.kind === 'on-demand') {
          persona = staffed.persona;
          staffing = staffed.note;
        } else {
          persona = { name: resolved.name, brief: resolved.brief };
        }
      }
      /** Echoed on the result and the timeline so the answer is attributable to a REAL
       *  teammate rather than to the string the parent guessed — or, for an on-demand
       *  role persona, to nobody, with the note saying why. */
      const asAgentEcho = staffing
        ? { staffing }
        : persona ? { asAgent: { ref: asAgent, name: persona.name } } : {};

      try {
        const run = await runSubagent<ToolSchema>({
          task: input.task,
          readOnly,
          tools,
          // The kernel's `complete` port carries no purpose field (it is generic
          // over any surface) — the role this delegation declared is closed over
          // here, at the one place that knows it, rather than threaded through the
          // loop itself.
          complete: (a) => deps.complete({ ...a, role: input.role }),
          ...(persona ? { persona } : {}),
          dispatch: async (call) => {
            const dispatched = await deps.registry.dispatch(call.name, call.args, ctx);
            return { data: dispatched.data, ...(dispatched.control ? { control: dispatched.control } : {}) };
          },
          maxSteps,
          ...(input.outputChars ? { outputChars: input.outputChars } : {}),
          ...(deps.signal ? { signal: deps.signal } : {}),
        });
        const result: SubagentResult = run.cancelled
          ? { ok: false, error: 'the run was cancelled while this sub-agent was working', steps: run.steps, ...asAgentEcho, ...produced() }
          : { ok: run.ok, output: run.output, steps: run.steps, truncated: run.truncated, ...asAgentEcho, ...produced() };
        await deps.record?.({
          label: input.label,
          detail: { readOnly, steps: run.steps, maxSteps, truncated: run.truncated, ms: Date.now() - started, tools: tools.length, ...(persona ? { asAgent, asAgentName: persona.name } : {}) },
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
        await deps.record?.({ label: input.label, detail: { readOnly, ms: Date.now() - started, ...(persona ? { asAgent } : {}) }, result: `${input.label} → failed: ${message}` });
        return { ok: false, error: message, ...asAgentEcho, ...produced() };
      }
  };
  return {
    // Every child — one `spawn_agent`, or each of a `spawn_agents` fan-out — reports into
    // the chat as it finishes. A report that fails to post never fails the delegation.
    async spawn(input: SubagentRequest): Promise<SubagentResult> {
      const result = await spawn(input);
      await deps.report?.(input, result).catch(() => undefined);
      return result;
    },
  };
}

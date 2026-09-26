/**
 * ONE delegated child run on the machine — the core both delegation tools share.
 *
 * `spawn_agent` runs one child; `spawn_agents` runs several side by side. Everything
 * that makes a child accountable to the run that spawned it lives here, once: its tools,
 * its write gate and scope, Stop, the parent's model route and role, the per-result
 * budget, the files it changed and the placeholders it wrote. The two tools differ only
 * in how they parse their arguments and how many children they start.
 */

import { runSubagent, subagentStepBudget, type ToolRowSerializer } from "@builderforce/agent-loop";
import { spawnAgentTool } from "@builderforce/agent-tools";
import {
  codeChangesOf,
  isCodeChangeTool,
  isFailedToolResult,
  placeholderAdvisory,
  placeholdersWritten,
  trimToolResult,
  type BrainStreamFn,
  type BrainToolSpec,
  type ChatCompletionMessage,
  type PlaceholderHit,
} from "@seanhogg/builderforce-brain-embedded";
import type { ChildWriteDecision } from "./childWriteGate";
import type { ToolDef } from "./fileTools";
import { inScope } from "./workstreamScope";

/** The model route a run is on — what a child must reuse so it cannot land elsewhere. */
export interface SubagentModelRoute {
  model?: string;
  modelStrict?: boolean;
  routingMode?: "auto" | "byo_pool";
}

/**
 * What a delegated child inherits from the ONE run that spawned it.
 *
 * Every field is a fact about that run — its approval modal, its Stop button, its model,
 * its bookkeeping — so the host binds them together, per run, where it builds the
 * catalog. A child that ran without them was a second, unaccountable run inside the first:
 * it kept spending after Stop, drifted to the gateway default when the chat was pinned to
 * a model, and wrote files that no ticket, note or Changes refresh ever heard about.
 */
export interface SubagentRunBinding {
  /**
   * Decide one write the child wants to make — governance, then the run's Auto switch,
   * then the human. ABSENT means this host cannot raise a prompt, and a child here is
   * then read-only whatever the parent asked for: the alternative is writing to someone's
   * disk with no way to ask them, which is the thing the gate exists to prevent.
   */
  confirmWrite?(req: { name: string; args: Record<string, unknown> }): Promise<ChildWriteDecision>;
  /** The parent run's cancel signal, read when the delegation STARTS — a host may create
   *  it after the catalog (the run store does), so it cannot be captured up front. */
  signal?(): AbortSignal | undefined;
  /** The parent's model route. Absent ⇒ the transport's own default, as for the parent. */
  route?: SubagentModelRoute;
  /** One finished child tool call, reported to the parent's per-call bookkeeping
   *  (session notes, the Changes view, the panel's tool feed) exactly as its own are. */
  onToolRun?(call: { def: ToolDef; args: Record<string, unknown>; out: unknown }): void;
}

/** What the delegation tools need from the host: a model route and the catalog the
 *  parent is running with. Both are resolved per call — a run can outlive a model
 *  switch, and the catalog depends on whether a workspace is open. */
export interface SubagentToolDeps {
  stream(): Promise<BrainStreamFn>;
  /** The parent's full tool catalog; the child gets the local subset of it. */
  catalog(): ToolDef[];
  /**
   * Resolve one of the WORKSPACE's own agents (Ada, Kevin, Bob…) to the brief the child
   * should run as. Absent ⇒ this host cannot name personas, and `as_agent` is refused
   * rather than silently ignored.
   *
   * WHY: a Work-mode run that does a slice itself instead of dispatching it produces work
   * nobody owns — no agent on the ticket, nothing in anyone's queue, and a user who
   * cannot tell who did what. Running the slice AS the agent whose role fits it keeps the
   * accountability the dispatch would have carried, in a session that already holds the
   * workspace. `null` from this reader means "no such agent", not "reader failed".
   */
  personaBrief?(agent: string): Promise<{ ref: string; name: string; brief: string } | null>;
  /** The spawning run. Absent ⇒ a child with no way to ask a human (read-only), no Stop
   *  and the transport's default route — the posture of a host that has no run to bind. */
  run?: SubagentRunBinding;
}

/**
 * The child's tools: local ones only (never the server-side platform catalog — a
 * delegated task is about THIS workspace, and the parent keeps the platform reach),
 * minus the delegation tools themselves, which is what makes recursion impossible here
 * in the same way withholding the capability does in the cloud.
 *
 * `writable` keeps the mutating half. It is false by default and false whenever the host
 * gave no way to ask a human — the tools a child is HANDED are the boundary, so a child
 * that must not write is never shown a tool that writes, rather than being shown one and
 * refused at dispatch.
 */
export function childToolDefs(catalog: readonly ToolDef[], writable = false): ToolDef[] {
  return catalog.filter(
    (t) => !t.remote && !DELEGATION_TOOL_NAMES.has(t.name) && (writable || !t.mutating),
  );
}

/**
 * The tools of a child that shares the working tree with SIBLINGS: reads, plus the file
 * writers whose target a scope can check. A shell command, a git commit or a push reaches
 * the whole tree whatever the child's scope says, so none of them is handed to a
 * concurrent child — the parent verifies, commits and pushes once every slice is back.
 */
export function workstreamToolDefs(catalog: readonly ToolDef[], writable: boolean): ToolDef[] {
  return childToolDefs(catalog, writable).filter((t) => !t.mutating || isCodeChangeTool(t.name));
}

/** The names a child must never be handed. `spawn_agents` is added by its own module. */
const DELEGATION_TOOL_NAMES = new Set<string>([spawnAgentTool.name, "spawn_agents"]);

/** A resolved persona, or a refusal the parent can act on. */
export type ChildPersona =
  | { ok: true; persona?: { name: string; brief: string }; asAgent?: { ref: string; name: string } }
  | { ok: false; error: string };

/**
 * WHO does a slice. An unresolvable name is REFUSED rather than run anonymously: a
 * parent that believes Ada did the work will report that she did, and a silently
 * persona-less run makes that report false.
 */
export async function resolveChildPersona(deps: SubagentToolDeps, asAgentName: string): Promise<ChildPersona> {
  if (!asAgentName) return { ok: true };
  const resolved = await deps.personaBrief?.(asAgentName).catch(() => null);
  if (!resolved) {
    return {
      ok: false,
      error: `no agent named '${asAgentName}' in this workspace — use builtin_chats_list_agents or builtin_cloud_agents_list_mine and pass its exact name or id`,
    };
  }
  return { ok: true, persona: { name: resolved.name, brief: resolved.brief }, asAgent: { ref: resolved.ref, name: resolved.name } };
}

/** One child, fully specified. */
export interface ChildRunSpec {
  label: string;
  task: string;
  writable: boolean;
  role: string;
  /** The tools this child is handed — already narrowed by the caller. */
  tools: readonly ToolDef[];
  persona?: { name: string; brief: string };
  asAgent?: { ref: string; name: string };
  /** Paths this child may WRITE. Absent ⇒ wherever its write tools reach. */
  scope?: readonly string[];
  /** The work item this slice belongs to, echoed so the parent can report per ticket. */
  ticket?: string;
  /** Cap on the child's answer — a fan-out shares one result between its children. */
  outputChars?: number;
}

/** What a finished child reports to its parent. */
export interface ChildReport {
  ok: boolean;
  label: string;
  output?: string;
  steps?: number;
  maxSteps: number;
  readOnly: boolean;
  role: string;
  asAgent?: { ref: string; name: string };
  ticket?: string;
  scope?: readonly string[];
  changedFiles?: string[];
  placeholders?: PlaceholderHit[];
  truncated?: boolean;
  note?: string;
  error?: string;
}

/** A local tool's serialized result, back as data. Not every executor returns JSON
 *  (a shell tool returns raw output), so an unparseable payload passes through as the
 *  string it is rather than becoming an error. */
function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** OpenAI tool specs for the child's turn. */
function toSpecs(defs: readonly ToolDef[]): BrainToolSpec[] {
  return defs.map((d) => ({
    type: "function" as const,
    function: { name: d.name, description: d.description, parameters: d.parameters },
  }));
}

/**
 * A tool row for the child. A successful result arrives already budgeted by
 * `trimToolResult` — a STRING the model should read as-is (a line-paged `read_file`
 * window, or a head slice with its marker) — so it is kept verbatim; JSON-encoding it
 * again would hand the child an escaped string. Refusals and errors are small objects
 * and serialize normally.
 */
const childToolRow: ToolRowSerializer = (result) =>
  typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? null);

/** Run ONE child to completion. Never throws: a failed child is information for the parent. */
export async function runLocalChild(deps: SubagentToolDeps, spec: ChildRunSpec, root: string): Promise<ChildReport> {
  const run = deps.run;
  const confirmWrite = spec.writable ? run?.confirmWrite : undefined;
  const byName = new Map(spec.tools.map((d) => [d.name, d]));
  const route = run?.route ?? {};
  // Read now, not at catalog time: the run creates its controller after the catalog.
  const signal = run?.signal?.();
  const maxSteps = subagentStepBudget(!spec.writable);
  // Every file the child wrote, echoed so the parent's code-change backstop
  // (`codeChangesOf`) opens the ticket and records the files — the child's writes happen
  // inside one tool call, where the parent's loop cannot see them. Placeholders likewise:
  // the diagnostics read the parent trace, which never sees the child's calls.
  const changedFiles = new Set<string>();
  const placeholders: PlaceholderHit[] = [];
  const base = {
    label: spec.label,
    maxSteps,
    readOnly: !spec.writable,
    role: spec.role,
    ...(spec.asAgent ? { asAgent: spec.asAgent } : {}),
    ...(spec.ticket ? { ticket: spec.ticket } : {}),
    ...(spec.scope ? { scope: spec.scope } : {}),
  };
  const produced = () => ({
    ...(changedFiles.size ? { changedFiles: [...changedFiles] } : {}),
    ...(placeholders.length ? { placeholders } : {}),
  });

  try {
    const stream = await deps.stream();
    const result = await runSubagent<BrainToolSpec>({
      task: spec.task,
      readOnly: !spec.writable,
      tools: toSpecs(spec.tools),
      // The kernel owns what a persona DOES to the child's system prompt
      // (`subagentSystemPrompt`), so both surfaces get one answer; this only names who.
      ...(spec.persona ? { persona: spec.persona } : {}),
      ...(signal ? { signal } : {}),
      ...(spec.outputChars ? { outputChars: spec.outputChars } : {}),
      serialize: childToolRow,
      complete: async ({ messages, tools }) => {
        const turn = await stream({
          messages: messages as unknown as ChatCompletionMessage[],
          ...(tools.length ? { tools, tool_choice: "auto" as const } : {}),
          ...(route.model ? { model: route.model } : {}),
          ...(route.modelStrict != null ? { modelStrict: route.modelStrict } : {}),
          ...(route.routingMode ? { routingMode: route.routingMode } : {}),
          role: spec.role,
          ...(signal ? { signal } : {}),
        });
        return {
          content: turn.text,
          toolCalls: turn.toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.args })),
        };
      },
      dispatch: async (call) => {
        const def = byName.get(call.name);
        if (!def) {
          return {
            data: { ok: false, error: `unknown tool '${call.name}' — available here: ${[...byName.keys()].join(", ")}` },
            isError: true,
          };
        }
        // A stopped run starts nothing new — above all, it raises no approval prompt
        // for a run the user has already walked away from.
        if (signal?.aborted) return { data: { ok: false, error: "the run was stopped" }, isError: true };
        // A scoped child writes only inside its own paths: a sibling may own the rest,
        // and two children writing one file lose one of the writes. Refused BEFORE the
        // human is asked, so nobody is prompted for a write that must not happen.
        if (def.mutating && spec.scope) {
          const target = typeof call.args.path === "string" ? call.args.path : "";
          if (!target || !inScope(target, spec.scope)) {
            return {
              data: {
                ok: false,
                error: `'${target || "(no path)"}' is outside this workstream's paths (${spec.scope.join(", ")}) — another workstream may own it. Change only files inside your paths, and name anything else you believe must change in your answer.`,
              },
              isError: true,
            };
          }
        }
        // A write asks the human FIRST, on the parent run's own modal, naming the
        // file. A refusal comes back as an ordinary tool result with its reason, so
        // the child adapts (or reports what it found) instead of failing the
        // delegation — the same shape a blocked call takes in the parent's loop.
        if (def.mutating && confirmWrite) {
          const decision = await confirmWrite({ name: call.name, args: call.args });
          if (!decision.ok) return { data: { ok: false, error: decision.reason }, isError: true };
        }
        let out: unknown;
        try {
          out = parsePayload(await def.execute(call.args, root));
        } catch (e) {
          out = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
        for (const f of codeChangesOf(call.name, call.args, out) ?? []) changedFiles.add(f);
        const failed = isFailedToolResult(out);
        const hits = failed ? [] : placeholdersWritten(call.name, call.args);
        placeholders.push(...hits);
        run?.onToolRun?.({ def, args: call.args, out });
        // The parent's per-result budget, so a 200 KB read cannot swamp a context
        // whose whole point was to stay small — paged by line, offset intact — with
        // the placeholder advisory the parent's own writes get.
        return { data: trimToolResult(call.name, out, { advisory: placeholderAdvisory(hits) }).content, isError: failed };
      },
    });
    return {
      ...base,
      ok: result.ok,
      output: result.output,
      steps: result.steps,
      ...produced(),
      ...(result.truncated ? { truncated: true, note: "The sub-agent ran out of turns — treat this as partial." } : {}),
      ...(result.ok ? {} : { error: result.cancelled ? "the run was stopped while this sub-agent was working" : "the sub-agent stopped without an answer" }),
    };
  } catch (e) {
    // Files the child already wrote are still reported, or the parent would believe the
    // tree untouched.
    return { ...base, ok: false, error: e instanceof Error ? e.message : String(e), ...produced() };
  }
}

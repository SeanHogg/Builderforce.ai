/**
 * A run bound to A3's forced-turn ladder, for the tests of its decisions: the guards hook with a surface's progress binding
 * (`GuardPorts.progress`), a policy context on a chosen phase, and the verbs a scripted run uses — a call, a turn's end, a turn's menu.
 * The surface's vocabulary is the editor's (`hand_off`, `ask_user`, its change tools), which the binding carries as data.
 */
import type { ToolSchema } from "@builderforce/agent-tools";
import { initialRunPolicy, type RunPhase } from "@builderforce/run-policy";
import { CacheServedStreak } from "../../src/policy/tools/cacheServedStreak.js";
import { createGuardsHook, FINISH_RECORD_TURNS, type ProgressFacts } from "../../src/policy/guards/index.js";
import type { PolicyContext } from "../../src/policy/hooks.js";
import { policyCtx, schemas } from "./policyContext.js";

export const OBLIGATION = ["builtin_tasks_create", "builtin_tasks_update", "builtin_tickets_from_delta", "builtin_chats_list_tickets"];
export const SELECTED = ["read_file", "search_code", "edit_file", "write_file", "ask_user"];
export const CHANGE_TOOLS = ["edit_file", "write_file"];
export const READY = "Now I have everything I need.";
export const CHANGE = "update the PRD with the WS8p design";
export const QUESTION = "what does the read cache cover?";

export const names = (tools: readonly ToolSchema[] | undefined): string[] => (tools ?? []).map((t) => t.function.name);

export interface LadderRun {
  ctx: PolicyContext;
  /** The facts the surface reports; mutate them to change the run. */
  facts: { budgeted: boolean; codeChanged: boolean; progressed: boolean; canAskUser: boolean; obligation: string[]; expectsChange: boolean };
  events: Array<{ tool: string; detail: Record<string, unknown>; result: string }>;
  cache: CacheServedStreak;
  /** One call of the turn ran. */
  call(name: string, args: Record<string, unknown>, result?: unknown): Promise<void>;
  /** The turn's calls all ran; `text` is what it said. */
  endTurn(text?: string): Promise<void>;
  /** A turn that claims readiness and only reads a new file. */
  unkept(i: number): Promise<void>;
  /** The step's decision, over `selected` (the policy's selection). */
  turn(step: number, selected?: readonly string[]): Promise<{ selected: readonly ToolSchema[]; menu?: { tools: readonly ToolSchema[]; toolChoice?: "required"; tail: readonly string[]; final?: true } }>;
  /** The A3 actions taken so far, from the timeline rows. */
  actions(): string[];
  forced(): Array<Record<string, unknown>>;
  finishing(): boolean;
}

export function ladderRun(opts: { phase?: RunPhase; request?: string; canAskUser?: boolean; obligation?: string[]; catalog?: readonly string[]; codeChanged?: boolean; lever?: boolean; codeTurns?: number; skipVerify?: boolean } = {}): LadderRun {
  const catalog = opts.catalog ?? [...SELECTED, "hand_off", ...OBLIGATION];
  const request = opts.request ?? CHANGE;
  const ctx = policyCtx({
    task: { prompt: request, request, dispatch: { source: "chat" } },
    policy: { levers: opts.lever === false ? [] : ["a3_progress_detector"], codeChangeTools: CHANGE_TOOLS, ...(opts.skipVerify ? { skipVerifyStage: true as const } : {}) },
    tools: catalog,
  });
  ctx.state.model = { ...initialRunPolicy({ startPhase: opts.phase ?? "code" }), ...(opts.codeTurns !== undefined ? { codeTurns: opts.codeTurns } : {}) };
  const facts: LadderRun["facts"] = {
    budgeted: !/^what |^how /.test(request),
    codeChanged: opts.codeChanged ?? false,
    progressed: false,
    canAskUser: opts.canAskUser ?? true,
    obligation: opts.obligation ?? [],
    expectsChange: !/^what |^how /.test(request),
  };
  const events: LadderRun["events"] = [];
  const progressFacts: ProgressFacts = {
    budgeted: () => facts.budgeted,
    codeChanged: () => facts.codeChanged,
    progressed: () => facts.progressed || facts.codeChanged,
    canAskUser: () => facts.canAskUser,
    obligationTools: () => facts.obligation,
  };
  const hook = createGuardsHook({
    onEvent: (row) => { events.push(row); },
    progress: {
      isReadOnly: (tool) => tool === "read_file" || tool === "git_status",
      expectsChange: () => facts.expectsChange,
      facts: progressFacts,
      turns: { handOffTool: "hand_off", askTool: "ask_user", recordTurns: FINISH_RECORD_TURNS },
    },
  });
  const cache = new CacheServedStreak();
  let n = 0;
  const run: LadderRun = {
    ctx,
    facts,
    events,
    cache,
    call: async (name, args, result = { ok: true }) => { await hook.observe(ctx, { id: `c${n++}`, name, args }, result); },
    endTurn: async (text = "") => { await hook.endTurn!(ctx, text); },
    unkept: async (i) => { await run.call("read_file", { path: `docs/f${i}.md` }); await run.endTurn(READY); },
    turn: async (step, selected = SELECTED) => {
      ctx.step = step;
      const out = await hook.forcedTurn!(ctx, { select: async () => schemas(selected), cache });
      return out as Awaited<ReturnType<LadderRun["turn"]>>;
    },
    actions: () => events.filter((e) => e.tool === "loop.progress_check").map((e) => String(e.detail.action)),
    forced: () => events.filter((e) => e.tool === "loop.progress_forced").map((e) => e.detail),
    finishing: () => hook.isFinishing!(ctx),
  };
  return run;
}

/** Drive the run to a verified idle finish: an edit, a passing check, then idle turns (the first trip only steers, the second finishes). */
export async function tripFinish(run: LadderRun): Promise<void> {
  await run.call("edit_file", { edits: [{ path: "src/a.tsx", old_string: "x", new_string: "y" }] });
  await run.endTurn();
  await run.call("run_command", { command: "pnpm exec tsc --noEmit", background: true }, { ok: true, background: true, id: "job-1", status: "running" });
  await run.endTurn();
  await run.call("command_status", { id: "job-1" }, { ok: true, id: "job-1", status: "exited", exitCode: 0, output: "" });
  await run.endTurn();
  const idle = async (): Promise<void> => {
    const before = run.actions().length;
    for (let i = 0; i < 4 && run.actions().length === before; i++) {
      await run.call("git_status", {}, { ok: true, stdout: "" });
      await run.endTurn();
    }
  };
  await idle();
  expectActions(run, ["steer"]);
  await run.turn(7);
  await idle();
  expectActions(run, ["steer", "finish"]);
}

function expectActions(run: LadderRun, want: string[]): void {
  const got = run.actions();
  if (got.join() !== want.join()) throw new Error(`expected A3 actions ${want.join()}, got ${got.join()}`);
}

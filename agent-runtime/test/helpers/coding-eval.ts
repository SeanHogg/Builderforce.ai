/**
 * Coding-eval harness — runs the REAL native `Agent` loop, with the REAL shared
 * `@builderforce/agent-tools` core toolset, against a REAL temp git repo on disk, and
 * reports what actually happened to the filesystem.
 *
 * This exists because every other test of the coding path stubs something load-bearing:
 * `agent-loop.test.ts` proves the loop with a toy `echo` tool, and
 * `node-capability-provider.test.ts` proves the provider with no loop. Neither answers
 * "can the agent actually change code". Here the whole stack is wired end-to-end —
 * `buildNodeCapabilityProvider` (real fs + traversal guard) → `buildCoreToolRegistry`
 * (the shared definitions the cloud runs too) → `registryToAgentTools` → `Agent` — and
 * assertions are made on OBSERVED FILESYSTEM STATE, never on model prose.
 *
 * Two modes share one harness so a scripted eval and a live-model eval are the same
 * experiment with a different `streamFn`:
 *   • scripted (default) — a deterministic {@link PlanStep} script drives the tool calls.
 *     Proves the wiring, dispatch, sandboxing and file mutation. No network, no clock.
 *   • live (`*.live.test.ts`) — a real model is handed the task and the same tools.
 *     Pass `streamFn` explicitly; opt in via `vitest.live.config.ts`.
 *
 * A plan step may be a FUNCTION of the trace so far, so a scripted eval can genuinely
 * depend on what a previous tool returned (e.g. edit the file `search_code` actually
 * found) rather than hard-coding the answer the tool was supposed to produce.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  buildCoreToolRegistry,
  type Capability,
  type CapabilityProvider,
  type ShellResult,
} from "@builderforce/agent-tools";
import { buildNodeCapabilityProvider } from "../../src/agents/node-capability-provider.js";
import { Agent } from "../../src/builderforce/agent-loop/agent-loop.js";
import { AssistantMessageEventStream } from "../../src/builderforce/agent-loop/event-stream.js";
import { registryToAgentTools } from "../../src/builderforce/agent-loop/tool-adapter.js";
import type { StreamFn } from "../../src/builderforce/agent-loop/stream.js";
import type { AgentEvent, AgentTool } from "../../src/builderforce/model/agent-types.js";
import type { AssistantMessage, Model, ToolCall } from "../../src/builderforce/model/types.js";

const execFileAsync = promisify(execFile);

/** Placeholder model descriptor — scripted mode never reaches a provider, and live mode
 *  overrides the fields it needs via {@link CodingEvalOptions.model}. */
export const EVAL_MODEL: Model = {
  id: "eval-model",
  name: "eval-model",
  api: "openai-completions",
  provider: "eval",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 8_000,
};

// ── Scripted plans ───────────────────────────────────────────────────────────────

/** One scripted model turn: call a tool, emit final text, or decide from the trace. */
export type PlanStep =
  | { tool: string; args: Record<string, unknown> }
  | { text: string }
  | ((prior: readonly ToolTrace[]) => PlanStep);

/** One observed tool invocation: the args the loop dispatched and the parsed result. */
export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  /** The JSON `data` block the shared tool returned (what the model actually sees). */
  data: Record<string, unknown>;
}

function assistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "eval",
    model: "eval-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  };
}

/**
 * Build a deterministic {@link StreamFn} from a {@link PlanStep} script. Each loop turn
 * consumes one step; a function step is resolved against the trace captured so far, so a
 * later step can act on an earlier tool's real output. Running off the end of the script
 * ends the turn with plain text, so a plan can never hang the loop.
 */
function scriptedStreamFn(plan: readonly PlanStep[], trace: readonly ToolTrace[]): StreamFn {
  let turn = 0;
  return () => {
    const stream = new AssistantMessageEventStream();
    let step = plan[turn++];
    while (typeof step === "function") step = step(trace);
    const message =
      step === undefined
        ? assistantMessage([{ type: "text", text: "plan complete" }], "stop")
        : "text" in step
          ? assistantMessage([{ type: "text", text: step.text }], "stop")
          : assistantMessage(
              [
                {
                  type: "toolCall",
                  id: `tc${turn}`,
                  name: step.tool,
                  arguments: step.args,
                } satisfies ToolCall,
              ],
              "toolUse",
            );
    queueMicrotask(() => {
      stream.push({
        type: "done",
        reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
        message,
      });
      stream.end();
    });
    return stream;
  };
}

// ── Workspace fixtures ───────────────────────────────────────────────────────────

/** Seed a temp directory with `files` (repo-relative POSIX paths) and, unless disabled,
 *  make it a real git repo with one committed baseline so git-aware tools see history. */
export async function seedWorkspace(
  files: Readonly<Record<string, string>>,
  opts?: { git?: boolean },
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bf-coding-eval-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, ...rel.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf-8");
  }
  if (opts?.git !== false) {
    // Fixed identity + dates: no wall-clock or ambient git config leaks into the fixture.
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "Eval",
      GIT_AUTHOR_EMAIL: "eval@builderforce.ai",
      GIT_COMMITTER_NAME: "Eval",
      GIT_COMMITTER_EMAIL: "eval@builderforce.ai",
      GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
    };
    await execFileAsync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: root, env });
    await execFileAsync("git", ["add", "-A"], { cwd: root, env });
    await execFileAsync("git", ["commit", "--quiet", "-m", "baseline"], { cwd: root, env });
  }
  return root;
}

/** Read the whole working tree (excluding `.git`) as repo-relative POSIX path → content. */
export async function readTree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile()) out[relative(root, abs).split(sep).join("/")] = await readFile(abs, "utf-8");
    }
  };
  await walk(root);
  return out;
}

// ── Shell capability (live mode: "does it actually compile/run") ──────────────────

/**
 * Decorate a provider with a real `shell` capability rooted at `cwd`, so a live eval can
 * be graded on the temp project's OWN check (`tsc --noEmit`, `node script.mjs`) instead of
 * string-matching the model's prose. Deliberately opt-in: the scripted suites must not
 * spawn arbitrary commands.
 */
export function withShell(provider: CapabilityProvider, cwd: string): CapabilityProvider {
  return {
    ...provider,
    capabilities: new Set<Capability>([...provider.capabilities, "shell"]),
    shell: {
      async run(command: string): Promise<ShellResult> {
        try {
          const { stdout, stderr } = await execFileAsync(command, {
            cwd,
            shell: true,
            timeout: 120_000,
            maxBuffer: 8 * 1024 * 1024,
          } as Parameters<typeof execFileAsync>[1]);
          return { ok: true, stdout: `${stdout}${stderr}`, exitCode: 0 };
        } catch (err) {
          const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
          return {
            ok: false,
            stdout: `${e.stdout ?? ""}${e.stderr ?? ""}`,
            exitCode: typeof e.code === "number" ? e.code : 1,
            error: e.message,
          };
        }
      },
    },
  };
}

/** Run a command inside the eval workspace — the grader for "it actually works". */
export async function runInWorkspace(
  root: string,
  file: string,
  args: readonly string[],
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(file, [...args], { cwd: root, timeout: 120_000 });
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}` };
  }
}

// ── The eval runner ──────────────────────────────────────────────────────────────

export interface CodingEvalOptions {
  /** Fixture files seeded into the temp repo before the agent runs. */
  files: Readonly<Record<string, string>>;
  /** The user-facing coding task handed to the agent. */
  task: string;
  /** Deterministic tool script. Mutually exclusive with `streamFn`. */
  plan?: readonly PlanStep[];
  /** Real model turn function (live mode). Mutually exclusive with `plan`. */
  streamFn?: StreamFn;
  systemPrompt?: string;
  model?: Model;
  /** Expose `run_command` + the git tools by adding a real `shell` capability. */
  shell?: boolean;
  /** Skip `git init` (a plain directory rather than a repo). */
  git?: boolean;
}

export interface CodingEvalResult {
  /** Absolute temp workspace root — still on disk until `cleanup()`. */
  root: string;
  /** Model-facing tool names actually offered, in registration order. */
  offeredTools: string[];
  /** Every tool invocation the loop dispatched, in order. */
  trace: ToolTrace[];
  /** The working tree after the run (repo-relative POSIX path → content). */
  files: Record<string, string>;
  /** The tree as seeded, for "nothing changed" assertions. */
  filesBefore: Record<string, string>;
  /** Concatenated text of the final assistant turn. */
  finalText: string;
  events: AgentEvent[];
  cleanup: () => Promise<void>;
}

/** Wrap a tool so every dispatch is recorded with its args and the data the model saw. */
function traced(tool: AgentTool, trace: ToolTrace[]): AgentTool {
  const execute: AgentTool["execute"] = async (id, params, signal) => {
    const result = await tool.execute(id, params, signal);
    const first = result.content.find((c) => c.type === "text");
    let data: Record<string, unknown> = {};
    if (first && first.type === "text") {
      try {
        data = JSON.parse(first.text) as Record<string, unknown>;
      } catch {
        data = { raw: first.text };
      }
    }
    trace.push({ name: tool.name, args: (params ?? {}) as Record<string, unknown>, data });
    return result;
  };
  return { ...tool, execute };
}

/**
 * Seed a temp repo, wire the real provider + shared tool registry into the real `Agent`
 * loop, run the task to completion, and return the observed filesystem + tool trace.
 * The caller owns teardown via {@link CodingEvalResult.cleanup}.
 */
export async function runCodingEval(options: CodingEvalOptions): Promise<CodingEvalResult> {
  if ((options.plan === undefined) === (options.streamFn === undefined)) {
    throw new Error("runCodingEval requires exactly one of `plan` (scripted) or `streamFn` (live)");
  }
  const root = resolve(await seedWorkspace(options.files, { git: options.git }));
  const filesBefore = await readTree(root);

  const base = buildNodeCapabilityProvider({
    workspaceRoot: root,
    // Never touch the process-wide approval gate from a test: an eval that reaches
    // `ask_human` gets a deterministic refusal rather than blocking on a real human.
    requestHuman: async () => ({ decision: "rejected" }),
  });
  const provider = options.shell ? withShell(base, root) : base;

  const registry = buildCoreToolRegistry();
  const trace: ToolTrace[] = [];
  const tools = registryToAgentTools(registry, provider, root).map((t) => traced(t, trace));

  const agent = new Agent({
    model: options.model ?? EVAL_MODEL,
    tools,
    systemPrompt:
      options.systemPrompt ??
      "You are a coding agent working in a checked-out repository. Use the provided tools to make the requested change. Read a file before editing it. Do not invent changes that were not asked for.",
  });
  agent.streamFn = options.streamFn ?? scriptedStreamFn(options.plan ?? [], trace);

  const events: AgentEvent[] = [];
  agent.subscribe((e) => events.push(e));

  const produced = await agent.prompt([{ role: "user", content: options.task, timestamp: 0 }]);

  const lastAssistant = produced.filter((m) => m.role === "assistant").at(-1) as
    | AssistantMessage
    | undefined;
  const finalText = (lastAssistant?.content ?? [])
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");

  return {
    root,
    offeredTools: tools.map((t) => t.name),
    trace,
    files: await readTree(root),
    filesBefore,
    finalText,
    events,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

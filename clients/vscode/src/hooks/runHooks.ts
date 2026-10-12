/**
 * One run's view of the workspace hooks — what fires, when, and what the agent is told.
 *
 * Built fresh per run (it holds the run's state: which stop prompts were already handed
 * over, which stop checks already passed) from the workspace's parsed hooks and a shell.
 * No `vscode` import: both editor surfaces (the panel's host-owned run and the native chat
 * participant) wire the SAME object into the SAME seams —
 *
 *   - `beforeTool` / `afterTool` → `createNativeRunTool`, the one tool seam both share;
 *   - `onStop`                   → the loop's `BrainRunRequest.onStop` (`stopHooks.ts`);
 *   - `onRunEnd`                 → after the loop settles.
 *
 * A sub-agent is a clone of its owner, so it gets the owner's tool hooks (a "never push
 * without tests" guard must hold for children too) — but not the run-level ones: "update
 * README with what this session did" is the SESSION's job, not each child's.
 */

import { isFailedToolResult, type RunStopHook, type RunStopInput } from "@seanhogg/builderforce-brain-embedded";
import type { ShellResult } from "@builderforce/agent-tools";
import { DIRECTIVES_DIR, HOOKS_FILE, appliesToRun, matchesTool, type HookEvent, type WorkspaceHook } from "./hookConfig";
import type { LocalShellOptions } from "../localShell";

/** The hooks of one run, as the run's seams call them. */
export interface RunHooks {
  /** A refusal reason when a preTool hook blocks this call, else null. */
  beforeTool(name: string, args: Record<string, unknown>): Promise<string | null>;
  /** The tool's result, with any failing postTool hook's output handed back to the agent. */
  afterTool(name: string, args: Record<string, unknown>, out: unknown): Promise<unknown>;
  onStop: RunStopHook;
  /** Fire the runEnd hooks. Never throws. */
  onRunEnd(): Promise<void>;
}

/** What a run is given beyond its system prompt: the workspace's rules and its hooks. */
export interface RunDirectives {
  rules: string;
  hooks: RunHooks;
}

export interface RunHooksOptions {
  hooks: readonly WorkspaceHook[];
  /** `subagent` runs only the tool hooks (see the header). */
  scope: "run" | "subagent";
  /** False when the person has not approved this workspace's commands — they are skipped. */
  commandsAllowed: boolean;
  shell(command: string, options: LocalShellOptions): Promise<ShellResult>;
}

/** Output of a failing hook command, as much as the agent needs to act on it. */
const FEEDBACK_MAX = 4_000;
const ARGS_ENV_MAX = 32_000;
const SOURCE = `${DIRECTIVES_DIR}/${HOOKS_FILE}`;

const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max)}\n…(truncated)`);

function failureText(hook: WorkspaceHook, result: ShellResult): string {
  const status = result.error ?? `exit ${result.exitCode ?? 1}`;
  const output = clip((result.stdout ?? "").trim() || "(no output)", FEEDBACK_MAX);
  return `Hook "${hook.id}" — \`${hook.command}\` failed (${status}):\n\`\`\`\n${output}\n\`\`\``;
}

/** A run with no hooks: every seam is a pass-through. */
export const NO_RUN_HOOKS: RunHooks = {
  beforeTool: async () => null,
  afterTool: async (_n, _a, out) => out,
  onStop: async () => null,
  onRunEnd: async () => undefined,
};

export function createRunHooks(opts: RunHooksOptions): RunHooks {
  const runLevel = opts.scope === "run";
  const of = (event: HookEvent): WorkspaceHook[] =>
    opts.hooks.filter((h) => h.on === event && (h.prompt || opts.commandsAllowed));
  if (opts.hooks.length === 0) return NO_RUN_HOOKS;

  /** Stop prompts already handed to the agent, and stop commands already settled. */
  const handed = new Set<string>();
  const settled = new Set<string>();
  /** What the last stop said about the run — runEnd's `when` reads it. */
  let last: Pick<RunStopInput, "codeChanged" | "touchedFiles"> = { codeChanged: false, touchedFiles: [] };

  const run = (hook: WorkspaceHook, env: Record<string, string>): Promise<ShellResult> =>
    opts.shell(hook.command!, {
      timeoutMs: hook.timeoutMs,
      env: { BUILDERFORCE_HOOK_EVENT: hook.on, BUILDERFORCE_HOOK_ID: hook.id, ...env },
    }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));

  const toolEnv = (name: string, args: Record<string, unknown>): Record<string, string> => ({
    BUILDERFORCE_TOOL_NAME: name,
    BUILDERFORCE_TOOL_ARGS: clip(JSON.stringify(args), ARGS_ENV_MAX),
  });
  const runEnv = (): Record<string, string> => ({
    BUILDERFORCE_CODE_CHANGED: last.codeChanged ? "1" : "0",
    BUILDERFORCE_TOUCHED_FILES: last.touchedFiles.join("\n"),
  });

  /** Run every matching tool-event command in order; the failures that count. */
  const runToolHooks = async (event: "preTool" | "postTool", name: string, args: Record<string, unknown>): Promise<string[]> => {
    const failures: string[] = [];
    for (const hook of of(event)) {
      if (!hook.command || !matchesTool(hook, name)) continue;
      const result = await run(hook, toolEnv(name, args));
      if (!result.ok && hook.blockOnFailure) failures.push(failureText(hook, result));
    }
    return failures;
  };

  return {
    async beforeTool(name, args) {
      const failures = await runToolHooks("preTool", name, args);
      if (failures.length === 0) return null;
      return `Blocked by this workspace's ${SOURCE} before \`${name}\` ran:\n\n${failures.join("\n\n")}`;
    },

    async afterTool(name, args, out) {
      if (isFailedToolResult(out)) return out;
      const failures = await runToolHooks("postTool", name, args);
      if (failures.length === 0) return out;
      const hookFeedback = `The \`${name}\` call succeeded, but this workspace's ${SOURCE} check after it failed — fix this:\n\n${failures.join("\n\n")}`;
      if (out && typeof out === "object" && !Array.isArray(out)) return { ...(out as Record<string, unknown>), hookFeedback };
      if (typeof out === "string") return `${out}\n\n${hookFeedback}`;
      return { result: out, hookFeedback };
    },

    async onStop(input) {
      if (!runLevel) return null;
      last = { codeChanged: input.codeChanged, touchedFiles: input.touchedFiles };
      const hooks = of("stop").filter((h) => appliesToRun(h, input.codeChanged));

      // Instructions first, each handed over once: what they ask for (docs, a changelog
      // line) is work the checks below should then see.
      const prompts = hooks.filter((h) => h.prompt && !handed.has(h.id));
      if (prompts.length > 0) {
        for (const h of prompts) handed.add(h.id);
        return [
          `Before you finish, this workspace's ${SOURCE} asks you to:`,
          ...prompts.map((h) => `- ${h.prompt}`),
          "Do this now with your tools, then give your final answer.",
        ].join("\n");
      }

      // Checks: re-run each blocking one until it passes (the loop bounds the rounds);
      // an advisory one runs once and its result is ignored.
      const failures: string[] = [];
      for (const hook of hooks) {
        if (!hook.command || settled.has(hook.id)) continue;
        const result = await run(hook, runEnv());
        if (result.ok || !hook.blockOnFailure) settled.add(hook.id);
        else failures.push(failureText(hook, result));
      }
      if (failures.length === 0) return null;
      return [
        `This workspace's ${SOURCE} requires these checks to pass before the run ends, and they failed:`,
        "",
        failures.join("\n\n"),
        "",
        "Fix the cause, then finish. If it cannot be fixed here, say why in your final answer.",
      ].join("\n");
    },

    async onRunEnd() {
      if (!runLevel) return;
      for (const hook of of("runEnd")) {
        if (!hook.command || !appliesToRun(hook, last.codeChanged)) continue;
        await run(hook, runEnv());
      }
    },
  };
}

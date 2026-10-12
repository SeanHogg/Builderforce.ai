import { describe, expect, it } from "vitest";
import type { ShellResult } from "@builderforce/agent-tools";
import { parseHooksFile } from "./hookConfig";
import { createRunHooks, NO_RUN_HOOKS } from "./runHooks";
import type { LocalShellOptions } from "../localShell";

type Call = { command: string; options: LocalShellOptions };

/** A scripted shell: each command answers from `results` (default: pass). */
function scriptedShell(results: Record<string, ShellResult[]> = {}) {
  const calls: Call[] = [];
  const shell = async (command: string, options: LocalShellOptions): Promise<ShellResult> => {
    calls.push({ command, options });
    return results[command]?.shift() ?? { ok: true, exitCode: 0, stdout: "ok" };
  };
  return { calls, shell };
}

const hooksOf = (hooks: unknown[]) => parseHooksFile(JSON.stringify({ hooks })).hooks;
const stop = (codeChanged = true, round = 0) => ({ codeChanged, touchedFiles: ["src/a.ts"], requestText: "do it", round });
const fail = (stdout: string): ShellResult => ({ ok: false, exitCode: 1, stdout });

describe("createRunHooks", () => {
  it("is a pass-through with no hooks", async () => {
    const { shell } = scriptedShell();
    expect(createRunHooks({ hooks: [], scope: "run", commandsAllowed: true, shell })).toBe(NO_RUN_HOOKS);
  });

  it("hands each stop prompt over once, then lets the run settle", async () => {
    const { shell } = scriptedShell();
    const hooks = createRunHooks({
      hooks: hooksOf([{ on: "stop", prompt: "Update README.md" }, { on: "stop", prompt: "Update DONE.md" }]),
      scope: "run",
      commandsAllowed: true,
      shell,
    });
    const nudge = await hooks.onStop(stop());
    expect(nudge).toContain("- Update README.md");
    expect(nudge).toContain("- Update DONE.md");
    expect(await hooks.onStop(stop(true, 1))).toBeNull();
  });

  it("skips codeChanged stop hooks on a run that changed nothing", async () => {
    const { shell } = scriptedShell();
    const hooks = createRunHooks({ hooks: hooksOf([{ on: "stop", prompt: "docs" }]), scope: "run", commandsAllowed: true, shell });
    expect(await hooks.onStop(stop(false))).toBeNull();
  });

  it("runs stop checks after the prompts, holding the run until a blocking one passes", async () => {
    const { shell, calls } = scriptedShell({ lint: [fail("2 errors"), { ok: true, exitCode: 0, stdout: "" }] });
    const hooks = createRunHooks({
      hooks: hooksOf([{ on: "stop", prompt: "docs" }, { on: "stop", command: "lint" }]),
      scope: "run",
      commandsAllowed: true,
      shell,
    });
    expect(await hooks.onStop(stop())).toContain("docs");
    expect(calls).toHaveLength(0);
    const held = await hooks.onStop(stop(true, 1));
    expect(held).toContain("2 errors");
    expect(await hooks.onStop(stop(true, 2))).toBeNull();
    expect(calls.map((c) => c.command)).toEqual(["lint", "lint"]);
    expect(calls[0]!.options.env).toMatchObject({ BUILDERFORCE_HOOK_EVENT: "stop", BUILDERFORCE_TOUCHED_FILES: "src/a.ts" });
    // Settled: a later stop does not re-run it.
    expect(await hooks.onStop(stop(true, 3))).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("an advisory stop check runs once and never holds the run", async () => {
    const { shell, calls } = scriptedShell({ notify: [fail("down")] });
    const hooks = createRunHooks({ hooks: hooksOf([{ on: "stop", command: "notify", blockOnFailure: false }]), scope: "run", commandsAllowed: true, shell });
    expect(await hooks.onStop(stop())).toBeNull();
    expect(await hooks.onStop(stop())).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("a failing preTool command refuses only the matching tool", async () => {
    const { shell, calls } = scriptedShell({ "npm test": [fail("1 failed")] });
    const hooks = createRunHooks({ hooks: hooksOf([{ on: "preTool", tool: "git_push", command: "npm test" }]), scope: "run", commandsAllowed: true, shell });
    expect(await hooks.beforeTool("write_file", {})).toBeNull();
    const refused = await hooks.beforeTool("git_push", { allowBaseBranch: true });
    expect(refused).toContain("1 failed");
    expect(calls[0]!.options.env).toMatchObject({ BUILDERFORCE_TOOL_NAME: "git_push", BUILDERFORCE_TOOL_ARGS: '{"allowBaseBranch":true}' });
  });

  it("a failing postTool command rides back on the tool result; a failed tool is left alone", async () => {
    const { shell, calls } = scriptedShell({ fmt: [fail("bad format"), fail("bad format")] });
    const hooks = createRunHooks({ hooks: hooksOf([{ on: "postTool", tool: "edit_file", command: "fmt" }]), scope: "run", commandsAllowed: true, shell });
    const obj = (await hooks.afterTool("edit_file", {}, { ok: true, change: "modified" })) as Record<string, unknown>;
    expect(obj.ok).toBe(true);
    expect(String(obj.hookFeedback)).toContain("bad format");
    expect(String(await hooks.afterTool("edit_file", {}, "done"))).toContain("bad format");
    const failed = { ok: false, error: "nope" };
    expect(await hooks.afterTool("edit_file", {}, failed)).toBe(failed);
    expect(calls).toHaveLength(2);
  });

  it("skips every command when they are not approved, keeping prompts", async () => {
    const { shell, calls } = scriptedShell();
    const hooks = createRunHooks({
      hooks: hooksOf([{ on: "stop", prompt: "docs" }, { on: "stop", command: "lint" }, { on: "preTool", command: "x" }]),
      scope: "run",
      commandsAllowed: false,
      shell,
    });
    expect(await hooks.beforeTool("write_file", {})).toBeNull();
    expect(await hooks.onStop(stop())).toContain("docs");
    expect(await hooks.onStop(stop())).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("a sub-agent gets tool hooks but not run-level ones", async () => {
    const { shell, calls } = scriptedShell({ x: [fail("no")] });
    const hooks = createRunHooks({
      hooks: hooksOf([{ on: "stop", prompt: "docs" }, { on: "preTool", command: "x" }, { on: "runEnd", command: "y", when: "always" }]),
      scope: "subagent",
      commandsAllowed: true,
      shell,
    });
    expect(await hooks.onStop(stop())).toBeNull();
    expect(await hooks.beforeTool("write_file", {})).toContain("no");
    await hooks.onRunEnd();
    expect(calls.map((c) => c.command)).toEqual(["x"]);
  });

  it("runEnd fires per its `when`, from what the last stop said", async () => {
    const { shell, calls } = scriptedShell();
    const hooks = createRunHooks({
      hooks: hooksOf([{ on: "runEnd", command: "changed" }, { on: "runEnd", command: "every", when: "always" }]),
      scope: "run",
      commandsAllowed: true,
      shell,
    });
    await hooks.onRunEnd();
    expect(calls.map((c) => c.command)).toEqual(["every"]);
    await hooks.onStop(stop(true));
    await hooks.onRunEnd();
    expect(calls.map((c) => c.command)).toEqual(["every", "changed", "every"]);
    expect(calls[1]!.options.env).toMatchObject({ BUILDERFORCE_CODE_CHANGED: "1" });
  });

  it("a shell that throws is a failure, not a crash", async () => {
    const hooks = createRunHooks({
      hooks: hooksOf([{ on: "preTool", command: "x" }]),
      scope: "run",
      commandsAllowed: true,
      shell: async () => { throw new Error("spawn ENOENT"); },
    });
    expect(await hooks.beforeTool("write_file", {})).toContain("spawn ENOENT");
  });
});

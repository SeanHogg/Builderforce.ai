import { describe, it, expect } from "vitest";
import { gitPushTool, gitStatusTool } from "./git-tools.js";
import { shellRunWithStop } from "./git-repo-scope.js";

// PRD 35 E10: the call's Stop (`ToolContext.signal`) reaches every shell command a tool
// runs — a hung `git push` dies with the run, not at the shell's 10-minute bound.
function recordingShell() {
  const calls: Array<{ command: string; signal?: AbortSignal }> = [];
  return {
    calls,
    caps: {
      shell: {
        async run(command: string, opts?: { signal?: AbortSignal }) {
          calls.push({ command, ...(opts?.signal ? { signal: opts.signal } : {}) });
          return { ok: true, exitCode: 0, stdout: "## main" };
        },
      },
    },
  };
}

describe("git tools pass the call's Stop to the shell", () => {
  it("a read git tool runs under the call's signal", async () => {
    const sh = recordingShell();
    const stop = new AbortController();
    await gitStatusTool.execute({}, { ...sh, signal: stop.signal } as never);
    expect(sh.calls).toHaveLength(1);
    expect(sh.calls[0]!.signal).toBe(stop.signal);
  });

  it("a publish git tool runs under the call's signal", async () => {
    const sh = recordingShell();
    const stop = new AbortController();
    await gitPushTool.execute({}, { ...sh, signal: stop.signal } as never);
    expect(sh.calls.length).toBeGreaterThan(0);
    expect(sh.calls.every((c) => c.signal === stop.signal)).toBe(true);
  });

  it("with no signal the shell is called exactly as before (one argument)", async () => {
    const seen: unknown[][] = [];
    const ctx = { caps: { shell: { run: async (...args: unknown[]) => { seen.push(args); return { ok: true }; } } } };
    await shellRunWithStop(ctx, "git status");
    expect(seen).toEqual([["git status"]]);
  });
});

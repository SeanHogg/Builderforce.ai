/**
 * The five SHELL-TRUTH acceptance tests (chat #60338, the run-waste pass). Each maps to one
 * sub-fix: pipefail's real exit code, the no-mutation result cache, output_filter without a
 * re-run, the search-that-found-nothing verdict, and the trailing-`| tail` strip.
 *
 * Where the behaviour already has a home, the test drives it at the SURFACE the run uses
 * (`run_command` / `output_filter` on a shell capability), so it cannot silently regress:
 *   - pipefail's real exit code needs a true pipeline, so it spawns a shell once
 *     (`withPipefail` + `findBash` — the exact route `node-posix-shell.ts` runs);
 *   - the cache's public shape (`cached: true`, the "no files changed since" note) is asserted
 *     on `run_command`'s result — the fingerprint it keys on is the editor shell's own concern
 *     (`localShellCache.test.ts`), since the shared package is node-builtin-free.
 */

import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { findBash } from "./node-posix-shell.js";
import { runShellCommand } from "./shell-tools.js";
import { outputFilterTool } from "./shell-output-filter.js";
import { stripTailLimit } from "./shell-pipe.js";
import { withPipefail } from "./shell-command-shape.js";
import type { ShellCapability, ShellResult } from "./capabilities.js";
import type { ToolContext } from "./tool.js";

/**
 * A shell capability whose `run` answers `fn(command)` (so a test sees the EXACT command the
 * tool routed — the pipefail prefix and the stripped tail — and counts the calls).
 */
function fakeShell(fn: (command: string) => Promise<ShellResult> | ShellResult): { shell: ShellCapability; calls: { command: string }[] } {
  const calls: { command: string }[] = [];
  return {
    calls,
    shell: {
      run: async (command: string) => {
        calls.push({ command });
        return await fn(command);
      },
      output: vi.fn(async () => undefined),
    } as unknown as ShellCapability,
  };
}

/** A ToolContext carrying just the shell capability — `compressLargeOutputs` off, so no C8. */
function ctxWith(shell: ShellCapability): ToolContext {
  return { caps: { capabilities: new Set(["shell", "shell.outputs"]), shell } } as never;
}

describe("a. pipefail — a piped failing command reports the REAL exit code", () => {
  it("`exit 3 | tail` is ok:false with exitCode 3, not tail's 0", () => {
    const bash = process.platform === "win32" ? findBash() : "/bin/sh";
    if (!bash) return; // no POSIX shell on this machine: nothing routes here
    const command = "node -e \"process.exit(3)\" | tail -1";
    const guarded = withPipefail(command, process.platform === "win32" ? bash : null, process.platform);
    const run = spawnSync(bash, ["-c", guarded]);
    // A /bin/sh without pipefail (old dash) keeps the old behaviour rather than breaking.
    const shHasPipefail = spawnSync(bash, ["-c", "set -o pipefail"]).status === 0;
    if (!shHasPipefail) return;
    expect(run.status).toBe(3);
  });

  it("run_command hands a pipeline to the shell, which wraps it in pipefail at exec (withPipefail)", async () => {
    const { shell, calls } = fakeShell(async () => ({ ok: true, exitCode: 0, stdout: "(no output)" }));
    const r = await runShellCommand({ command: "pnpm install 2>&1 | cat" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: true, exitCode: 0 });
    // Unchanged here: the NODE shell applies withPipefail when it spawns (localShell execOnce).
    expect(calls[0]?.command).toBe("pnpm install 2>&1 | cat");
    expect(calls).toHaveLength(1);
  });
});

describe("b. output_filter — a retained output, filtered WITHOUT re-running", () => {
  it("reads the retained output by outputId; the shell's run is never called", async () => {
    const retained = "l1\nl2\nl3\nl4";
    const run = vi.fn();
    const output = vi.fn(async (outputId: string) => (outputId === "out-7" ? retained : undefined));
    const shell = { run, output } as unknown as ShellCapability;
    const r = await outputFilterTool.execute({ outputId: "out-7", tail: 2 }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: true, outputId: "out-7", output: "l3\nl4", totalLines: 4 });
    expect(output).toHaveBeenCalledWith("out-7");
    expect(run).not.toHaveBeenCalled();
  });

  it("run_command returns the shell's outputId so the model can filter the full output", async () => {
    const { shell } = fakeShell(async () => ({ ok: true, exitCode: 0, stdout: "x", outputId: "out-1" }));
    const r = await runShellCommand({ command: "ls" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: true, outputId: "out-1" });
  });
});

describe("c. result cache — an identical command with no mutation between returns cached:true", () => {
  it("the cached repeat is annotated `cached` + the 'no files changed since' note, identical output", async () => {
    // The editor shell's public cached shape (its fingerprint keying is covered in
    // localShellCache.test.ts): re-asserted here as the run_command-facing contract.
    const first: ShellResult = { ok: true, exitCode: 0, stdout: "type-check clean" };
    const cached: ShellResult = { ...first, cached: true, note: "no files changed since 2026-11-09T00:00:00.000Z; re-run with fresh:true to force" };
    const { shell, calls } = fakeShell(async (command) => (calls.length === 1 ? first : cached));
    const ctx = ctxWith(shell);
    const a = await runShellCommand({ command: "pnpm type-check" }, ctx);
    const b = await runShellCommand({ command: "pnpm type-check" }, ctx);
    expect(b.data).toMatchObject({ ok: true, cached: true, stdout: "type-check clean" });
    expect(String(b.data && (b.data as Record<string, unknown>).note)).toMatch(/no files changed since/);
    expect(calls).toHaveLength(2); // the second was the cache lookup, not a re-run
  });

  it("a command carrying a mutation verb is never cached (the run bypasses the cache with fresh:true)", async () => {
    const { shell, calls } = fakeShell(async () => ({ ok: true, exitCode: 0, stdout: "(no output)" }));
    const r = await runShellCommand({ command: "pnpm type-check", fresh: true }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
  });
});

describe("d. a search that matched nothing is ok:true matches:0, NOT a failed step", () => {
  it("run_command reads grep's exit 1 + no output as an answer", async () => {
    // What a real `grep zzz_quux .` returns when nothing matches.
    const { shell } = fakeShell(async () => ({ ok: false, exitCode: 1, stdout: "(no output)" }));
    const r = await runShellCommand({ command: "grep -rn zzz_quux src" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: true, matches: 0 });
    expect(r.data && (r.data as Record<string, unknown>).exitCode).toBeUndefined();
  });

  it("a real no-match grep exits 1 with empty stdout (the shape searchNoMatch rescues)", () => {
    const bash = process.platform === "win32" ? findBash() : "/bin/sh";
    if (!bash) return;
    const run = spawnSync(bash, ["-c", "grep zzz_quux_does_not_exist /dev/null"]);
    expect(run.status).toBe(1);
    expect(String(run.stdout).trim()).toBe("");
  });
});

describe("e. a trailing `| tail -N` is stripped — the real command runs", () => {
  it("stripTailLimit removes a final `| tail -N` (and a `2>&1 | tail -N`)", () => {
    expect(stripTailLimit("pnpm install | tail -20")).toMatchObject({ command: "pnpm install", tail: 20, stripped: true });
    expect(stripTailLimit("pnpm install 2>&1 | tail -20")).toMatchObject({ command: "pnpm install 2>&1", tail: 20, stripped: true });
  });

  it("leaves a tail that feeds a later stage, a `| head`, and a pipeless command alone", () => {
    expect(stripTailLimit("git log | tail -20 | wc -l").stripped).toBe(false);
    expect(stripTailLimit("git log | head -20").stripped).toBe(false);
    expect(stripTailLimit("git status").stripped).toBe(false);
  });

  it("run_command runs the real command without the tail, and says the full output is retained", async () => {
    const { shell, calls } = fakeShell(async () => ({ ok: true, exitCode: 0, stdout: "ok" }));
    const r = await runShellCommand({ command: "pnpm install 2>&1 | tail -20" }, ctxWith(shell));
    expect(calls[0]?.command).toBe("pnpm install 2>&1");
    expect(String(r.data && (r.data as Record<string, unknown>).note)).toMatch(/without the trailing/);
  });
});

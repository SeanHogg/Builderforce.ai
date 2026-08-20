import { describe, expect, it } from "vitest";
import { captureEnv } from "../test-utils/env.js";
import { runCommandWithTimeout, shouldSpawnWithShell } from "./exec.js";
import { SPAWN_BUDGET_MS } from "../test-utils/spawn-timing.js";

describe("runCommandWithTimeout", () => {
  it("never enables shell execution (Windows cmd.exe injection hardening)", () => {
    expect(
      shouldSpawnWithShell({
        resolvedCommand: "npm.cmd",
        platform: "win32",
      }),
    ).toBe(false);
  });

  it("merges custom env with process.env", async () => {
    const envSnapshot = captureEnv(["BUILDERFORCE_AGENTS_BASE_ENV"]);
    process.env.BUILDERFORCE_AGENTS_BASE_ENV = "base";
    try {
      const result = await runCommandWithTimeout(
        [
          process.execPath,
          "-e",
          'process.stdout.write((process.env.BUILDERFORCE_AGENTS_BASE_ENV ?? "") + "|" + (process.env.BUILDERFORCE_AGENTS_TEST_ENV ?? ""))',
        ],
        {
          timeoutMs: 5_000,
          env: { BUILDERFORCE_AGENTS_TEST_ENV: "ok" },
        },
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("base|ok");
      expect(result.termination).toBe("exit");
    } finally {
      envSnapshot.restore();
    }
  });

  it("kills command when no output timeout elapses", async () => {
    const result = await runCommandWithTimeout(
      [process.execPath, "-e", "setTimeout(() => {}, 1_000)"],
      {
        timeoutMs: 1_000,
        noOutputTimeoutMs: 35,
      },
    );

    expect(result.termination).toBe("no-output-timeout");
    expect(result.noOutputTimedOut).toBe(true);
    expect(result.code).not.toBe(0);
  });

  it("resets no output timer when command keeps emitting output", async () => {
    const result = await runCommandWithTimeout(
      [
        process.execPath,
        "-e",
        'let i=0; const t=setInterval(() => { process.stdout.write("."); i += 1; if (i >= 2) { clearInterval(t); process.exit(0); } }, 5);',
      ],
      {
        // Both budgets must outlast the interpreter cold start: the child only
        // starts resetting the timer once it is actually running, and on Windows
        // reaching that point costs far more than the 500ms this used to allow.
        timeoutMs: SPAWN_BUDGET_MS * 2,
        noOutputTimeoutMs: SPAWN_BUDGET_MS,
      },
    );

    expect(result.signal).toBeNull();
    expect(result.code ?? 0).toBe(0);
    expect(result.termination).toBe("exit");
    expect(result.noOutputTimedOut).toBe(false);
    expect(result.stdout.length).toBeGreaterThanOrEqual(2);
  });

  it("reports global timeout termination when overall timeout elapses", async () => {
    const result = await runCommandWithTimeout(
      [process.execPath, "-e", "setTimeout(() => {}, 1_000)"],
      {
        timeoutMs: 15,
      },
    );

    expect(result.termination).toBe("timeout");
    expect(result.noOutputTimedOut).toBe(false);
    expect(result.code).not.toBe(0);
  });
});

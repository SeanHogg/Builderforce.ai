/**
 * Test — the sandbox verify executor: the project's OWN declared checks run over the
 * working tree, honest exit codes, launch failures never pass, and a command the
 * wall-clock budget cannot fit is reported as not finished (exit 124), never a pass.
 *
 * Behaviour ported from `api/src/application/runtime/sandbox/sandboxVerify.ts`; the fs
 * and shell are injected here the way the sandbox host supplies them.
 */
import { describe, expect, it } from "vitest";
import { runSandboxVerify, type VerifySandbox, type VerifyShell } from "../../src/policy/verify/sandboxVerify.js";

const PKG = JSON.stringify({ scripts: { typecheck: "tsc --noEmit", test: "vitest run" } });

function sandbox(patch: Partial<VerifySandbox> = {}): VerifySandbox {
  return {
    read: async () => PKG,
    list: async () => [],
    ...patch,
  };
}

function shell(run: (command: string, timeoutMs: number) => Promise<{ exitCode?: number }>): VerifyShell {
  return { runFor: run };
}

describe("runSandboxVerify", () => {
  it("runs the planned commands and reports their honest exit codes", async () => {
    const ran: string[] = [];
    const r = await runSandboxVerify(
      sandbox(),
      shell(async (command) => {
        ran.push(command);
        return { exitCode: command.includes("typecheck") ? 2 : 0 };
      }),
    );
    expect(r.runner).toBe("npm");
    expect(r.results).toEqual([
      { command: "npm run typecheck", exitCode: 2 },
      { command: "npm run test", exitCode: 0 },
    ]);
    expect(ran).toEqual(["npm run typecheck", "npm run test"]);
  });

  it("detects pnpm from a root lockfile", async () => {
    const r = await runSandboxVerify(
      sandbox({ list: async (glob) => (glob === "pnpm-lock.yaml" ? ["pnpm-lock.yaml"] : []) }),
      shell(async () => ({ exitCode: 0 })),
    );
    expect(r.runner).toBe("pnpm");
    expect(r.results[0]?.command).toBe("pnpm run typecheck");
  });

  // Ported from api sandboxVerify.test "a nested lockfile does not decide the root runner" (same input: a lockfile under packages/x).
  it("a nested lockfile does not decide the root runner", async () => {
    const r = await runSandboxVerify(
      sandbox({ list: async (glob) => (glob === "yarn.lock" ? ["packages/x/yarn.lock"] : []) }),
      shell(async () => ({ exitCode: 0 })),
    );
    expect(r.runner).toBe("npm");
  });

  it("detects yarn from a root lockfile, and npm when none matches", async () => {
    const yarn = await runSandboxVerify(
      sandbox({ list: async (glob) => (glob === "yarn.lock" ? ["yarn.lock"] : []) }),
      shell(async () => ({ exitCode: 0 })),
    );
    expect(yarn.runner).toBe("yarn");
    const npm = await runSandboxVerify(sandbox(), shell(async () => ({ exitCode: 0 })));
    expect(npm.runner).toBe("npm");
  });

  it("a command that could not launch is a failure, never a pass", async () => {
    const r = await runSandboxVerify(
      sandbox(),
      shell(async () => ({})),
    );
    expect(r.results.every((x) => x.exitCode !== 0)).toBe(true);
  });

  it("a command the budget cannot fit is reported as not finished (124), never a pass", async () => {
    let now = 0;
    // First command consumes the whole budget; the second is not started.
    const r = await runSandboxVerify(
      sandbox(),
      shell(async () => {
        now += 10 * 60_000;
        return { exitCode: 0 };
      }),
      () => now,
    );
    expect(r.results[r.results.length - 1]?.exitCode).toBe(124);
  });

  it("a missing package.json yields no scripts and an empty command list", async () => {
    const r = await runSandboxVerify(
      sandbox({ read: async () => null }),
      shell(async () => ({ exitCode: 0 })),
    );
    expect(r.packageScripts).toBeNull();
    expect(r.results).toEqual([]);
  });
});

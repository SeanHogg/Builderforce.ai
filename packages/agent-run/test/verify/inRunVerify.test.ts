/**
 * Test — honest in-run typecheck/test (ticket 3092):
 * - Durable/Worker has no shell → skip, recorded, may finish.
 * - Container / Actions / on-prem run package scripts via existing `run_command`.
 * - Never invent a script the package.json does not declare.
 * - After code changes, container finish is blocked until those commands ran green.
 *
 * Ported from `api/src/application/runtime/cloudAgent/inRunVerify.test.ts`, retargeted
 * to `packages/agent-run/src/policy/verify/inRunVerify`. Assertions are the source's,
 * unchanged.
 */
import { describe, expect, it } from "vitest";
import {
  SANDBOX_IN_RUN_VERIFY_NOTE,
  DURABLE_IN_RUN_VERIFY_NOTE,
  IN_RUN_VERIFY_SCRIPT_NAMES,
  inRunVerifyOutcome,
  packageVerifyCommands,
  planInRunVerify,
} from "../../src/policy/verify/inRunVerify.js";

const SCRIPTS = { typecheck: "tsc --noEmit", test: "vitest run", lint: "eslint ." };

describe("packageVerifyCommands", () => {
  it("emits typecheck then test when both scripts exist", () => {
    expect(packageVerifyCommands(SCRIPTS)).toEqual(["npm run typecheck", "npm run test"]);
  });

  it("prefers typecheck over type-check and does not emit both", () => {
    expect(packageVerifyCommands({ "type-check": "tsc -p .", typecheck: "tsc --noEmit", test: "vitest run" }))
      .toEqual(["npm run typecheck", "npm run test"]);
  });

  it("accepts type-check when typecheck is absent", () => {
    expect(packageVerifyCommands({ "type-check": "tsc --noEmit" })).toEqual(["npm run type-check"]);
  });

  it("does not invent npm test when no test script exists", () => {
    expect(packageVerifyCommands({ typecheck: "tsc --noEmit", build: "vite build" })).toEqual(["npm run typecheck"]);
  });

  it("returns [] when package.json has no verify scripts", () => {
    expect(packageVerifyCommands({ build: "vite build", lint: "eslint ." })).toEqual([]);
    expect(packageVerifyCommands({})).toEqual([]);
    expect(packageVerifyCommands(null)).toEqual([]);
    expect(packageVerifyCommands(undefined)).toEqual([]);
  });

  it("honours pnpm/yarn runners without inventing a command", () => {
    expect(packageVerifyCommands({ test: "vitest run" }, "pnpm")).toEqual(["pnpm run test"]);
    expect(packageVerifyCommands({ test: "vitest run" }, "yarn")).toEqual(["yarn run test"]);
  });
});

describe("planInRunVerify", () => {
  it("durable records an honest no-shell skip and never lists commands", () => {
    const plan = planInRunVerify({ surface: "durable", packageScripts: SCRIPTS });
    expect(plan).toEqual({
      kind: "skipped",
      surface: "durable",
      reason: "no_shell",
      commands: [],
      scriptNames: IN_RUN_VERIFY_SCRIPT_NAMES,
      note: DURABLE_IN_RUN_VERIFY_NOTE,
    });
  });

  it("container / github_actions / on-prem plan the package scripts (no SSH)", () => {
    for (const surface of ["sandbox", "on-prem"] as const) {
      const plan = planInRunVerify({ surface, packageScripts: SCRIPTS });
      expect(plan.kind).toBe("run");
      expect(plan.surface).toBe(surface);
      expect(plan.reason).toBeNull();
      expect(plan.commands).toEqual(["npm run typecheck", "npm run test"]);
      expect(plan.note).toBe(SANDBOX_IN_RUN_VERIFY_NOTE);
    }
  });
});

describe("inRunVerifyOutcome", () => {
  it("durable skip is allowed to finish even after writes — it cannot have run a shell", () => {
    const o = inRunVerifyOutcome({
      surface: "durable",
      writtenPaths: ["src/a.ts"],
      packageScripts: SCRIPTS,
    });
    expect(o.kind).toBe("skipped");
    expect(o.reason).toBe("no_shell");
    expect(o.mayFinish).toBe(true);
    expect(o.commands).toEqual([]);
    expect(o.note).toBe(DURABLE_IN_RUN_VERIFY_NOTE);
  });

  it("container with no writes may finish without running tests", () => {
    const o = inRunVerifyOutcome({ surface: "sandbox", writtenPaths: [], packageScripts: SCRIPTS });
    expect(o.kind).toBe("skipped");
    expect(o.reason).toBe("nothing_written");
    expect(o.mayFinish).toBe(true);
  });

  it("container that wrote code and has not run the commands must not finish", () => {
    const o = inRunVerifyOutcome({
      surface: "sandbox",
      writtenPaths: ["src/a.ts"],
      packageScripts: SCRIPTS,
    });
    expect(o.kind).toBe("pending");
    expect(o.reason).toBe("not_yet_run");
    expect(o.mayFinish).toBe(false);
    expect(o.commands).toEqual(["npm run typecheck", "npm run test"]);
  });

  it("container that ran the planned commands green may finish", () => {
    const o = inRunVerifyOutcome({
      surface: "sandbox",
      writtenPaths: ["src/a.ts"],
      packageScripts: SCRIPTS,
      results: [
        { command: "npm run typecheck", exitCode: 0 },
        { command: "npm run test", exitCode: 0 },
      ],
    });
    expect(o.kind).toBe("ran");
    expect(o.reason).toBe("verify_passed");
    expect(o.mayFinish).toBe(true);
    expect(o.failedCommands).toEqual([]);
  });

  it("container that failed typecheck must not finish", () => {
    const o = inRunVerifyOutcome({
      surface: "sandbox",
      writtenPaths: ["src/a.ts"],
      packageScripts: SCRIPTS,
      results: [
        { command: "npm run typecheck", exitCode: 2 },
        { command: "npm run test", exitCode: 0 },
      ],
    });
    expect(o.kind).toBe("ran");
    expect(o.reason).toBe("verify_failed");
    expect(o.mayFinish).toBe(false);
    expect(o.failedCommands).toEqual(["npm run typecheck"]);
  });

  it("on-prem with no verify scripts may finish (CI still applies)", () => {
    const o = inRunVerifyOutcome({
      surface: "on-prem",
      writtenPaths: ["src/a.ts"],
      packageScripts: { build: "vite build" },
    });
    expect(o.kind).toBe("skipped");
    expect(o.reason).toBe("no_scripts");
    expect(o.mayFinish).toBe(true);
  });
});

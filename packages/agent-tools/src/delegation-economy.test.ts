import { describe, expect, it } from "vitest";
import {
  commandsInBrief,
  duplicateOfLiveChild,
  normalizeCommand,
  trivialDelegationRefusal,
} from "./delegation-economy.js";

/** The verify brief VS Code chat #60338 handed "Mike QA" — three commands, nothing to think about. */
const MIKE_QA_BRIEF = [
  "Run these and report each failure verbatim:",
  "1. pnpm -C clients/vscode exec tsc --noEmit",
  "2. pnpm -C clients/vscode exec vitest run src/a.test.ts src/b.test.ts",
  "3. pnpm install --frozen-lockfile",
].join("\n");

describe("normalizeCommand", () => {
  it("drops the decorations an owner adds around the same work", () => {
    expect(normalizeCommand("cd clients/vscode && pnpm   exec tsc --noEmit 2>&1 | tail -40")).toBe("pnpm exec tsc --noEmit");
    expect(normalizeCommand("$ pnpm test;")).toBe("pnpm test");
  });
});

describe("commandsInBrief", () => {
  it("reads numbered lines, fenced blocks and backticked spans — and nothing that is prose", () => {
    const brief = "Check `pnpm lint` first, then the list below.\n```\n$ pnpm test\n# a comment\n```\n- git status\nRead the README.";
    expect(commandsInBrief(brief)).toEqual(["pnpm lint", "pnpm test", "git status"]);
  });
});

describe("duplicateOfLiveChild (chat #60338)", () => {
  const child = { handle: "a1", brief: MIKE_QA_BRIEF, started: [] as string[] };

  it("refuses an owner command the live child was briefed to run", () => {
    expect(duplicateOfLiveChild("pnpm -C clients/vscode exec tsc --noEmit 2>&1 | tail -50", [child])).toBe(
      "a1 is already running this — call wait_agents for its result",
    );
  });

  it("refuses an owner command the live child has already started", () => {
    const started = { handle: "a2", brief: "Investigate the flaky test and fix it.", started: ["pnpm vitest run src/flaky.test.ts"] };
    expect(duplicateOfLiveChild("cd . && pnpm vitest run src/flaky.test.ts", [child, started])).toBe(
      "a2 is already running this — call wait_agents for its result",
    );
  });

  it("lets through a command no live child owns", () => {
    expect(duplicateOfLiveChild("pnpm -C api exec tsc --noEmit", [child])).toBeNull();
    expect(duplicateOfLiveChild("pnpm install --frozen-lockfile", [])).toBeNull();
  });
});

describe("trivialDelegationRefusal", () => {
  it("refuses a brief that is only ≤3 shell commands with no reasoning task", () => {
    const refusal = trivialDelegationRefusal(MIKE_QA_BRIEF);
    expect(refusal).toContain("run these yourself with run_command background:true");
    expect(refusal).toContain("`pnpm install --frozen-lockfile`");
  });

  it("still refuses when the brief only says what NOT to do", () => {
    expect(trivialDelegationRefusal("Run `pnpm test` and report the output. Do not fix anything.")).not.toBeNull();
  });

  it("keeps a brief that asks the child to reason", () => {
    expect(trivialDelegationRefusal(`${MIKE_QA_BRIEF}\nThen fix whatever fails.`)).toBeNull();
    expect(trivialDelegationRefusal("Investigate why `pnpm test` hangs on CI.")).toBeNull();
  });

  it("keeps a brief with more than three commands, or none", () => {
    expect(trivialDelegationRefusal("- pnpm a\n- pnpm b\n- pnpm c\n- pnpm d")).toBeNull();
    expect(trivialDelegationRefusal("Map every caller of resolveAgentEngine.")).toBeNull();
  });
});

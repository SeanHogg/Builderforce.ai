import { describe, expect, it, vi } from "vitest";
import { delegationGate } from "../../src/policy/subagents/commandDedup.js";
import type { LiveChildWork } from "@builderforce/agent-tools";

/**
 * Fix #3 — DELEGATION DEDUP. The gate (policy/subagents/commandDedup.ts) is the agent
 * core's enforcement of the two delegation-economy rules defined once in
 * `@builderforce/agent-tools` (delegation-economy.ts), plus the liveness property that
 * lets `wait_agents` resolve on a child's completion event instead of polling to its
 * timeout.
 */

/** The verify brief VS Code chat #60338 handed a child — three commands, nothing to think about. */
const VERIFY_BRIEF = [
  "Run these and report each failure verbatim:",
  "1. pnpm -C clients/vscode exec tsc --noEmit",
  "2. pnpm -C clients/vscode exec vitest run src/a.test.ts src/b.test.ts",
  "3. pnpm install --frozen-lockfile",
].join("\n");

describe("delegationGate — a live child's command is refused to the owner (rule a)", () => {
  const child: LiveChildWork = { handle: "a1", brief: VERIFY_BRIEF, started: [] };

  it("refuses a parent run_command identical (normalised) to a command in the child's brief", () => {
    const gate = delegationGate({ live: () => [child] });
    // Same work, differently decorated: trimmed, whitespace-collapsed, `2>&1 | tail` dropped.
    expect(gate.runCommandRefusal("  pnpm -C clients/vscode   exec tsc --noEmit 2>&1 | tail -50  ")).toBe(
      "a1 is already running this — call wait_agents for its result",
    );
  });

  it("refuses a parent run_command the child has already started, honouring cwd", () => {
    const started: LiveChildWork = { handle: "a2", brief: "Investigate the flaky test and fix it.", started: [{ command: "pnpm test", cwd: "api" }] };
    const gate = delegationGate({ live: () => [child, started] });
    expect(gate.runCommandRefusal("pnpm test", "api")).toBe("a2 is already running this — call wait_agents for its result");
    // The same command in another directory is other work.
    expect(gate.runCommandRefusal("pnpm test", "clients/vscode")).toBeNull();
  });

  it("a `cd X &&` prefix on either side says where the work runs — refused only in the same directory", () => {
    const briefed: LiveChildWork = { handle: "a3", brief: "1. cd api && pnpm test", started: [] };
    const gate = delegationGate({ live: () => [briefed] });
    expect(gate.runCommandRefusal("pnpm test", "api")).toBe("a3 is already running this — call wait_agents for its result");
    expect(gate.runCommandRefusal("pnpm test", "clients/vscode")).toBeNull();
  });

  it("never refuses a cheap read-only command, and lets everything through with no registry", () => {
    const mentions: LiveChildWork = { handle: "a5", brief: "- git status\n- ls src", started: ["git log --oneline"] };
    const gate = delegationGate({ live: () => [mentions] });
    for (const c of ["git status", "ls src", "git log --oneline"]) expect(gate.runCommandRefusal(c)).toBeNull();
    // No live-child registry on this surface: nothing to duplicate, run_command is never refused.
    for (const c of ["pnpm test", "pnpm exec tsc --noEmit"]) expect(delegationGate().runCommandRefusal(c)).toBeNull();
  });
});

describe("delegationGate — the trivial-brief rule (rule b)", () => {
  it("refuses a verify-only delegation of ≤3 shell commands with no reasoning", () => {
    const refusal = delegationGate().spawnRefusal(VERIFY_BRIEF);
    expect(refusal).toContain("run these yourself with run_command background:true");
    expect(refusal).toContain("`pnpm install --frozen-lockfile`");
  });

  it("still refuses when the brief only says what NOT to do", () => {
    expect(delegationGate().spawnRefusal("Run `pnpm test` and report the output. Do not fix anything.")).not.toBeNull();
  });

  it("keeps a brief that asks the child to reason, or carries more than three commands", () => {
    expect(delegationGate().spawnRefusal(`${VERIFY_BRIEF}\nThen fix whatever fails.`)).toBeNull();
    expect(delegationGate().spawnRefusal("- pnpm a\n- pnpm b\n- pnpm c\n- pnpm d")).toBeNull();
    expect(delegationGate().spawnRefusal("Investigate why `pnpm test` hangs on CI.")).toBeNull();
  });
});

describe("delegationGate — wait_agents returns on the completion event, not by polling (rule c)", () => {
  it("re-reads the registry on every decision: a child that settled is gone from the next call", () => {
    const live: LiveChildWork[] = [{ handle: "a1", brief: VERIFY_BRIEF, started: [] }];
    const gate = delegationGate({ live: () => live });
    expect(gate.runCommandRefusal("pnpm install --frozen-lockfile")).not.toBeNull();
    expect(gate.liveNow()).toHaveLength(1);
    // The child's completion event: the surface drops it from the registry…
    live.length = 0;
    // …and the very next decision sees it gone — no timer, no poll, no cached snapshot.
    expect(gate.liveNow()).toHaveLength(0);
    expect(gate.runCommandRefusal("pnpm install --frozen-lockfile")).toBeNull();
  });

  it("a wait built on the gate resolves within one poll tick of the completion event — never at the 300 s timeout", async () => {
    vi.useFakeTimers();
    try {
      const live: LiveChildWork[] = [{ handle: "a1", brief: VERIFY_BRIEF, started: [] }];
      const gate = delegationGate({ live: () => live });
      // A wait that returns as soon as liveNow() is empty, with a 300 s fallback timeout.
      let done = false;
      const waiting = (async () => {
        while (gate.liveNow().length > 0) await new Promise((r) => setTimeout(r, 50));
        done = true;
      })();
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(false);
      live.length = 0; // the completion event fires
      await vi.advanceTimersByTimeAsync(50); // ONE poll tick — the 300 s fallback never fires
      expect(done).toBe(true);
      await waiting;
    } finally {
      vi.useRealTimers();
    }
  });
});

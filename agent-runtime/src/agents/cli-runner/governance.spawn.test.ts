/**
 * The governance directives reach the CLI subprocess, on a NEW session (in the system prompt it is sent) and on a RESUMED one (which is
 * not sent the system prompt, so they go in front of the prompt). Read off what `runCliAgent` actually hands the process supervisor,
 * so removing the delivery from `runCliAgent` fails this test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PolicyGate } from "@builderforce/agent-tools";

const mocks = vi.hoisted(() => ({ resolveGates: vi.fn(), spawn: vi.fn() }));
vi.mock("../../infra/host-policy-gates.js", () => ({ resolveHostPolicyGates: mocks.resolveGates }));
vi.mock("../../process/supervisor/index.js", () => ({
  getProcessSupervisor: () => ({ spawn: mocks.spawn, cancel: vi.fn(), cancelScope: vi.fn(), reconcileOrphans: vi.fn(), getRecord: vi.fn() }),
}));

import { runCliAgent } from "../cli-runner.js";

const DIRECTIVE: PolicyGate = { id: "careful", effect: "inject-directive", directive: "Never touch production." };
const BLOCK: PolicyGate = { id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.spawn.mockResolvedValue({
    runId: "r",
    pid: 1,
    startedAtMs: Date.now(),
    stdin: undefined,
    cancel: vi.fn(),
    wait: vi.fn().mockResolvedValue({
      reason: "exit",
      exitCode: 0,
      exitSignal: null,
      durationMs: 5,
      stdout: "ok",
      stderr: "",
      timedOut: false,
      noOutputTimedOut: false,
    }),
  });
});

const run = (cliSessionId?: string) =>
  runCliAgent({
    sessionId: "s1",
    sessionFile: "/tmp/session.jsonl",
    workspaceDir: "/tmp",
    prompt: "fix the bug",
    provider: "claude-cli",
    model: "opus",
    timeoutMs: 1_000,
    runId: "run-1",
    ...(cliSessionId ? { cliSessionId } : {}),
  });

/** What the subprocess is handed: argv plus stdin, as one string. */
const handedToProcess = (): { argv: string[]; all: string } => {
  const call = mocks.spawn.mock.calls[0]![0] as { argv: string[]; input?: string };
  return { argv: call.argv, all: JSON.stringify([call.argv, call.input ?? ""]) };
};

describe("runCliAgent under directive gates", () => {
  it("a NEW session is sent the directives in its system prompt, and the prompt is untouched", async () => {
    mocks.resolveGates.mockResolvedValue([DIRECTIVE]);
    await run();

    const { argv } = handedToProcess();
    const system = argv[argv.indexOf("--append-system-prompt") + 1] ?? "";
    expect(system).toContain("Never touch production.");
    expect(argv.at(-1)).toBe("fix the bug");
  });

  it("a RESUMED session is not sent the system prompt, so the directives go in front of the prompt", async () => {
    mocks.resolveGates.mockResolvedValue([DIRECTIVE]);
    await run("thread-123");

    const { argv } = handedToProcess();
    expect(argv).not.toContain("--append-system-prompt");
    const prompt = argv.at(-1) ?? "";
    expect(prompt).toContain("Never touch production.");
    expect(prompt.endsWith("fix the bug")).toBe(true);
  });

  it("with no gates nothing is added to either", async () => {
    mocks.resolveGates.mockResolvedValue([]);
    await run("thread-123");

    expect(handedToProcess().all).not.toContain("Governance");
    expect(handedToProcess().argv.at(-1)).toBe("fix the bug");
  });

  it("a gate the CLI cannot be held to refuses it before anything is spawned", async () => {
    mocks.resolveGates.mockResolvedValue([DIRECTIVE, BLOCK]);

    await expect(run()).rejects.toThrow(/no-shell/);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});

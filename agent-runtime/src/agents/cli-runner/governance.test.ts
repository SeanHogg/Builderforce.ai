/**
 * A CLI backend cannot be held to a governance gate (its subprocess runs its own tools with the
 * permission prompts skipped), so a tenant `block` / `require-approval` gate refuses it, in a way
 * model fallback treats as "try the next candidate"; directive-only gates ride its system prompt.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderPolicyDirectives, type PolicyGate } from "@builderforce/agent-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuilderForceAgentsConfig } from "../../config/config.js";

const mocks = vi.hoisted(() => ({ resolveGates: vi.fn(), warn: vi.fn() }));
vi.mock("../../infra/host-policy-gates.js", () => ({ resolveHostPolicyGates: mocks.resolveGates }));
vi.mock("../../logger.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../logger.js")>()),
  logWarn: mocks.warn,
}));

import { resolveCliBackendConfig } from "../cli-backends.js";
import { isFailoverError } from "../failover-error.js";
import { runWithModelFallback } from "../model-fallback.js";
import { buildSystemPrompt, resolveSystemPromptUsage } from "./helpers.js";
import { deliverCliGovernance, governCliRun } from "./governance.js";

const block: PolicyGate = { id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" };
const approval: PolicyGate = { id: "ask-first", tool: "write_file", effect: "require-approval", reason: "needs a person" };
const directive: PolicyGate = { id: "careful", effect: "inject-directive", directive: "Never touch production." };

const cfg = {
  agents: { defaults: { model: { primary: "claude-cli/opus", fallbacks: ["openai/gpt-5.2"] } } },
} as BuilderForceAgentsConfig;

let agentDir: string;
const agentDirFor = (): string => agentDir;
beforeEach(async () => {
  vi.clearAllMocks();
  agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-cli-gov-"));
});
afterEach(async () => {
  await fs.rm(agentDir, { recursive: true, force: true });
});

/** The run callback the auto-reply, cron and command paths give model fallback: the CLI branch calls `runCliAgent`, which governs first. */
const runCandidate = (provider: string, model: string): Promise<string> =>
  provider === "claude-cli" ? governCliRun({ provider, model }).then(() => "cli ran") : Promise.resolve(`embedded ran on ${provider}/${model}`);

describe("governCliRun", () => {
  it("adds nothing for a tenant with no gates", async () => {
    mocks.resolveGates.mockResolvedValue([]);
    expect(await governCliRun({ provider: "claude-cli", model: "opus" })).toBe("");
  });

  for (const gate of [block, approval]) {
    it(`refuses the backend under a ${gate.effect} gate, with a failover-eligible error that names the gate`, async () => {
      mocks.resolveGates.mockResolvedValue([directive, gate]);
      const err = await governCliRun({ provider: "claude-cli", model: "opus" }).catch((e: unknown) => e);

      expect(isFailoverError(err)).toBe(true);
      const message = (err as Error).message;
      expect(message).toContain(gate.id);
      expect(message).toContain("claude-cli");
    });
  }

  it("logs one line naming the gates when a run moves off the CLI (it can change billing)", async () => {
    mocks.resolveGates.mockResolvedValue([block]);
    await governCliRun({ provider: "claude-cli", model: "opus" }).catch(() => undefined);

    expect(mocks.warn).toHaveBeenCalledTimes(1);
    const line = String(mocks.warn.mock.calls[0]![0]);
    expect(line).toContain("claude-cli/opus");
    expect(line).toContain("no-shell");
    expect(line).toContain("billing");
  });

  it("logs nothing when the CLI is allowed", async () => {
    mocks.resolveGates.mockResolvedValue([directive]);
    await governCliRun({ provider: "claude-cli", model: "opus" });
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("renders directive-only gates into the system prompt and runs", async () => {
    mocks.resolveGates.mockResolvedValue([directive]);
    const governance = await governCliRun({ provider: "claude-cli", model: "opus" });
    expect(governance).toContain("Never touch production.");
    expect(governance).toContain("Governance");
  });
});

describe("a CLI primary under model fallback", () => {
  it("falls over to the embedded candidate when a block gate is in force", async () => {
    mocks.resolveGates.mockResolvedValue([block]);
    const out = await runWithModelFallback({ cfg, agentDir, provider: "claude-cli", model: "opus", run: runCandidate });

    expect(out.result).toBe("embedded ran on openai/gpt-5.2");
    expect(out.attempts).toHaveLength(1);
    expect(out.attempts[0]).toMatchObject({ provider: "claude-cli", model: "opus" });
    expect(out.attempts[0]!.error).toContain("no-shell");
  });

  it("fails naming the gates when there is no embedded candidate", async () => {
    mocks.resolveGates.mockResolvedValue([block]);
    await expect(
      runWithModelFallback({ cfg, agentDir, provider: "claude-cli", model: "opus", fallbacksOverride: [], run: runCandidate }),
    ).rejects.toThrow(/no-shell/);
  });

  it("runs the CLI as usual when only directive gates are in force", async () => {
    mocks.resolveGates.mockResolvedValue([directive]);
    const out = await runWithModelFallback({ cfg, agentDir, provider: "claude-cli", model: "opus", run: runCandidate });
    expect(out.result).toBe("cli ran");
    expect(out.attempts).toHaveLength(0);
  });
});

describe("directive gates on a resumed CLI session", () => {
  const governance = renderPolicyDirectives([directive]);
  const backend = resolveCliBackendConfig("claude-cli", undefined)!.config;

  it("a new session carries them in the system prompt it is sent, and the prompt is untouched", () => {
    const systemPrompt = buildSystemPrompt({ workspaceDir: agentDirFor(), tools: [], modelDisplay: "claude-cli/opus", extraSystemPrompt: governance });
    const sent = resolveSystemPromptUsage({ backend, isNewSession: true, systemPrompt });

    expect(sent).toContain("Never touch production.");
    expect(deliverCliGovernance({ governance, systemPromptArg: sent, prompt: "fix the bug" })).toBe("fix the bug");
  });

  it("a resumed session is not sent the system prompt, so they go in front of the prompt instead", () => {
    const systemPrompt = buildSystemPrompt({ workspaceDir: agentDirFor(), tools: [], modelDisplay: "claude-cli/opus", extraSystemPrompt: governance });
    const sent = resolveSystemPromptUsage({ backend, isNewSession: false, systemPrompt });

    expect(sent).toBeNull();
    const prompt = deliverCliGovernance({ governance, systemPromptArg: sent, prompt: "fix the bug" });
    expect(prompt).toContain("Never touch production.");
    expect(prompt.endsWith("fix the bug")).toBe(true);
    expect(prompt.indexOf("Never touch production.")).toBeLessThan(prompt.indexOf("fix the bug"));
  });

  it("with no directives the prompt is never touched", () => {
    expect(deliverCliGovernance({ governance: "", systemPromptArg: null, prompt: "fix the bug" })).toBe("fix the bug");
  });
});

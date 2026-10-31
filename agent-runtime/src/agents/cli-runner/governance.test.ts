/**
 * A CLI backend cannot be held to a governance gate (its subprocess runs its own tools with the
 * permission prompts skipped), so a tenant `block` / `require-approval` gate refuses it, in a way
 * model fallback treats as "try the next candidate"; directive-only gates ride its system prompt.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PolicyGate } from "@builderforce/agent-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuilderForceAgentsConfig } from "../../config/config.js";

const mocks = vi.hoisted(() => ({ resolveGates: vi.fn() }));
vi.mock("../../infra/host-policy-gates.js", () => ({ resolveHostPolicyGates: mocks.resolveGates }));

import { isFailoverError } from "../failover-error.js";
import { runWithModelFallback } from "../model-fallback.js";
import { governCliRun } from "./governance.js";

const block: PolicyGate = { id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" };
const approval: PolicyGate = { id: "ask-first", tool: "write_file", effect: "require-approval", reason: "needs a person" };
const directive: PolicyGate = { id: "careful", effect: "inject-directive", directive: "Never touch production." };

const cfg = {
  agents: { defaults: { model: { primary: "claude-cli/opus", fallbacks: ["openai/gpt-5.2"] } } },
} as BuilderForceAgentsConfig;

let agentDir: string;
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

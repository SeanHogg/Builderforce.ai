import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernanceApiClient } from "./governance-audit/api-client.js";
import { MAX_SCAN_BYTES } from "./governance-audit/walker.js";
import { createGovernanceAuditTool } from "./governance-audit-tool.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "gov-tool-"));
  await fs.writeFile(path.join(root, "prod.env"), "SECRET=1");
  await fs.writeFile(path.join(root, "index.ts"), "export {};");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function stubClient(): GovernanceApiClient & {
  startAudit: ReturnType<typeof vi.fn>;
  finalizeAudit: ReturnType<typeof vi.fn>;
} {
  return {
    resolveRuleset: vi.fn(async () => ({
      rulesetHash: "h1",
      packsApplied: [{ packId: "p1", name: "Baseline", source: "db" }],
      rules: [
        { ruleRef: "NO-ENV", title: "No env files", severity: "blocker", check: { kind: "glob", pattern: "**/*.env" } },
        { ruleRef: "LLM-ONLY", title: "Readable code", severity: "low" },
      ],
    })),
    startAudit: vi.fn(async () => ({ runId: "run-1" })),
    finalizeAudit: vi.fn(async () => undefined),
  };
}

function details(result: { details?: unknown }): Record<string, unknown> {
  return result.details as Record<string, unknown>;
}

describe("governance_audit tool", () => {
  it("runs the pipeline against the stubbed API and records the run", async () => {
    const client = stubClient();
    const tool = createGovernanceAuditTool({ workspaceDir: root, client });
    expect(tool?.name).toBe("governance_audit");

    const result = await tool!.execute("call-1", { projectId: "42", repoRef: "org/repo" });
    const payload = details(result);

    expect(payload.runId).toBe("run-1");
    expect(payload.gateResult).toBe("blocked");
    expect(payload.summary).toMatchObject({ blocker: 1, passed: 1, errored: 0 });
    expect(client.resolveRuleset).toHaveBeenCalledWith({ projectId: "42", repoRef: "org/repo" });
    expect(client.startAudit).toHaveBeenCalledWith({ projectId: "42", repoRef: "org/repo", trigger: "manual" });
    expect(client.finalizeAudit).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        gateResult: "blocked",
        rulesetHash: "h1",
        packsApplied: [{ packId: "p1", name: "Baseline", source: "db" }],
        findings: [expect.objectContaining({ ruleRef: "NO-ENV", filePath: "prod.env" })],
      }),
    );
  });

  it("surfaces oversize files a content rule could not scan", async () => {
    await fs.writeFile(path.join(root, "huge.log"), "x".repeat(MAX_SCAN_BYTES + 1));
    const client = stubClient();
    client.resolveRuleset = vi.fn(async () => ({
      rules: [{ ruleRef: "NO-TODO", title: "No TODO", severity: "low", check: { kind: "regex", pattern: "TODO" } }],
    }));
    const tool = createGovernanceAuditTool({ workspaceDir: root, client });
    const payload = details(await tool!.execute("call-3", { dryRun: true }));
    expect(payload.skippedFiles).toEqual(["huge.log"]);
    expect(payload.summary).toMatchObject({ skipped: 1 });
  });

  it("dryRun resolves and pre-filters without recording a run", async () => {
    const client = stubClient();
    const tool = createGovernanceAuditTool({ workspaceDir: root, client });
    const result = await tool!.execute("call-2", { dryRun: "true" });
    expect(details(result)).toMatchObject({ dryRun: true, gateResult: "blocked" });
    expect(client.startAudit).not.toHaveBeenCalled();
    expect(client.finalizeAudit).not.toHaveBeenCalled();
  });
});

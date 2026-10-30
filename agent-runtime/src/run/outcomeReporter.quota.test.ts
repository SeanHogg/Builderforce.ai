/**
 * An on-prem run that dies on one of OUR gateway's TENANT budget codes reports `quotaExhausted` (classified once,
 * in the agent's outcome row, by the shared taxonomy; this reporter only forwards it) and so is never folded into
 * routing: the customer used their allowance, no model failed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelTransport, RunOutcomeRow } from "@builderforce/agent-run";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import { TENANT_BUDGET_CODES, foldsIntoRouting } from "@builderforce/learned-routing";
import { buildRunRowReport } from "./outcomeReporter.js";
import { runOnPremAgent } from "./onPremAdapter.js";

const READ: ModelCompletion = { content: "", toolCalls: [{ id: "r1", name: "read_file", arguments: '{"path":"a.ts"}' }], model: "fake-model" };

const workspace: CapabilityProvider = {
  capabilities: new Set(["repo.read"]),
  repoRead: {
    listFiles: async () => ({ ok: true, paths: [] }),
    readFile: async (p: string) => ({ ok: true, path: p, content: "x" }),
    searchCode: async (query: string) => ({ ok: true, query, total: 0, matches: [] }),
  },
};

/** A model that answers one turn (so the row names a model), then dies with `message`. */
function dyingAfterOneTurn(message: string): ModelTransport {
  let n = 0;
  return { complete: async () => { if (n++ === 0) return READ; throw new Error(message); } };
}

async function reportFor(message: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "onprem-quota-"));
  try {
    const rows: RunOutcomeRow[] = [];
    await runOnPremAgent(
      { prompt: "read a.ts", cwd: dir, anthropicBaseUrl: "https://gw/llm", gatewayAuthKey: "k", transport: dyingAfterOneTurn(message), capabilities: workspace },
      { onAssistantText: vi.fn(), onToolUse: vi.fn(), onResult: vi.fn(), onOutcome: (row: RunOutcomeRow) => void rows.push(row) },
    );
    return buildRunRowReport(rows[0]!);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("an on-prem run that dies on a tenant budget code", () => {
  it.each(TENANT_BUDGET_CODES)("%s reports quotaExhausted, is not a rate limit, and does not fold into routing", async (code) => {
    const report = await reportFor(`chat completion failed with HTTP 429: {"code":"${code}","terminal":true}`);

    expect(report).toMatchObject({ terminalStatus: "failed", quotaExhausted: true });
    expect(report).not.toHaveProperty("rateLimited");
    expect(foldsIntoRouting({ source: report!.source, terminalStatus: report!.terminalStatus, quotaExhausted: report!.quotaExhausted })).toBe(false);
  });

  it("a provider throttle is availability, not quota, and still folds", async () => {
    const report = await reportFor("chat completion failed with HTTP 429: Too many requests");

    expect(report).toMatchObject({ terminalStatus: "failed", rateLimited: true });
    expect(report).not.toHaveProperty("quotaExhausted");
    expect(foldsIntoRouting({ source: report!.source, terminalStatus: report!.terminalStatus })).toBe(true);
  });
});

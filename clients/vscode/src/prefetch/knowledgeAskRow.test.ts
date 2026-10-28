import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { defineRegistry, runGate, type PrefetchPort } from "@builderforce/prefetch";
import { OPEN_IN_GRAPH_LABEL_KEY, OPEN_KNOWLEDGE_GRAPH_COMMAND } from "@builderforce/agent-tools/prefetch";
import { configureHostKnowledgeIndex, workspaceKnowledgeIndex } from "../knowledge/index/hostKnowledgeIndex";
import { KNOWLEDGE_ASK_ROWS, knowledgeAskExecutors } from "./knowledgeAskRow";
import { knowledgeRootId } from "../knowledge/knowledgeRoots";
import { VSCODE_PREFETCH_REGISTRY } from "./executors";

const ROOT = path.resolve("/tmp/kx-ask-repo");
const fn = (name: string) => ({ name, kind: "function" as const, line: 1, exported: true });

async function seeded(): Promise<void> {
  configureHostKnowledgeIndex({
    workspaceRoots: () => [ROOT],
    idle: () => undefined,
    embedder: async () => undefined,
    symbolFiles: async () => [
      { path: "src/billing/invoice.ts", symbols: [fn("createInvoice")] },
      { path: "src/billing/stripeWebhook.ts", symbols: [fn("handleStripeWebhook")] },
      { path: "src/net/retryPolicy.ts", symbols: [fn("retryPolicy")] },
    ],
  });
  const index = workspaceKnowledgeIndex(ROOT);
  await index.search("warm up");
  for (let i = 0; i < 100 && (await index.size()) === 0; i++) await new Promise((r) => setTimeout(r, 5));
}

const port = (): PrefetchPort => ({
  registry: defineRegistry([...KNOWLEDGE_ASK_ROWS]),
  executors: knowledgeAskExecutors(() => ROOT),
  ports: { surface: "vscode" },
});

afterEach(() => configureHostKnowledgeIndex({ workspaceRoots: () => [] }));

describe("knowledge.ask in the editor's gate", () => {
  it("is in the editor's registry", () => {
    expect(VSCODE_PREFETCH_REGISTRY.some((a) => a.id === "knowledge.ask")).toBe(true);
  });

  it("an exact hit settles the turn with no model, with the Open-in-graph chip", async () => {
    await seeded();
    const adopt = vi.fn(async () => true);
    const pass = await runGate("which file owns retryPolicy?", port(), { adopt });
    expect(pass?.settled).toBe("answer");
    expect(pass?.answer?.result.text).toContain("`src/net/retryPolicy.ts`");
    expect(pass?.answer?.result.chips?.[0]).toMatchObject({ labelKey: OPEN_IN_GRAPH_LABEL_KEY, command: OPEN_KNOWLEDGE_GRAPH_COMMAND });
    expect((pass?.answer?.result.chips?.[0]?.args as { focus: string[] }).focus).toContain(`src:${knowledgeRootId(ROOT)}::src/net/retryPolicy.ts`);
  });

  it("an ambiguous question falls back to PREFETCH: the hits ride into the turn, nothing is adopted", async () => {
    await seeded();
    const adopt = vi.fn(async () => true);
    const pass = await runGate("where is billing handled", port(), { adopt });
    expect(adopt).not.toHaveBeenCalled();
    expect(pass?.settled).toBe("prefetch");
    expect(pass?.tail[0]).toContain("## Knowledge index");
    expect(pass?.tail[0]).toContain("src/billing/");
  });
});

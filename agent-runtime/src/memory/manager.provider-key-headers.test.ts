import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";
import { hasNodeSqliteSupport } from "./test-sqlite-support.js";

vi.mock("./sqlite-vec.js", () => ({
  loadSqliteVecExtension: async () => ({ ok: false, error: "sqlite-vec disabled in tests" }),
}));

// A provider id the manager has no dedicated client for ("voyage"/"local"-style),
// so computeProviderKey takes the generic branch that folds in the header fingerprint.
vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async () => ({
    requestedProvider: "voyage",
    provider: {
      id: "voyage",
      model: "mock-embed",
      embedQuery: async () => [1, 0],
      embedBatch: async (texts: string[]) => texts.map(() => [1, 0]),
    },
  }),
}));

const describeIfSqlite = hasNodeSqliteSupport ? describe : describe.skip;

describeIfSqlite("memory provider key header fingerprint", () => {
  const managers: MemoryIndexManager[] = [];
  let workspaceDir = "";

  afterEach(async () => {
    for (const manager of managers.splice(0)) {
      await manager.close();
    }
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      workspaceDir = "";
    }
  });

  async function openManager(
    label: string,
    headers?: Record<string, string>,
  ): Promise<string> {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "voyage",
            model: "mock-embed",
            remote: { baseUrl: "https://embed.test", ...(headers ? { headers } : {}) },
            store: {
              path: path.join(workspaceDir, `${label}.sqlite`),
              vector: { enabled: false },
            },
            sync: { watch: false, onSessionStart: false, onSearch: false },
            query: { minScore: 0, hybrid: { enabled: false } },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } as BuilderForceAgentsConfig;
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    if (!result.manager) {
      throw new Error(`manager missing (${label})`);
    }
    const manager = result.manager as unknown as MemoryIndexManager;
    managers.push(manager);
    return (manager as unknown as { providerKey: string }).providerKey;
  }

  it("changes the provider key when the configured header set changes, not on case/order", async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-memory-pkey-"));

    const bare = await openManager("bare");
    const withRouting = await openManager("routing", { "X-Deployment": "blue" });
    const sameNamesDifferentCaseAndValue = await openManager("routing2", {
      "x-deployment": "green",
    });
    const extraHeader = await openManager("extra", {
      "X-Deployment": "blue",
      "api-version": "2025-01-01",
    });

    // Adding a routing header invalidates the index (full reindex on next sync).
    expect(withRouting).not.toBe(bare);
    expect(extraHeader).not.toBe(withRouting);
    // Header NAMES drive the key: a value change or case difference does not.
    expect(sameNamesDifferentCaseAndValue).toBe(withRouting);
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";
import { getDefaultMemoryDirs } from "./internal.js";
import { createOpenAIEmbeddingProviderMock } from "./test-embeddings-mock.js";
import { hasNodeSqliteSupport } from "./test-sqlite-support.js";

const embedBatch = vi.fn(async () => []);
const embedQuery = vi.fn(async () => [0.2, 0.2, 0.2]);

vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async () =>
    createOpenAIEmbeddingProviderMock({
      embedQuery,
      embedBatch,
    }),
}));

const describeIfSqlite = hasNodeSqliteSupport ? describe : describe.skip;

describeIfSqlite("memory search async sync", () => {
  let workspaceDir: string;
  let indexPath: string;
  let manager: MemoryIndexManager | null = null;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-mem-async-"));
    indexPath = path.join(workspaceDir, "index.sqlite");
    const memDir = getDefaultMemoryDirs(workspaceDir)[1];
    await fs.mkdir(memDir, { recursive: true });
    await fs.writeFile(path.join(memDir, "2026-01-07.md"), "hello\n");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (manager) {
      await manager.close();
      manager = null;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("does not await sync when searching", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "text-embedding-3-small",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: { minScore: 0 },
            remote: { batch: { enabled: true, wait: true } },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } as BuilderForceAgentsConfig;

    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    manager = result.manager as unknown as MemoryIndexManager;

    const pending = new Promise<void>(() => {});
    const syncMock = vi.fn(async () => pending);
    (manager as unknown as { sync: () => Promise<void> }).sync = syncMock;

    const activeManager = manager;
    if (!activeManager) {
      throw new Error("manager missing");
    }
    await activeManager.search("hello");
    expect(syncMock).toHaveBeenCalledTimes(1);
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";
import { getDefaultMemoryWatchPatterns, getDefaultMemoryDirs } from "./internal.js";
import { hasNodeSqliteSupport } from "./test-sqlite-support.js";

const { watchMock } = vi.hoisted(() => ({
  watchMock: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(async () => undefined),
  })),
}));

vi.mock("chokidar", () => ({
  default: { watch: watchMock },
  watch: watchMock,
}));

vi.mock("./sqlite-vec.js", () => ({
  loadSqliteVecExtension: async () => ({ ok: false, error: "sqlite-vec disabled in tests" }),
}));

vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async () => ({
    requestedProvider: "openai",
    provider: {
      id: "mock",
      model: "mock-embed",
      embedQuery: async () => [1, 0],
      embedBatch: async (texts: string[]) => texts.map(() => [1, 0]),
    },
  }),
}));

const describeIfSqlite = hasNodeSqliteSupport ? describe : describe.skip;

describeIfSqlite("memory watcher config", () => {
  let manager: MemoryIndexManager | null = null;
  let workspaceDir = "";
  let extraDir = "";

  afterEach(async () => {
    watchMock.mockClear();
    if (manager) {
      await manager.close();
      manager = null;
    }
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      workspaceDir = "";
      extraDir = "";
    }
  });

  it("watches markdown globs and ignores dependency directories", async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-memory-watch-"));
    extraDir = path.join(workspaceDir, "extra");
    // make sure the canonical memory dir exists
    await fs.mkdir(getDefaultMemoryDirs(workspaceDir)[1], { recursive: true });
    await fs.mkdir(extraDir, { recursive: true });
    await fs.writeFile(path.join(extraDir, "notes.md"), "hello");

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: path.join(workspaceDir, "index.sqlite"), vector: { enabled: false } },
            sync: { watch: true, watchDebounceMs: 25, onSessionStart: false, onSearch: false },
            query: { minScore: 0, hybrid: { enabled: false } },
            extraPaths: [extraDir],
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

    expect(watchMock).toHaveBeenCalledTimes(1);
    const [watchedPaths, options] = watchMock.mock.calls[0] as unknown as [
      string[],
      Record<string, unknown>,
    ];
    const defaultPatterns = getDefaultMemoryWatchPatterns(workspaceDir);
    expect(watchedPaths).toEqual(
      expect.arrayContaining([...defaultPatterns, path.join(extraDir, "**", "*.md")]),
    );
    expect(options.ignoreInitial).toBe(true);
    expect(options.awaitWriteFinish).toEqual({ stabilityThreshold: 25, pollInterval: 100 });

    const ignored = options.ignored as ((watchPath: string) => boolean) | undefined;
    expect(ignored).toBeTypeOf("function");
    // canonical directory should also be ignored for dependency paths
    const canon = path.join(workspaceDir, ".builderforce", "memory");
    expect(ignored?.(path.join(canon, "node_modules", "pkg", "index.md"))).toBe(true);
    expect(ignored?.(path.join(canon, ".venv", "lib", "python.md"))).toBe(true);
    expect(ignored?.(path.join(canon, "project", "notes.md"))).toBe(false);
  });
});

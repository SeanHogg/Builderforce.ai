import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BuilderForceAgentsConfig } from "../../config/config.js";

let backend: "builtin" | "qmd" = "builtin";
let searchImpl: () => Promise<unknown[]> = async () => [
  {
    path: "MEMORY.md",
    startLine: 5,
    endLine: 7,
    score: 0.9,
    snippet: "@@ -5,3 @@\nAssistant: noted",
    source: "memory" as const,
  },
];
let readFileImpl: () => Promise<{ text: string; path: string }> = async () => ({ text: "", path: "" });

const stubManager = {
  search: vi.fn(async () => await searchImpl()),
  readFile: vi.fn(async () => await readFileImpl()),
  status: () => ({
    backend,
    files: 1,
    chunks: 1,
    dirty: false,
    workspaceDir: "/workspace",
    dbPath: "/workspace/.memory/index.sqlite",
    provider: "builtin",
    model: "builtin",
    requestedProvider: "builtin",
    sources: ["memory" as const],
    sourceCounts: [{ source: "memory" as const, files: 1, chunks: 1 }],
  }),
  sync: vi.fn(),
  probeVectorAvailability: vi.fn(async () => true),
  close: vi.fn(),
};

vi.mock("../../memory/index.js", () => {
  return {
    getMemorySearchManager: async () => ({ manager: stubManager }),
  };
});

import { createMemoryGetTool, createMemorySearchTool } from "./memory-tool.js";

function asBuilderForceAgentsConfig(config: Partial<BuilderForceAgentsConfig>): BuilderForceAgentsConfig {
  return config as BuilderForceAgentsConfig;
}

beforeEach(() => {
  backend = "builtin";
  searchImpl = async () => [
    {
      path: "MEMORY.md",
      startLine: 5,
      endLine: 7,
      score: 0.9,
      snippet: "@@ -5,3 @@\nAssistant: noted",
      source: "memory" as const,
    },
  ];
  readFileImpl = async () => ({ text: "", path: "" });
  vi.clearAllMocks();
});

describe("memory search citations", () => {
  it("appends source information when citations are enabled", async () => {
    backend = "builtin";
    const cfg = asBuilderForceAgentsConfig({
      memory: { citations: "on" },
      agents: { list: [{ id: "main", default: true }] },
    });
    const tool = createMemorySearchTool({ config: cfg });
    if (!tool) {
      throw new Error("tool missing");
    }
    const result = await tool.execute("call_citations_on", { query: "notes" });
    const details = result.details as { results: Array<{ snippet: string; citation?: string }> };
    expect(details.results[0]?.snippet).toMatch(/Source: MEMORY.md#L5-L7/);
    expect(details.results[0]?.citation).toBe("MEMORY.md#L5-L7");
  });

  it("leaves snippet untouched when citations are off", async () => {
    backend = "builtin";
    const cfg = asBuilderForceAgentsConfig({
      memory: { citations: "off" },
      agents: { list: [{ id: "main", default: true }] },
    });
    const tool = createMemorySearchTool({ config: cfg });
    if (!tool) {
      throw new Error("tool missing");
    }
    const result = await tool.execute("call_citations_off", { query: "notes" });
    const details = result.details as { results: Array<{ snippet: string; citation?: string }> };
    expect(details.results[0]?.snippet).not.toMatch(/Source:/);
    expect(details.results[0]?.citation).toBeUndefined();
  });

  it("clamps decorated snippets to qmd injected budget", async () => {
    backend = "qmd";
    const cfg = asBuilderForceAgentsConfig({
      memory: { citations: "on", backend: "qmd", qmd: { limits: { maxInjectedChars: 20 } } },
      agents: { list: [{ id: "main", default: true }] },
    });
    const tool = createMemorySearchTool({ config: cfg });
    if (!tool) {
      throw new Error("tool missing");
    }
    const result = await tool.execute("call_citations_qmd", { query: "notes" });
    const details = result.details as { results: Array<{ snippet: string; citation?: string }> };
    expect(details.results[0]?.snippet.length).toBeLessThanOrEqual(20);
  });

  it("honors auto mode for direct chats", async () => {
    backend = "builtin";
    const cfg = asBuilderForceAgentsConfig({
      memory: { citations: "auto" },
      agents: { list: [{ id: "main", default: true }] },
    });
    const tool = createMemorySearchTool({
      config: cfg,
      agentSessionKey: "agent:main:discord:dm:u123",
    });
    if (!tool) {
      throw new Error("tool missing");
    }
    const result = await tool.execute("auto_mode_direct", { query: "notes" });
    const details = result.details as { results: Array<{ snippet: string }> };
    expect(details.results[0]?.snippet).toMatch(/Source:/);
  });

  it("suppresses citations for auto mode in group chats", async () => {
    backend = "builtin";
    const cfg = asBuilderForceAgentsConfig({
      memory: { citations: "auto" },
      agents: { list: [{ id: "main", default: true }] },
    });
    const tool = createMemorySearchTool({
      config: cfg,
      agentSessionKey: "agent:main:discord:group:c123",
    });
    if (!tool) {
      throw new Error("tool missing");
    }
    const result = await tool.execute("auto_mode_group", { query: "notes" });
    const details = result.details as { results: Array<{ snippet: string }> };
    expect(details.results[0]?.snippet).not.toMatch(/Source:/);
  });
});

describe("memory tools", () => {
  it("advertises workspace names and preserves saved paths, line ranges, and result envelopes", async () => {
    const cfg = { agents: { list: [{ id: "main", default: true }] } };
    const options = { config: cfg, workspaceReferences: true };
    const search = createMemorySearchTool(options);
    const read = createMemoryGetTool(options)!;
    expect(search).toMatchObject({ name: "memory_search", wireName: "workspace__memory_search", idempotent: true });
    expect(read).toMatchObject({ name: "memory_get", wireName: "workspace__memory_read", idempotent: true });

    const hit = { path: "memory/notes.md", text: "A note\nAnother note" };
    readFileImpl = async () => hit;
    const result = await read.execute("saved_call", { path: " memory/notes.md ", from: "8.7", lines: "2.9" });
    expect(stubManager.readFile).toHaveBeenCalledWith({ relPath: "memory/notes.md", from: 8, lines: 2 });
    expect(result.details).toEqual(hit);
    await expect(read.execute("fact_key", { key: "recall-by-key" })).rejects.toThrow("path required");
  });

  it("issues stable opaque references and reads only their recorded range in the same scope", async () => {
    const config = { agents: { list: [{ id: "main", default: true }] } };
    const options = { config, agentSessionKey: "agent:main:discord:dm:u123", workspaceReferences: true };
    const search = createMemorySearchTool(options)!;
    const read = createMemoryGetTool(options)!;
    const otherScope = createMemoryGetTool({ ...options, agentSessionKey: "agent:main:discord:dm:u456" })!;
    expect(read.wireParameters).toMatchObject({ properties: { ref: { type: "string" } }, required: ["ref"] });
    expect(read.wireParameters?.properties).not.toHaveProperty("path");

    const first = (await search.execute("search", { query: "notes" })).details as {
      results: Array<{ ref: string; path: string; startLine: number; endLine: number; citation?: string }>;
    };
    const hit = first.results[0]!;
    expect(hit.ref).toMatch(/^wm_[A-Za-z0-9_-]+$/);
    expect(hit).toMatchObject({ path: "MEMORY.md", startLine: 5, endLine: 7, citation: "MEMORY.md#L5-L7" });
    expect((await search.execute("again", { query: "notes again" })).details).toEqual(first);

    const excerpt = { path: "MEMORY.md", text: "Scoped note" };
    readFileImpl = async () => excerpt;
    expect((await read.execute("read", { ref: hit.ref, path: "other.md", from: 1, lines: 99 })).details).toEqual(excerpt);
    expect(stubManager.readFile).toHaveBeenCalledExactlyOnceWith({ relPath: "MEMORY.md", from: 5, lines: 3 });

    for (const [tool, ref] of [[read, `${hit.ref}x`], [otherScope, hit.ref]] as const) {
      const outcome = await tool.execute("refused", { ref });
      expect(outcome.details).toMatchObject({ disabled: true, error: expect.stringContaining("Unknown workspace memory reference") });
    }
    expect(stubManager.readFile).toHaveBeenCalledOnce();
  });

  it("omits both tools when workspace memory is disabled", () => {
    const config = asBuilderForceAgentsConfig({ agents: { defaults: { memorySearch: { enabled: false } } } });
    expect(createMemorySearchTool({ config })).toBeNull();
    expect(createMemoryGetTool({ config })).toBeNull();
  });

  it("does not throw when memory_search fails (e.g. embeddings 429)", async () => {
    searchImpl = async () => {
      throw new Error("openai embeddings failed: 429 insufficient_quota");
    };

    const cfg = { agents: { list: [{ id: "main", default: true }] } };
    const tool = createMemorySearchTool({ config: cfg });
    expect(tool).not.toBeNull();
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("call_1", { query: "hello" });
    expect(result.details).toEqual({
      results: [],
      disabled: true,
      error: "openai embeddings failed: 429 insufficient_quota",
    });
  });

  it("does not throw when memory_get fails", async () => {
    readFileImpl = async () => {
      throw new Error("path required");
    };

    const cfg = { agents: { list: [{ id: "main", default: true }] } };
    const tool = createMemoryGetTool({ config: cfg });
    expect(tool).not.toBeNull();
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("call_2", { path: "memory/NOPE.md" });
    expect(result.details).toEqual({
      path: "memory/NOPE.md",
      text: "",
      disabled: true,
      error: "path required",
    });
  });
});

/**
 * The review's port assembly: a plan waits only for what planning uses (source, manifest, layers),
 * never for the run-only ports (judge, index, symbols, history); the compare count follows whether a
 * judge is CONFIGURED; a run still gets ports that arrive after the plan, fails when a port fails,
 * and drops (logged by name) only a port that never answers within its cap.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  never: <T>() => new Promise<T>(() => undefined),
  judgeConfigured: true,
  editorJudgement: undefined as unknown as () => Promise<unknown>,
  symbols: undefined as unknown as () => Promise<unknown>,
  index: undefined as unknown as () => Promise<unknown>,
  planSpy: vi.fn(),
}));

vi.mock("vscode", () => ({ workspace: {}, window: {}, l10n: { t: (m: string) => m } }));
vi.mock("../localCapabilities", () => ({ buildLocalCapabilityProvider: () => ({}) }));
vi.mock("../workspaceSymbols", () => ({ workspaceSymbolIndex: () => ({ filesUnder: () => h.symbols() }) }));
vi.mock("./index/hostKnowledgeIndex", () => ({ getHostKnowledgeIndex: () => h.index() }));
vi.mock("./knowledgeFs", () => ({ vscodeKnowledgeFs: () => ({}) }));
vi.mock("./knowledgeReplica", () => ({ replicaQueueFor: () => ({}) }));
vi.mock("./knowledgeJudgement", () => ({
  editorJudgement: () => h.editorJudgement(),
  judgeConfigured: async () => h.judgeConfigured,
}));
vi.mock("@builderforce/agent-tools/prefetch", () => ({ readPartitions: async () => undefined }));
vi.mock("@builderforce/agent-tools/node-git-history", () => ({ gitHistoryPort: async () => undefined }));
vi.mock("@builderforce/repo-map", () => ({ repoMapPort: {} }));
vi.mock("@builderforce/agent-tools/knowledge", async (importOriginal) => {
  const original = await importOriginal<typeof import("@builderforce/agent-tools/knowledge")>();
  return {
    ...original,
    workspaceCodeAnalyzers: () => ({ analyse: async () => [] }),
    planKnowledgeReviewDetail: (...args: Parameters<typeof original.planKnowledgeReviewDetail>) => {
      h.planSpy(...args);
      return original.planKnowledgeReviewDetail(...args);
    },
  };
});

import { InMemoryIngestManifest } from "@seanhogg/builderforce-memory/ingest";
import type { KnowledgeFiles } from "./knowledgeStores";
import { PLAN_STEP_MS, RUN_STEP_MS, reviewPortsFor } from "./reviewPortsFor";
import type { OpenRoot } from "./knowledgeService";

const files: KnowledgeFiles = { read: async () => undefined, write: async () => undefined } as unknown as KnowledgeFiles;
const recorder = { edges: vi.fn(), signals: vi.fn() } as never;

function openRoot(): OpenRoot {
  const fixture = ["a.ts", "b.ts"];
  return {
    root: { rootId: "r1", rootPath: "/w", folderPath: "/w", rel: "", title: "w" },
    source: {
      rootId: "r1",
      title: "w",
      skippedFolders: () => [],
      async *list() { for (const p of fixture) yield { path: p, hash: `h:${p}`, size: 3 }; },
      read: async (p: string) => ({ id: p, tenantId: "r1", title: p, content: { kind: "text", text: "x", mediaType: "text/typescript" } }),
    },
    store: {},
    manifest: new InMemoryIngestManifest(),
    files,
  } as unknown as OpenRoot;
}

beforeEach(() => {
  h.judgeConfigured = true;
  h.editorJudgement = () => h.never();
  h.symbols = () => h.never();
  h.index = () => h.never();
  h.planSpy.mockClear();
});

describe("reviewPortsFor.plan", () => {
  it("resolves while the judge, the index, the symbols never settle, and logs one plan line", async () => {
    const log = vi.fn();
    const planned = await reviewPortsFor({ secrets: {} as never, open: openRoot(), recorder, log }).plan({ force: false });
    expect(planned.files.length).toBe(2);
    const lines = log.mock.calls.filter(([what]) => what === "plan").map(([, text]) => String(text));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/2 files walked in \d+ms, ports \d+ms, manifest\+diff \d+ms, total \d+ms/);
  });

  it("counts compare calls when a judge is configured but has not started, and not when none is", async () => {
    await reviewPortsFor({ secrets: {} as never, open: openRoot(), recorder, log: vi.fn() }).plan({ force: false });
    expect(h.planSpy.mock.calls[0]![1]).toMatchObject({ compare: true });
    h.judgeConfigured = false;
    await reviewPortsFor({ secrets: {} as never, open: openRoot(), recorder, log: vi.fn() }).plan({ force: false });
    expect(h.planSpy.mock.calls[1]![1]).toMatchObject({ compare: false });
  });

  it("keeps the plan's bounds tight and the run's cap generous", () => {
    expect(PLAN_STEP_MS).toBeLessThan(RUN_STEP_MS);
    expect(RUN_STEP_MS).toBeGreaterThanOrEqual(120_000);
  });
});

describe("reviewPortsFor.full", () => {
  it("gives the run a judge that arrives after the plan", async () => {
    let arrive!: (judge: unknown) => void;
    const judge = { modelsUsed: () => [] };
    h.editorJudgement = () => new Promise((resolve) => { arrive = resolve; });
    h.symbols = async () => [];
    h.index = async () => undefined;
    const ports = reviewPortsFor({ secrets: {} as never, open: openRoot(), recorder, log: vi.fn() });
    await ports.plan({ force: false }); // resolved with the judge still starting
    const run = ports.full();
    arrive(judge);
    expect((await run).judgement).toBe(judge);
    expect(ports.degraded()).toEqual([]);
  });

  it("drops a port that never answers within its cap, logging its name and elapsed ms", async () => {
    const log = vi.fn();
    const ports = reviewPortsFor({ secrets: {} as never, open: openRoot(), recorder, log, runMs: 25 });
    const full = await ports.full();
    expect(full.judgement).toBeUndefined();
    expect(full.similar).toBeUndefined();
    expect(ports.degraded()).toEqual(expect.arrayContaining(["judgement", "index", "symbols"]));
    const judgeLog = log.mock.calls.find(([what]) => what === "judgement");
    expect(String(judgeLog![1])).toMatch(/no answer after \d+ms/);
  });

  it("fails the run when the judgement port fails, as it always did", async () => {
    h.editorJudgement = async () => { throw new Error("no model"); };
    const ports = reviewPortsFor({ secrets: {} as never, open: openRoot(), recorder, log: vi.fn(), runMs: 25 });
    await expect(ports.full()).rejects.toThrow("no model");
  });

  it("does not raise an unhandled rejection when a dropped port rejects late", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    let fail!: (e: Error) => void;
    h.editorJudgement = () => new Promise((_, reject) => { fail = reject; });
    const ports = reviewPortsFor({ secrets: {} as never, open: openRoot(), recorder, log: vi.fn(), runMs: 20 });
    await ports.full();
    fail(new Error("late"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

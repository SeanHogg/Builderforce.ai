import { describe, it, expect } from "vitest";
import { buildWorkspaceFacts, subprojectFactKey, WORKSPACE_OVERVIEW_KEY, type IndexedFile } from "./workspaceFacts";

const file = (path: string, exported: string[] = []): IndexedFile => ({
  path,
  symbols: exported.map((name, i) => ({ name, kind: "function" as const, line: i + 1, exported: true })),
});

describe("buildWorkspaceFacts", () => {
  const files: IndexedFile[] = [
    file("api/src/application/llm/builtinMcpService.ts", ["buildBuiltinTools", "loadTaskProgress", "compactTask"]),
    file("api/src/presentation/routes/taskRoutes.ts", ["createTaskRoutes"]),
    file("api/src/domain/task/Task.ts", ["Task"]),
    file("api/container/server.ts", ["startContainer"]),
    file("api/container/run.ts"),
    file("api/container/tools.ts"),
    file("frontend/src/app/page.tsx", ["default"]),
    file("scripts/one.ts"),
  ];
  const digest = {
    manifests: ["api/package.json", "api/container/package.json", "frontend/package.json", "scripts/package.json"],
    overview: "A monorepo: api (Hono worker) and frontend (Next.js).",
    packages: { api: { name: "builderforce-api", description: "The Worker API" } },
  };

  it("writes one overview and one fact per significant sub-project", () => {
    const facts = buildWorkspaceFacts(digest, files);
    expect(facts[0].key).toBe(WORKSPACE_OVERVIEW_KEY);
    expect(facts[0].content).toContain("A monorepo");
    // frontend (1 file) and scripts (1 file) are below the size floor.
    expect(facts.map((f) => f.key).slice(1).sort()).toEqual([subprojectFactKey("api"), subprojectFactKey("api/container")].sort());
  });

  it("gives each file to its NEAREST sub-project, and names key modules with their exports", () => {
    const api = buildWorkspaceFacts(digest, files).find((f) => f.key === subprojectFactKey("api"))!;
    expect(api.content).toContain('package "builderforce-api" — The Worker API');
    expect(api.content).toContain("3 indexed source file(s)");
    expect(api.content).not.toContain("container/server.ts");
    expect(api.content).toContain("api/src/application/llm/builtinMcpService.ts — buildBuiltinTools, loadTaskProgress, compactTask");
    expect(api.content).toContain("find_symbol");
  });

  it("keys the workspace root readably", () => {
    expect(subprojectFactKey(".")).toBe("workspace:subproject:(root)");
  });

  it("keeps every fact within the store's useful size", () => {
    const big = Array.from({ length: 300 }, (_, i) => file(`api/src/m${i}.ts`, Array.from({ length: 30 }, (_, j) => `sym${i}_${j}`)));
    for (const fact of buildWorkspaceFacts(digest, big)) expect(fact.content.length).toBeLessThanOrEqual(3_000);
  });
});

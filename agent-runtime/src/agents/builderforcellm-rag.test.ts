import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { retrieveRelevantContext } from "./builderforcellm-rag.js";

describe("retrieveRelevantContext", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-rag-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("returns empty string when workspace has no source files", async () => {
    const result = await retrieveRelevantContext({ query: "useEffect", workspaceDir: tmpDir });
    expect(result).toBe("");
  });

  it("returns empty string when query tokens are empty (punctuation-only query)", async () => {
    await fs.writeFile(path.join(tmpDir, "index.ts"), "export const x = 1;", "utf-8");
    const result = await retrieveRelevantContext({ query: "!!! ---", workspaceDir: tmpDir });
    expect(result).toBe("");
  });

  it("returns empty string when no files match the query tokens", async () => {
    await fs.writeFile(path.join(tmpDir, "foo.ts"), "export const y = 2;", "utf-8");
    const result = await retrieveRelevantContext({
      query: "neverMatchesXYZ123",
      workspaceDir: tmpDir,
    });
    expect(result).toBe("");
  });

  it("returns context block when a file matches the query", async () => {
    await fs.writeFile(
      path.join(tmpDir, "auth.ts"),
      "export function authenticate(token: string) { return token; }",
      "utf-8",
    );
    const result = await retrieveRelevantContext({
      query: "authenticate token",
      workspaceDir: tmpDir,
    });
    expect(result).toContain("## Relevant codebase context");
    expect(result).toContain("auth.ts");
    expect(result).toContain("authenticate");
  });

  it("ranks the most relevant file first (higher keyword overlap = higher score)", async () => {
    // high-score.ts has 3 query tokens; low-score.ts has only 1
    await fs.writeFile(
      path.join(tmpDir, "high-score.ts"),
      "export function fetchUserData(userId: string) { return userId; }",
      "utf-8",
    );
    await fs.writeFile(
      path.join(tmpDir, "low-score.ts"),
      "export const version = fetchUserData;",
      "utf-8",
    );
    const result = await retrieveRelevantContext({
      query: "fetchUserData userId string",
      workspaceDir: tmpDir,
    });
    // high-score.ts should appear before low-score.ts
    const highPos = result.indexOf("high-score.ts");
    const lowPos = result.indexOf("low-score.ts");
    expect(highPos).toBeGreaterThanOrEqual(0);
    expect(highPos).toBeLessThan(lowPos);
  });

  it("limits results to topK files", async () => {
    // Create 5 files that all match the query
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(
        path.join(tmpDir, `file${i}.ts`),
        `export const handler${i} = "handleRequest";`,
        "utf-8",
      );
    }
    const result = await retrieveRelevantContext({
      query: "handleRequest handler",
      workspaceDir: tmpDir,
      topK: 2,
    });
    // Only 2 file headings should appear
    const headingMatches = result.match(/^### /gm);
    expect(headingMatches).toHaveLength(2);
  });

  it("respects maxExcerptChars and truncates long files", async () => {
    const longContent = "const x = 1; // keyword ".repeat(300); // ~7200 chars
    await fs.writeFile(path.join(tmpDir, "big.ts"), longContent, "utf-8");
    const result = await retrieveRelevantContext({
      query: "keyword",
      workspaceDir: tmpDir,
      maxExcerptChars: 100,
    });
    // The excerpt should be truncated with an ellipsis marker
    expect(result).toContain("…");
    // The excerpt after the heading should be much shorter than the full file
    const excerptStart = result.indexOf("### big.ts\n") + "### big.ts\n".length;
    const excerptText = result.slice(excerptStart).split("\n\n")[0];
    expect(excerptText.length).toBeLessThanOrEqual(110); // 100 + "…"
  });

  it("skips node_modules and build directories", async () => {
    const nodeModDir = path.join(tmpDir, "node_modules");
    await fs.mkdir(nodeModDir, { recursive: true });
    await fs.writeFile(
      path.join(nodeModDir, "dep.ts"),
      "export const dep = 'dependency';",
      "utf-8",
    );

    const buildDir = path.join(tmpDir, "build");
    await fs.mkdir(buildDir, { recursive: true });
    await fs.writeFile(path.join(buildDir, "out.ts"), "export const dep = 'built';", "utf-8");

    const result = await retrieveRelevantContext({ query: "dep dependency", workspaceDir: tmpDir });
    // Should return empty — no source files outside skipped dirs
    expect(result).toBe("");
  });

  it("scans TypeScript, JavaScript, and Markdown files", async () => {
    await fs.writeFile(path.join(tmpDir, "notes.md"), "# planningDoc: how to plan", "utf-8");
    await fs.writeFile(path.join(tmpDir, "util.js"), "function planningDoc() {}", "utf-8");
    await fs.writeFile(path.join(tmpDir, "types.ts"), "type PlanningDoc = string;", "utf-8");

    const result = await retrieveRelevantContext({
      query: "planningDoc plan",
      workspaceDir: tmpDir,
    });
    expect(result).toContain("## Relevant codebase context");
    // All three files should be scored (we asked for topK=3 by default)
    const matchedCount = ["notes.md", "util.js", "types.ts"].filter((f) =>
      result.includes(f),
    ).length;
    expect(matchedCount).toBeGreaterThanOrEqual(2);
  });
});

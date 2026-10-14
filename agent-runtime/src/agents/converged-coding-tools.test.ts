import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDesktopFetchForTests } from "@builderforce/agent-tools/node-desktop.js";
import {
  buildConvergedFileTools,
  catalogConvergedFileTools,
  CONVERGED_TOOL_NAMES,
} from "./converged-coding-tools.js";

/** The model reads the first text block of an AgentToolResult (JSON-stringified `data`). */
async function runTool(
  tools: ReturnType<typeof buildConvergedFileTools>,
  name: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`tool '${name}' not built`);
  }
  const result = await tool.execute("call-1", params, undefined as unknown as AbortSignal);
  const text = result.content.find((b) => b.type === "text");
  return JSON.parse((text as { text: string }).text);
}

describe("buildConvergedFileTools", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bf-converged-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("exposes write_file/edit_file under the NATIVE names write/edit, plus additive delete_file/list_files/ask_human", () => {
    const tools = buildConvergedFileTools({ workspaceRoot: root });
    const names = tools.map((t) => t.name).toSorted();
    expect(names).toEqual(["ask_human", "delete_file", "edit", "list_files", "write"]);
    // The model-facing names that REPLACE native tools (so the loop drops its own copies).
    expect([...CONVERGED_TOOL_NAMES].toSorted()).toEqual(["edit", "write"]);
  });

  it("offers ask_human (cap human) which returns a human's answer inline", async () => {
    const tools = buildConvergedFileTools({
      workspaceRoot: root,
      requestHuman: async () => ({ decision: "answered", responseText: "ship it" }),
    });
    const res = await runTool(tools, "ask_human", { question: "Proceed with the migration?" });
    expect(res.ok).toBe(true);
    expect(res.paused).toBe(false);
    expect(res.answer).toBe("ship it");
  });

  it("drives a write -> read(list) -> edit -> delete round-trip on disk via the shared defs", async () => {
    const tools = buildConvergedFileTools({ workspaceRoot: root });

    const write = await runTool(tools, "write", { path: "src/x.ts", content: "const v = 1;\n" });
    expect(write.ok).toBe(true);
    expect(await readFile(join(root, "src/x.ts"), "utf-8")).toBe("const v = 1;\n");

    const list = await runTool(tools, "list_files", {});
    expect(list.ok).toBe(true);
    expect(list.paths).toContain("src/x.ts");

    const edit = await runTool(tools, "edit", {
      path: "src/x.ts",
      old_string: "1",
      new_string: "42",
    });
    expect(edit.ok).toBe(true);
    expect(await readFile(join(root, "src/x.ts"), "utf-8")).toBe("const v = 42;\n");

    const del = await runTool(tools, "delete_file", { path: "src/x.ts" });
    expect(del.ok).toBe(true);
  });

  it("surfaces a workspace-escape as a tool-level error (not a throw)", async () => {
    const tools = buildConvergedFileTools({ workspaceRoot: root });
    const write = await runTool(tools, "write", { path: "../escape.ts", content: "nope" });
    expect(write.ok).toBe(false);
    expect(String(write.error)).toMatch(/outside the workspace/);
  });
});

function fakeDesktop() {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const op = url.split("/v1/")[1] ?? "";
    if ((init?.headers as Record<string, string>)?.Authorization !== "Bearer tok") {
      return new Response("{}", { status: 401 });
    }
    if (op === "health") return new Response(JSON.stringify({ version: "x" }), { status: 200 });
    return new Response(JSON.stringify({ error: `unknown '${op}'` }), { status: 400 });
  };
}

describe("catalogConvergedFileTools — repo.semantic probe", () => {
  let root: string;
  let dir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bf-converged-sem-"));
    dir = fs.mkdtempSync(join(tmpdir(), "bf-desktop-"));
    process.env.BUILDERFORCE_DESKTOP_DISCOVERY = join(dir, "desktop.json");
  });
  afterEach(async () => {
    setDesktopFetchForTests(null);
    delete process.env.BUILDERFORCE_DESKTOP_DISCOVERY;
    fs.rmSync(dir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it("withholds semantic_search/repo_map when the desktop probe is absent", async () => {
    setDesktopFetchForTests(fakeDesktop());
    const tools = await catalogConvergedFileTools({ workspaceRoot: root });
    expect(tools.map((t) => t.name).toSorted()).toEqual([
      "ask_human",
      "delete_file",
      "edit",
      "list_files",
      "write",
    ]);
  });

  it("includes semantic_search and repo_map when the desktop probe succeeds", async () => {
    fs.writeFileSync(
      process.env.BUILDERFORCE_DESKTOP_DISCOVERY!,
      JSON.stringify({ port: 4999, token: "tok", pid: 1, version: "x" }),
    );
    setDesktopFetchForTests(fakeDesktop());
    const tools = await catalogConvergedFileTools({ workspaceRoot: root });
    const names = tools.map((t) => t.name);
    expect(names).toContain("semantic_search");
    expect(names).toContain("repo_map");
  });
});

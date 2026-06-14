import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { createBuilderForceAgentsCodingTools } from "./coding-tools.js";

vi.mock("../infra/shell-env.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../infra/shell-env.js")>();
  return { ...mod, getShellPathFromLoginShell: () => null };
});

const convergedConfig = {
  tools: { fs: { convergedFileTools: true } },
} as unknown as BuilderForceAgentsConfig;

function getText(result?: { content?: Array<{ type: string; text?: string }> }) {
  return result?.content?.find((b) => b.type === "text")?.text ?? "";
}

describe("createBuilderForceAgentsCodingTools — converged file tools (tools.fs.convergedFileTools)", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "bf-converged-wire-"));
  });
  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("replaces native write/edit (one each) and adds delete_file/list_files when enabled (non-sandboxed)", async () => {
    const tools = createBuilderForceAgentsCodingTools({ workspaceDir, config: convergedConfig });
    const names = tools.map((t) => t.name);
    expect(names.filter((n) => n === "write")).toHaveLength(1);
    expect(names.filter((n) => n === "edit")).toHaveLength(1);
    expect(names).toContain("delete_file");
    expect(names).toContain("list_files");
    // `read` stays native (images + read budgets the shared text-only read can't express).
    expect(names).toContain("read");

    // The converged `write` is live and writes to disk through the shared definition.
    const writeTool = tools.find((t) => t.name === "write");
    const res = await writeTool?.execute(
      "c1",
      { path: "src/a.ts", content: "export const a = 1;\n" },
      undefined as unknown as AbortSignal,
    );
    expect(getText(res)).toContain('"ok":true');
    expect(await fs.readFile(path.join(workspaceDir, "src/a.ts"), "utf-8")).toBe(
      "export const a = 1;\n",
    );
  });

  it("defaults OFF — native write/edit kept, no converged-only tools", async () => {
    const tools = createBuilderForceAgentsCodingTools({ workspaceDir });
    const names = tools.map((t) => t.name);
    expect(names).toContain("write");
    expect(names).toContain("edit");
    expect(names).not.toContain("delete_file");
    expect(names).not.toContain("list_files");
  });
});

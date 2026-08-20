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

  it("defaults ON — the converged set is what an unconfigured session gets", async () => {
    const tools = createBuilderForceAgentsCodingTools({ workspaceDir });
    const names = tools.map((t) => t.name);
    expect(names.filter((n) => n === "write")).toHaveLength(1);
    expect(names.filter((n) => n === "edit")).toHaveLength(1);
    expect(names).toContain("delete_file");
    expect(names).toContain("list_files");
  });

  it("can be turned OFF explicitly, falling back to the native per-tool copies", async () => {
    const nativeConfig = {
      tools: { fs: { convergedFileTools: false } },
    } as unknown as BuilderForceAgentsConfig;
    const tools = createBuilderForceAgentsCodingTools({ workspaceDir, config: nativeConfig });
    const names = tools.map((t) => t.name);
    expect(names).toContain("write");
    expect(names).toContain("edit");
    expect(names).not.toContain("delete_file");
    expect(names).not.toContain("list_files");
  });

  it("leaves writes UNCONFINED by default, exactly as the native tools were", async () => {
    // The whole reason the flag could default on: turning convergence on must not turn
    // `tools.fs.workspaceOnly` on with it. A write outside the root still succeeds unless
    // the operator asked for confinement — otherwise a flag flip silently starts failing
    // every legitimate out-of-tree write.
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "bf-outside-"));
    try {
      const tools = createBuilderForceAgentsCodingTools({ workspaceDir });
      const write = tools.find((t) => t.name === "write");
      const target = path.join(outside, "note.txt");
      const res = await write?.execute(
        "c1",
        { path: target, content: "outside\n" },
        undefined as unknown as AbortSignal,
      );
      expect(getText(res)).toContain('"ok":true');
      expect(await fs.readFile(target, "utf-8")).toBe("outside\n");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("CONFINES writes when tools.fs.workspaceOnly is set", async () => {
    const confined = {
      tools: { fs: { workspaceOnly: true } },
    } as unknown as BuilderForceAgentsConfig;
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "bf-outside-"));
    try {
      const tools = createBuilderForceAgentsCodingTools({ workspaceDir, config: confined });
      const write = tools.find((t) => t.name === "write");
      // The converged tool inherits the SAME outer workspace guard the native pair gets,
      // which refuses the call outright rather than letting the provider report it.
      await expect(
        write?.execute(
          "c1",
          { path: path.join(outside, "note.txt"), content: "nope\n" },
          undefined as unknown as AbortSignal,
        ),
      ).rejects.toThrow(/escapes/i);
      // And nothing reached disk.
      await expect(fs.readFile(path.join(outside, "note.txt"), "utf-8")).rejects.toThrow();
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

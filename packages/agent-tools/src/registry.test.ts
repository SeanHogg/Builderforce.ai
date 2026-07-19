/**
 * Capability gating is the security-relevant half of the shared tool contract: a surface
 * gets a tool ONLY if it can physically back every capability that tool requires. These
 * tests pin that a read-only surface can neither SEE nor CALL a mutating tool — the
 * registry is the single choke point four capability providers depend on.
 */

import { describe, expect, it } from "vitest";
import type { Capability, CapabilityProvider } from "./capabilities.js";
import { buildCoreToolRegistry } from "./core-tools.js";
import { ToolRegistry } from "./registry.js";
import { defineTool, type ToolContext } from "./tool.js";

/** A provider advertising exactly `caps`, with read services wired (so a bypass would
 *  actually succeed if gating failed, rather than crashing on a missing service). */
function providerWith(caps: readonly Capability[]): CapabilityProvider {
  return {
    capabilities: new Set<Capability>(caps),
    repoRead: {
      listFiles: async () => ({ ok: true, paths: ["a.ts"] }),
      readFile: async (path: string) => ({ ok: true, path, content: "hello" }),
      searchCode: async (query: string) => ({ ok: true, query, total: 0, matches: [] }),
    },
    repoWrite: {
      writeFile: async () => ({ ok: true, change: "created" as const }),
      deleteFile: async () => ({ ok: true, deleted: true }),
      editFile: async () => ({ ok: true, change: "modified" as const, replaced: 1 }),
    },
    shell: { run: async () => ({ ok: true, stdout: "", exitCode: 0 }) },
  };
}

const ctxFor = (caps: CapabilityProvider): ToolContext => ({ caps, workspaceRoot: "/repo" });

const READ_ONLY = providerWith(["repo.read"]);

describe("ToolRegistry · capability gating", () => {
  const registry = buildCoreToolRegistry();

  it("offers a read-only surface the read tools and NOTHING that mutates or shells out", () => {
    const names = registry.availableNames(READ_ONLY);
    expect(names).toContain("list_files");
    expect(names).toContain("read_file");
    // `finish` requires no capability, so every surface gets it.
    expect(names).toContain("finish");
    for (const forbidden of [
      "write_file",
      "edit_file",
      "delete_file",
      "run_command",
      "git_status",
      "git_undo",
      "search_code",
      "web_fetch",
      "ask_human",
      "memory_remember",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("keeps the advertised schema array in lockstep with the offered tools", () => {
    const schemaNames = registry.schemasFor(READ_ONLY).map((s) => s.function.name);
    expect(schemaNames).toEqual(registry.availableNames(READ_ONLY));
  });

  it("widens the toolset exactly as capabilities are added", () => {
    expect(registry.availableNames(providerWith(["repo.read", "repo.write"]))).toContain("write_file");
    expect(registry.availableNames(providerWith(["repo.read", "repo.write"]))).not.toContain("edit_file");
    expect(registry.availableNames(providerWith(["repo.edit"]))).toContain("edit_file");
    expect(registry.availableNames(providerWith(["shell"]))).toEqual(
      expect.arrayContaining(["run_command", "git_status", "git_diff", "git_history", "git_sync_latest", "git_undo", "git_redo"]),
    );
  });

  it("REFUSES the call at dispatch time too, even though the tool was never advertised", async () => {
    // Defence in depth: a model can hallucinate a tool name it was not offered. The
    // provider above has a working repoWrite, so a gating miss would really write.
    for (const name of ["write_file", "edit_file", "delete_file", "run_command"]) {
      const r = await registry.dispatch(name, { path: "a.ts", content: "x", old_string: "a", new_string: "b", command: "ls" }, ctxFor(READ_ONLY));
      expect(r.data.ok).toBe(false);
      expect(String(r.data.error)).toContain("not available on this surface");
      expect(String(r.data.error)).toMatch(/missing capability/);
    }
  });

  it("names the specific missing capability so the model can adapt", async () => {
    const r = await registry.dispatch("run_command", { command: "ls" }, ctxFor(READ_ONLY));
    expect(String(r.data.error)).toContain("shell");
  });

  it("still dispatches a tool the surface DOES back", async () => {
    const r = await registry.dispatch("read_file", { path: "a.ts" }, ctxFor(READ_ONLY));
    expect(r.data.ok).toBe(true);
    expect(r.data.content).toBe("hello");
  });

  it("reports an unknown tool with the list of tools this surface can call", async () => {
    const r = await registry.dispatch("teleport", {}, ctxFor(READ_ONLY));
    expect(r.data.ok).toBe(false);
    expect(String(r.data.error)).toContain("unknown tool 'teleport'");
    expect(String(r.data.error)).toContain("read_file");
    expect(String(r.data.error)).not.toContain("write_file");
  });

  it("rejects a duplicate registration instead of silently shadowing", () => {
    const r = new ToolRegistry();
    const def = defineTool({
      name: "dup",
      description: "d",
      parameters: { type: "object", properties: {} },
      requires: [],
      execute: async () => ({ data: { ok: true } }),
    });
    r.register(def);
    expect(() => r.register(def)).toThrow(/duplicate tool 'dup'/);
  });
});

/**
 * Cross-runtime proof: the SHARED tool definitions the cloud engine runs
 * (`@builderforce/agent-tools` core tools) execute on-prem, unchanged, against the
 * Node disk/shell {@link buildNodeCapabilityProvider}. Same definitions, different
 * injected provider — the unification the registry + capability contract buys.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCoreToolRegistry } from "@builderforce/agent-tools";
import { Type } from "@sinclair/typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnyAgentTool } from "../../agents/pi-tools.types.js";
import { jsonResult } from "../../agents/tools/common.js";
import { buildNodeCapabilityProvider, NODE_SURFACE_CAPS } from "./node-capability-provider.js";
import { buildOnPremToolRegistry, fromPiTool, sharedToolsForNode, toPiTool } from "./pi-tool-adapter.js";

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "shared-tools-"));
});
afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("shared core tools on the Node provider", () => {
  it("offers the capability-appropriate tool set on-prem (incl. run_command, excl. run_checks)", () => {
    const registry = buildCoreToolRegistry();
    const provider = buildNodeCapabilityProvider(workspace);
    const names = registry.toolsFor(provider).map((t) => t.name).sort();
    // Node has a real shell → run_command is offered; run_checks (shell-free static
    // validator, gated to `static-check`) and ask_human (no `human` cap) are not.
    expect(names).toContain("run_command");
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("delete_file");
    expect(names).toContain("search_code");
    expect(names).toContain("web_fetch");
    expect(names).not.toContain("run_checks");
    expect(names).not.toContain("ask_human");
    // web_search needs a search backend the Node surface does not advertise yet.
    expect(names).not.toContain("web_search");
    expect(NODE_SURFACE_CAPS.has("shell")).toBe(true);
  });

  it("runs the shared edit_file tool in-place through the disk provider", async () => {
    const registry = buildCoreToolRegistry();
    const provider = buildNodeCapabilityProvider(workspace);
    await fs.mkdir(path.join(workspace, "src"), { recursive: true });
    await fs.writeFile(path.join(workspace, "src/v.ts"), "export const v = 1;\n", "utf8");
    const edit = toPiTool(registry.get("edit_file")!, provider);
    const res = await edit.execute("c1", { path: "src/v.ts", old_string: "v = 1", new_string: "v = 2" });
    expect((res.details as { ok: boolean }).ok).toBe(true);
    expect(await fs.readFile(path.join(workspace, "src/v.ts"), "utf8")).toContain("v = 2");
    // Non-unique without replace_all is refused.
    await fs.writeFile(path.join(workspace, "src/v.ts"), "a\na\n", "utf8");
    const dup = await edit.execute("c2", { path: "src/v.ts", old_string: "a", new_string: "b" });
    expect((dup.details as { ok: boolean }).ok).toBe(false);
  });

  it("runs write_file → read_file → list_files end-to-end through the disk provider", async () => {
    const registry = buildCoreToolRegistry();
    const provider = buildNodeCapabilityProvider(workspace);
    const piTools = sharedToolsForNode(registry, provider);
    const write = piTools.find((t) => t.name === "write_file")!;
    const read = piTools.find((t) => t.name === "read_file")!;
    const list = piTools.find((t) => t.name === "list_files")!;

    const wrote = await write.execute("c1", { path: "src/hello.ts", content: "export const hi = 1;\n" });
    expect((wrote.details as { ok: boolean }).ok).toBe(true);
    // It actually hit disk.
    expect(await fs.readFile(path.join(workspace, "src/hello.ts"), "utf8")).toContain("export const hi = 1;");

    const got = await read.execute("c2", { path: "src/hello.ts" });
    expect((got.details as { ok: boolean; content?: string }).content).toContain("export const hi = 1;");

    const listed = await list.execute("c3", {});
    expect((listed.details as { paths?: string[] }).paths).toContain("src/hello.ts");
  });

  it("executes a real shell command via the shared run_command tool", async () => {
    const registry = buildCoreToolRegistry();
    const provider = buildNodeCapabilityProvider(workspace);
    const runCommand = toPiTool(registry.get("run_command")!, provider);
    const res = await runCommand.execute("c1", { command: "echo cross-runtime-ok" });
    const details = res.details as { ok: boolean; stdout?: string };
    expect(details.ok).toBe(true);
    expect(details.stdout).toContain("cross-runtime-ok");
  });

  it("blocks a path that escapes the workspace root", async () => {
    const provider = buildNodeCapabilityProvider(workspace);
    const r = await provider.repoRead!.readFile("../../etc/passwd");
    expect(r.ok).toBe(false);
  });
});

describe("reverse adapter: any pi tool → shared contract (full on-prem catalogue)", () => {
  // A stand-in for any of the Node-only pi tools (browser, sessions, channels, media,
  // orchestrate, memory, …): a co-located pi AgentTool with a TypeBox schema.
  function makePiTool(name: string): AnyAgentTool {
    return {
      name,
      label: name,
      description: `native ${name} tool`,
      parameters: Type.Object({ q: Type.String({ description: "input" }) }),
      async execute(_id: string, params: { q: string }) {
        return jsonResult({ ok: true, tool: name, echo: params.q });
      },
    } as unknown as AnyAgentTool;
  }

  it("wraps a pi tool as a shared ToolDefinition that dispatches through the registry", async () => {
    const piTool = makePiTool("browser");
    const def = fromPiTool(piTool);
    expect(def.name).toBe("browser");
    expect(def.schema.function.description).toBe("native browser tool");
    // It carries the pi tool's schema (not a hand-copy) and dispatches via the registry.
    const registry = buildOnPremToolRegistry([piTool]);
    const provider = buildNodeCapabilityProvider(workspace);
    const out = await registry.dispatch("browser", { q: "hi" }, { caps: provider });
    expect(out.data).toMatchObject({ ok: true, tool: "browser", echo: "hi" });
  });

  it("brings the WHOLE on-prem set under one shared registry (browser/sessions/orchestrate/memory/media/message)", () => {
    const names = ["browser", "sessions_send", "orchestrate", "memory_search", "image", "message", "cron", "gateway", "nodes"];
    const registry = buildOnPremToolRegistry(names.map(makePiTool));
    for (const n of names) expect(registry.has(n)).toBe(true);
    // Every entry is a valid shared ToolDefinition (schema + execute).
    const provider = buildNodeCapabilityProvider(workspace);
    expect(registry.schemasFor(provider).length).toBe(names.length);
  });
});

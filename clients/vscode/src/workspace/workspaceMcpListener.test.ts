import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { forgetDesktopProbe, setDesktopFetchForTests } from "@builderforce/agent-tools/node-desktop";
import { createWorkspaceMcpTools } from "@builderforce/workspace-mcp";
import { buildLocalCapabilityProvider } from "../tools/localCapabilities";
import { startWorkspaceMcpListener } from "./workspaceMcpListener";

it("binds Workspace MCP to authenticated loopback and closes on disposal", async () => {
  const server = await startWorkspaceMcpListener([]);
  try {
    expect(new URL(server.url).hostname).toBe("127.0.0.1");
    const body = JSON.stringify({ jsonrpc: "2.0", id: "ping", method: "ping" });
    const headers = { "Content-Type": "application/json", Authorization: server.authorization };
    const denied = await fetch(server.url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    expect(denied.status).toBe(401);
    const crossed = await fetch(server.url, { method: "POST", headers: { ...headers, Origin: "https://example.com" }, body });
    expect(crossed.status).toBe(403);
    const allowed = await fetch(server.url, { method: "POST", headers, body });
    expect(await allowed.json()).toMatchObject({ id: "ping", result: {} });
  } finally {
    server.dispose();
  }
  await expect(fetch(server.url)).rejects.toThrow();
});

it("resolves the Workspace MCP contribution's label in each extension locale", async () => {
  const extension = new URL("../../", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("package.json", extension), "utf8"));
  const label = manifest.contributes.mcpServerDefinitionProviders
    .find((provider: { id: string }) => provider.id === "builderforce.workspace").label as string;
  expect(label).toMatch(/^%.+%$/);
  const key = label.slice(1, -1);
  const catalogs = (await readdir(extension)).filter((file) => /^package\.nls(?:\..+)?\.json$/.test(file));
  expect(catalogs.length).toBeGreaterThan(1);
  for (const file of catalogs) {
    const messages = JSON.parse(await readFile(new URL(file, extension), "utf8"));
    expect(messages[key], file).toEqual(expect.stringMatching(/\S/));
  }
});

it("advertises hybrid search and compression only while their backend is reachable", async () => {
  const root = await mkdtemp(join(tmpdir(), "bf-workspace-mcp-desktop-"));
  const discovery = join(root, "desktop.json");
  vi.stubEnv("BUILDERFORCE_DESKTOP_DISCOVERY", discovery);
  let compressorReady = false;
  const requests = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/health")) return Response.json(compressorReady ? { compress: "ready" } : {});
    const args = JSON.parse(String(init?.body));
    if (url.endsWith("/search")) {
      expect(args).toMatchObject({ root, query: "where do we verify paths" });
      return Response.json({
        status: { phase: { state: "ready" } },
        results: [{ path: "test.ts", startLine: 4, endLine: 9, snippet: "function verifyPath() {}", source: "hybrid" }],
      });
    }
    expect(url).toMatch(/\/compress$/);
    expect(args.text.length).toBeGreaterThan(4000);
    return Response.json({ text: "Concise prose.", originalTokens: 1800, keptTokens: 8 });
  });
  setDesktopFetchForTests(requests);
  try {
    const server = await startWorkspaceMcpListener(createWorkspaceMcpTools(() => ({
      root, caps: buildLocalCapabilityProvider(root),
    })));
    try {
      const rpc = async (method: string, params = {}) => (await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: server.authorization },
        body: JSON.stringify({ jsonrpc: "2.0", id: "test", method, params }),
      })).json();
      const list = async () => (await rpc("tools/list")).result.tools.map((tool: { name: string }) => tool.name);
      expect(await list()).not.toContain("workspace__find");
      expect(await list()).not.toContain("workspace__compress");
      expect(requests).not.toHaveBeenCalled();

      await writeFile(discovery, JSON.stringify({ port: 4321, token: "test", pid: 1, version: "test" }));
      forgetDesktopProbe();
      expect(await list()).toContain("workspace__find");
      expect(await list()).not.toContain("workspace__compress");
      const found = await rpc("tools/call", {
        name: "workspace__find",
        arguments: { query: "where do we verify paths" },
      });
      expect(found.result.structuredContent.results[0]).toMatchObject({
        at: "test.ts:4-9", via: "hybrid",
      });

      compressorReady = true;
      forgetDesktopProbe();
      expect(await list()).toContain("workspace__compress");
      const original = "Some ordinary prose about the workspace. ".repeat(130);
      const compressed = await rpc("tools/call", {
        name: "workspace__compress",
        arguments: { text: original },
      });
      expect(compressed.result.structuredContent).toMatchObject({ text: "Concise prose.", compressed: true });
      const code = await rpc("tools/call", {
        name: "workspace__compress",
        arguments: { text: "const value = true;", kind: "code" },
      });
      expect(code.result.structuredContent).toMatchObject({ text: "const value = true;", compressed: false });
      expect(requests.mock.calls.filter(([url]) => url.endsWith("/compress"))).toHaveLength(1);
    } finally {
      server.dispose();
    }
  } finally {
    setDesktopFetchForTests(null);
    vi.unstubAllEnvs();
    await rm(discovery, { force: true });
    await rmdir(root);
  }
});

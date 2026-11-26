import { readFile, readdir } from "node:fs/promises";
import { expect, it } from "vitest";
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

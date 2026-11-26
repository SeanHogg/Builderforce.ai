import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { handleMcpHttpRequest } from "./mcp-server-http.js";

it("serves the SDK workspace catalog and searches only the requested file", async () => {
  const root = await mkdtemp(join(tmpdir(), "bf-workspace-mcp-"));
  const data = ["match.ts", "excluded.ts"];
  const server = createServer((req, res) => {
    void handleMcpHttpRequest(req, res, {
      auth: { mode: "token", token: "workspace-test-token", allowTailscale: false },
      trustedProxies: [],
    }).catch(() => { res.statusCode = 500; res.end(); });
  });
  try {
    await Promise.all(data.map((file) => writeFile(join(root, file), "const exactMarker = true;\n")));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    let id = 0;
    const send = (method: string, params = {}, token = "workspace-test-token") => fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });

    const unauthorized = await send("tools/list", {}, "invalid");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain("Bearer");
    const stream = await fetch(url, {
      headers: { accept: "text/event-stream", authorization: "Bearer workspace-test-token" },
    });
    expect(stream.status).toBe(405);
    expect(await (await send("ping")).json()).toMatchObject({ result: {} });

    const catalog = await (await send("tools/list")).json();
    expect(catalog.result.tools).toContainEqual(expect.objectContaining({
      name: "workspace__search",
      annotations: { readOnlyHint: true },
    }));
    expect(catalog.result.tools.map((tool: { name: string }) => tool.name)).not.toContain("workspace__tickets_from_delta");

    const result = await (await send("tools/call", {
      name: "workspace__search",
      arguments: { projectRoot: root, path: "match.ts", query: "exactMarker" },
    })).json();
    expect(result.result.structuredContent).toMatchObject({ ok: true, total: 1, matches: [{ path: "match.ts" }] });
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all(data.map((file) => rm(join(root, file), { force: true })));
    await rmdir(root);
  }
});

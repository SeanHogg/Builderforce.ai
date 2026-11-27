import { execFileSync } from "node:child_process";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { handleMcpHttpRequest } from "./mcp-server-http.js";

it("serves the SDK workspace catalog and searches only the requested file", async () => {
  const root = await mkdtemp(join(tmpdir(), "bf-workspace-mcp-"));
  vi.stubEnv("BUILDERFORCE_DESKTOP_DISCOVERY", join(root, "absent-desktop.json"));
  const data = ["match.ts", "excluded.ts"];
  const server = createServer((req, res) => {
    void handleMcpHttpRequest(req, res, {
      auth: { mode: "token", token: "workspace-test-token", allowTailscale: false },
      trustedProxies: [],
    }).catch(() => { res.statusCode = 500; res.end(); });
  });
  try {
    await Promise.all([
      writeFile(join(root, "match.ts"), "export function exactMarker() { return true; }\n"),
      writeFile(join(root, "excluded.ts"), "import { exactMarker } from './match';\nexactMarker();\n"),
    ]);
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
    expect(catalog.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "workspace__search", "workspace__symbol", "workspace__outline", "workspace__map", "workspace__references", "workspace__git_history", "workspace__find",
    ]);

    const result = await (await send("tools/call", {
      name: "workspace__search",
      arguments: { projectRoot: root, path: "match.ts", query: "exactMarker" },
    })).json();
    expect(result.result.structuredContent).toMatchObject({ ok: true, total: 1, matches: [{ path: "match.ts" }] });

    const call = async (name: string, args: Record<string, unknown>) =>
      (await send("tools/call", { name, arguments: { projectRoot: root, ...args } })).json();
    const outline = await call("workspace__outline", { path: "match.ts" });
    expect(outline.result.structuredContent).toMatchObject({ path: "match.ts", total: 1 });
    const symbol = await call("workspace__symbol", { query: "exactMarker" });
    expect(symbol.result.structuredContent.matches).toEqual([expect.stringContaining("match.ts:1")]);
    const map = await call("workspace__map", {});
    expect(map.result.structuredContent.map).toContain("match.ts");
    const refs = await call("workspace__references", { texts: ["Use `exactMarker()` from `match.ts`, not `missing.ts`."] });
    expect(refs.result.structuredContent.results).toEqual([
      { index: 0, missing: [{ kind: "path", reference: "missing.ts" }] },
    ]);
    const found = await call("workspace__find", { query: "exactMarker", path: "match.ts" });
    expect(found.result.structuredContent).toMatchObject({
      ok: true, results: [{ at: "match.ts:1-1", snippet: expect.stringContaining("return true") }],
    });

    for (const name of ["codebase_search", "codebase_semantic_search"]) {
      const alias = await call(name, { query: "exactMarker", language: ".ts" });
      const blocks = JSON.parse(alias.result.content[0].text);
      expect(JSON.parse(blocks[0].text)).toMatchObject({
        indexedFiles: 2,
        results: expect.arrayContaining([{ filePath: "match.ts", score: expect.any(Number),
          symbols: ["exactMarker"], snippet: expect.stringContaining("return true") }]),
      });
    }
    const legacySearch = await fetch(`${url}/call`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer workspace-test-token" },
      body: JSON.stringify({
        tool: "codebase_search",
        args: { projectRoot: root, query: "exactMarker", language: ".ts" },
      }),
    });
    expect(legacySearch.status).toBe(200);
    const legacyResult = await legacySearch.json();
    expect(JSON.parse(legacyResult.result[0].text)).toMatchObject({
      results: expect.arrayContaining([expect.objectContaining({ filePath: "match.ts" })]),
    });

    const git = (...args: string[]) => execFileSync(
      "git", ["-c", "user.name=MCP Test", "-c", "user.email=mcp@example.test", "-c", "commit.gpgsign=false", ...args],
      { cwd: root, stdio: "ignore" },
    );
    git("init", "--quiet");
    git("add", "match.ts");
    git("commit", "--quiet", "-m", "Add match");
    const history = await call("workspace__git_history", { path: "match.ts", author: "MCP Test" });
    expect(history.result.structuredContent.commits).toEqual([
      expect.objectContaining({ author: "MCP Test", title: "Add match", paths: ["match.ts"] }),
    ]);
    const legacyHistory = await call("git_history", { path: "match.ts", author: "MCP Test" });
    const blocks = JSON.parse(legacyHistory.result.content[0].text);
    expect(JSON.parse(blocks[0].text)).toMatchObject({
      totalCommits: 1,
      commits: [{ author: "MCP Test <mcp@example.test>", message: "Add match", filesChanged: 1 }],
      topFiles: [{ file: "match.ts", commits: 1 }],
    });
  } finally {
    vi.unstubAllEnvs();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all(data.map((file) => rm(join(root, file), { force: true })));
    await rm(join(root, ".builderForceAgents", "symbols.json"), { force: true });
    await rmdir(join(root, ".builderForceAgents")).catch(() => undefined);
    await rm(join(root, ".git"), { recursive: true, force: true });
    await rmdir(root);
  }
});

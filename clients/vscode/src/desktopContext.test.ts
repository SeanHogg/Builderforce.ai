import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  checkReferences,
  desktopBackedTools,
  desktopRepoMapSection,
  desktopSemanticCapability,
  liveDesktop,
  setDesktopFetchForTests,
} from "./desktopContext";

/** A scripted desktop service: `routes[op]` answers `POST /v1/<op>`; health is 200. */
function fakeService(routes: Record<string, (body: Record<string, unknown>) => unknown>, calls: string[] = []) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const op = url.split("/v1/")[1] ?? "";
    calls.push(op);
    if ((init?.headers as Record<string, string>)?.Authorization !== "Bearer tok") return new Response("{}", { status: 401 });
    if (op === "health") return new Response(JSON.stringify({ version: "2026.9.26" }), { status: 200 });
    const handler = routes[op];
    if (!handler) return new Response(JSON.stringify({ error: `unknown operation '${op}'` }), { status: 400 });
    return new Response(JSON.stringify(handler(JSON.parse(String(init?.body ?? "{}")))), { status: 200 });
  };
}

const READY = { phase: { state: "ready" }, files: 3 };

describe("desktop context client", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-desktop-"));
    process.env.BUILDERFORCE_DESKTOP_DISCOVERY = path.join(dir, "desktop.json");
  });

  afterEach(() => {
    setDesktopFetchForTests(null);
    delete process.env.BUILDERFORCE_DESKTOP_DISCOVERY;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function publish(): void {
    fs.writeFileSync(process.env.BUILDERFORCE_DESKTOP_DISCOVERY!, JSON.stringify({ port: 4999, token: "tok", pid: 1, version: "x" }));
  }

  it("is absent without a discovery file, and withholds the semantic tools", async () => {
    setDesktopFetchForTests(fakeService({}));
    expect(await liveDesktop()).toBeNull();
    const tools = await desktopBackedTools([{ name: "read_file" }, { name: "semantic_search" }, { name: "repo_map" }]);
    expect(tools.map((t) => t.name)).toEqual(["read_file"]);
    const r = await desktopSemanticCapability("/repo").search("x");
    expect(r.ok).toBe(false);
    expect(await checkReferences("/repo", ["`foo()`"])).toBeNull();
    expect(await desktopRepoMapSection("/repo")).toBe("");
  });

  it("keeps the semantic tools and maps search results when the service answers", async () => {
    publish();
    let sent: Record<string, unknown> | undefined;
    setDesktopFetchForTests(
      fakeService({
        search: (b) => {
          sent = b;
          return {
            results: [{ path: "src/a.ts", startLine: 1, endLine: 9, symbol: "applyWebhook", kind: "function_declaration", snippet: "…", score: 0.1, source: "both" }],
            status: { phase: { state: "scanning", done: 1, total: 4 }, files: 1 },
          };
        },
      }),
    );
    expect((await desktopBackedTools([{ name: "semantic_search" }])).length).toBe(1);
    const r = await desktopSemanticCapability("/repo").search("webhook", { scope: "src", limit: 3 });
    expect(sent).toEqual({ root: "/repo", query: "webhook", limit: 3, pathPrefix: "src" });
    expect(r).toMatchObject({ ok: true, indexing: true });
    expect(r.results?.[0]?.symbol).toBe("applyWebhook");
  });

  it("surfaces an operation error as ok:false with the service's message", async () => {
    publish();
    setDesktopFetchForTests(fakeService({}));
    const r = await desktopSemanticCapability("/repo").repoMap();
    expect(r).toEqual({ ok: false, error: "unknown operation 'repo-map'" });
  });

  it("aligns reference checks to the request texts and renders the grounding map", async () => {
    publish();
    setDesktopFetchForTests(
      fakeService({
        "check-references": () => ({ results: [{ index: 1, missing: [{ reference: "goneFn", kind: "symbol" }] }], status: READY }),
        "repo-map": () => ({ map: "src/core.ts\n  1: export function core()\n", status: READY }),
      }),
    );
    expect(await checkReferences("/repo", ["fine", "uses `goneFn()`"])).toEqual([[], [{ reference: "goneFn", kind: "symbol" }]]);
    const section = await desktopRepoMapSection("/repo");
    expect(section).toContain("## Repository map");
    expect(section).toContain("src/core.ts");
    expect(section).not.toContain("partial");
  });

  it("caches the probe instead of re-checking health on every call", async () => {
    publish();
    const calls: string[] = [];
    setDesktopFetchForTests(fakeService({ "repo-map": () => ({ map: "", status: READY }) }, calls));
    await desktopRepoMapSection("/repo");
    await desktopRepoMapSection("/repo");
    expect(calls.filter((c) => c === "health")).toHaveLength(1);
  });
});

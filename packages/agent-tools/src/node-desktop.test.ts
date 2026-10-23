import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  catalogDesktopSemantic,
  checkReferences,
  desktopBackedTools,
  desktopCompressAvailable,
  healthReportsCompress,
  desktopRepoMapSection,
  desktopSemanticCapability,
  liveDesktop,
  readDesktopModelsEndpoint,
  setDesktopFetchForTests,
} from "./node-desktop";

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

  it("catalogDesktopSemantic is undefined when the probe is absent", async () => {
    setDesktopFetchForTests(fakeService({}));
    expect(await catalogDesktopSemantic("/repo")).toBeUndefined();
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
    expect(await catalogDesktopSemantic("/repo")).toBeDefined();
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

  it("keeps port/token discovery when models.endpoint is invalid", async () => {
    fs.writeFileSync(
      process.env.BUILDERFORCE_DESKTOP_DISCOVERY!,
      JSON.stringify({ port: 4999, token: "tok", pid: 1, version: "x", models: { endpoint: "not-a-url" } }),
    );
    expect(readDesktopModelsEndpoint()).toBeNull();
    setDesktopFetchForTests(fakeService({}));
    expect(await liveDesktop()).toMatchObject({ port: 4999, token: "tok" });
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

describe("desktop.json models.endpoint", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-desktop-models-"));
    process.env.BUILDERFORCE_DESKTOP_DISCOVERY = path.join(dir, "desktop.json");
  });

  afterEach(() => {
    delete process.env.BUILDERFORCE_DESKTOP_DISCOVERY;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(payload: unknown): void {
    fs.writeFileSync(process.env.BUILDERFORCE_DESKTOP_DISCOVERY!, JSON.stringify(payload));
  }

  it("is absent when the discovery file is missing", () => {
    expect(readDesktopModelsEndpoint()).toBeNull();
  });

  it("reads models.endpoint independently of port/token discovery", () => {
    write({
      port: 4999,
      token: "tok",
      pid: 1,
      version: "x",
      models: { endpoint: "http://127.0.0.1:11435/v1", token: " desk-token " },
    });
    expect(readDesktopModelsEndpoint()).toEqual({
      baseUrl: "http://127.0.0.1:11435/v1",
      token: "desk-token",
    });
  });

  it("accepts an omitted provider (Synapse is the default)", () => {
    write({ models: { endpoint: "http://127.0.0.1:11435" } });
    expect(readDesktopModelsEndpoint()).toEqual({ baseUrl: "http://127.0.0.1:11435" });
  });

  it("accepts provider synapse explicitly", () => {
    write({ models: { endpoint: "https://127.0.0.1:11435", provider: "synapse" } });
    expect(readDesktopModelsEndpoint()).toEqual({ baseUrl: "https://127.0.0.1:11435" });
  });

  it("skips invalid models without throwing", () => {
    write({ port: 4999, token: "tok", models: { endpoint: "not-a-url" } });
    expect(readDesktopModelsEndpoint()).toBeNull();
    write({ models: { endpoint: "ftp://127.0.0.1:11435" } });
    expect(readDesktopModelsEndpoint()).toBeNull();
    write({ models: { provider: "ollama", endpoint: "http://127.0.0.1:11434" } });
    expect(readDesktopModelsEndpoint()).toBeNull();
    write({ models: {} });
    expect(readDesktopModelsEndpoint()).toBeNull();
  });
});

describe("desktop compression", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-desktop-compress-"));
    process.env.BUILDERFORCE_DESKTOP_DISCOVERY = path.join(dir, "desktop.json");
    fs.writeFileSync(process.env.BUILDERFORCE_DESKTOP_DISCOVERY, JSON.stringify({ port: 4999, token: "tok", pid: 1, version: "x" }));
  });

  afterEach(() => {
    setDesktopFetchForTests(null);
    delete process.env.BUILDERFORCE_DESKTOP_DISCOVERY;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A service whose health reports `compress` as given; `/v1/compress` halves the text. */
  function service(compress: string | undefined, sent: Array<Record<string, unknown>> = []) {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      const op = url.split("/v1/")[1] ?? "";
      if (op === "health") return new Response(JSON.stringify({ version: "x", ...(compress ? { compress } : {}) }), { status: 200 });
      if (op === "compress") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text: string; rate: number };
        sent.push(body);
        return new Response(JSON.stringify({ text: body.text.slice(0, body.text.length / 2), originalTokens: 10, keptTokens: 5 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "nope" }), { status: 400 });
    };
  }

  it("reads the compress feature from the health body", () => {
    expect(healthReportsCompress({ compress: "idle" })).toBe(true);
    expect(healthReportsCompress({ compress: "ready" })).toBe(true);
    expect(healthReportsCompress({ compress: "disabled" })).toBe(false);
    expect(healthReportsCompress({ compress: "unavailable" })).toBe(false);
    expect(healthReportsCompress({ version: "old" })).toBe(false);
    expect(healthReportsCompress(null)).toBe(false);
  });

  it("advertises compress only when the probe reports it", async () => {
    setDesktopFetchForTests(service("disabled"));
    expect(await desktopCompressAvailable()).toBe(false);
    expect((await catalogDesktopSemantic("/repo"))?.compress).toBeUndefined();

    setDesktopFetchForTests(service(undefined));
    expect((await catalogDesktopSemantic("/repo"))?.compress).toBeUndefined();
  });

  it("compresses through POST /v1/compress when built in", async () => {
    const sent: Array<Record<string, unknown>> = [];
    setDesktopFetchForTests(service("idle", sent));
    expect(await desktopCompressAvailable()).toBe(true);
    const cap = await catalogDesktopSemantic("/repo");
    const r = await cap!.compress!("abcdefgh", 0.4);
    expect(r).toEqual({ ok: true, text: "abcd", originalTokens: 10, keptTokens: 5 });
    expect(sent).toEqual([{ text: "abcdefgh", rate: 0.4 }]);
  });

  it("is never attached by the plain capability factory", () => {
    expect(desktopSemanticCapability("/repo").compress).toBeUndefined();
    expect(desktopSemanticCapability("/repo", { compress: true }).compress).toBeTypeOf("function");
  });
});

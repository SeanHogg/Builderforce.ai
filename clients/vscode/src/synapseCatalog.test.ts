import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLocalChatEndpoint } from "./localModels";
import {
  fetchSynapseCatalog,
  parsePullEvent,
  pullSynapseModel,
  synapseCatalogUrl,
  synapsePullUrl,
} from "./synapseCatalog";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const endpoint = { baseUrl: "http://127.0.0.1:11435/v1", token: "desk-token" };

describe("Synapse catalog / pull URLs", () => {
  it("normalizes the documented /v1 form onto catalog and pull paths", () => {
    expect(synapseCatalogUrl("http://127.0.0.1:11435/v1/")).toBe("http://127.0.0.1:11435/v1/synapse/catalog");
    expect(synapsePullUrl("http://127.0.0.1:11435")).toBe("http://127.0.0.1:11435/api/pull");
  });

  it("is refused by the chat-proxy fence — pull is a separate fetch", () => {
    const config = {
      enabled: true,
      endpoints: { synapse: { baseUrl: "http://127.0.0.1:11435" } },
    };
    expect(resolveLocalChatEndpoint(config, "http://127.0.0.1:11435/v1/chat/completions")).not.toBeNull();
    expect(resolveLocalChatEndpoint(config, "http://127.0.0.1:11435/api/pull")).toBeNull();
    expect(resolveLocalChatEndpoint(config, "http://127.0.0.1:11435/v1/synapse/catalog")).toBeNull();
  });
});

describe("fetchSynapseCatalog", () => {
  it("maps catalog items, including fit and size", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "llama-3.1-8b", bytes: 4_500_000_000, fit: true },
            { name: "qwen3:8b", size: 5_000_000_000, fit: false },
            { id: 42 },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const result = await fetchSynapseCatalog(endpoint);
    expect(result).toEqual({
      ok: true,
      items: [
        { id: "llama-3.1-8b", bytes: 4_500_000_000, fit: true },
        { id: "qwen3:8b", bytes: 5_000_000_000, fit: false },
      ],
    });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:11435/v1/synapse/catalog",
    );
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ authorization: "Bearer desk-token" }),
    );
  });

  it("treats 404 as unavailable, not an empty success", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(fetchSynapseCatalog(endpoint)).resolves.toEqual({
      ok: false,
      reason: "missing",
      status: 404,
      detail: "catalog endpoint is not available",
    });
  });

  it("treats an unreachable runtime as unavailable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await fetchSynapseCatalog(endpoint);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unreachable");
  });
});

describe("pullSynapseModel", () => {
  it("POSTs {model} to /api/pull and succeeds on {status:success}", async () => {
    const spy = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ model: "llama-3.1-8b" });
      return new Response(JSON.stringify({ status: "success" }), { status: 200 });
    });
    globalThis.fetch = spy as unknown as typeof fetch;
    await expect(pullSynapseModel(endpoint, "llama-3.1-8b")).resolves.toEqual({ ok: true });
    expect(spy.mock.calls[0]?.[0]).toBe("http://127.0.0.1:11435/api/pull");
  });

  it("reports NDJSON progress and finishes on success", async () => {
    const seen: Array<{ status: string; completed?: number; total?: number }> = [];
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          [
            JSON.stringify({ status: "downloading", completed: 10, total: 100 }),
            JSON.stringify({ status: "success" }),
          ].join("\n"),
          { status: 200, headers: { "content-type": "application/x-ndjson" } },
        ),
    ) as unknown as typeof fetch;
    await expect(
      pullSynapseModel(endpoint, "llama-3.1-8b", { onProgress: (p) => seen.push(p) }),
    ).resolves.toEqual({ ok: true });
    expect(seen).toEqual([{ status: "downloading", completed: 10, total: 100 }]);
  });

  it("surfaces a pull error instead of pretending success", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ status: "error", error: "disk full" }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(pullSynapseModel(endpoint, "llama-3.1-8b")).resolves.toEqual({
      ok: false,
      detail: "disk full",
    });
  });

  it("surfaces a non-OK HTTP status", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })) as unknown as typeof fetch;
    await expect(pullSynapseModel(endpoint, "llama-3.1-8b")).resolves.toEqual({
      ok: false,
      detail: "unauthorized",
    });
  });
});

describe("parsePullEvent", () => {
  it("recognises the documented NDJSON shapes", () => {
    expect(parsePullEvent('{"status":"downloading","total":100,"completed":40}')).toEqual({
      status: "downloading",
      total: 100,
      completed: 40,
    });
    expect(parsePullEvent('{"status":"success"}')).toEqual({ done: true });
    expect(parsePullEvent('{"status":"error","error":"no space"}')).toEqual({ error: "no space" });
    expect(parsePullEvent("not json")).toBeNull();
  });
});

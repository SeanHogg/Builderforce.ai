/**
 * The keyless floor.
 *
 * The behaviour that matters is not "it can search" — it is that it does NOT
 * search unless the operator said so. A gateway's contract is that the operator
 * declares which tools may reach the network, so the default has to stay a
 * refusal that NAMES the option rather than an outbound request nobody asked
 * for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __testing } from "./web-search.js";

const { resolveSearchBackend, executeWebSearch, keepPublicHttpUrl, resolveKeylessFallback } = __testing as {
  resolveSearchBackend: (config?: unknown) => unknown;
  executeWebSearch: (backend: unknown, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  keepPublicHttpUrl: (value: unknown) => string | undefined;
  resolveKeylessFallback: (search?: unknown) => boolean;
};

const config = (search: Record<string, unknown>) => ({ tools: { web: { search } } });

/** A stub for whichever endpoint the adapter reaches for. */
function stubFetch(handler: (url: string) => unknown) {
  return vi.fn(async (input: string | URL) => new Response(JSON.stringify(handler(String(input))), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
}

const WIKI = {
  query: {
    search: [
      { title: "Michigan", snippet: 'A <span class="searchmatch">state</span> in the US.' },
      { title: "Detroit", snippet: "Largest city." },
    ],
  },
};

describe("web_search keyless adapter", () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.BRAVE_API_KEY;
    delete process.env.SEARXNG_URL;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...realEnv };
  });

  it("refuses, and names the opt-in, when no key and no fallback flag", async () => {
    globalThis.fetch = stubFetch(() => ({})) as unknown as typeof fetch;
    const result = await executeWebSearch(resolveSearchBackend(config({})), { query: "michigan districts" });
    expect(result.error).toBe("missing_brave_api_key");
    expect(String(result.message)).toContain("keylessFallback");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("searches Wikipedia once the operator opts in", async () => {
    const fetchMock = stubFetch(() => WIKI);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await executeWebSearch(
      resolveSearchBackend(config({ keylessFallback: true })),
      { query: "michigan school districts" },
    );
    expect(result.provider).toBe("keyless");
    expect(result.backing).toBe("wikipedia");
    // Honest about the kind of index that answered.
    expect(result.coverage).toBe("encyclopedic");
    expect(String(result.attribution)).toContain("CC BY-SA");
    const rows = result.results as Array<{ title: string; url: string; description: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.url).toBe("https://en.wikipedia.org/wiki/Michigan");
    // The `<span class="searchmatch">` markup MediaWiki adds is stripped.
    expect(rows[0]?.description).not.toContain("<span");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("en.wikipedia.org");
  });

  it("prefers the operator's own SearXNG, and reports the web coverage it gives", async () => {
    process.env.SEARXNG_URL = "https://searx.example/";
    globalThis.fetch = stubFetch((url) => (url.includes("searx.example")
      ? { results: [{ title: "A page", url: "https://example.com/a", content: "Snippet." }] }
      : WIKI)) as unknown as typeof fetch;

    const result = await executeWebSearch(
      resolveSearchBackend(config({ provider: "keyless" })),
      { query: "michigan school districts" },
    );
    expect(result.backing).toBe("searxng");
    expect(result.coverage).toBe("web");
    expect((result.results as unknown[]).length).toBe(1);
  });

  it("degrades to Wikipedia when the operator's instance is down, rather than failing", async () => {
    process.env.SEARXNG_URL = "https://searx.example";
    globalThis.fetch = vi.fn(async (input: string | URL) => (String(input).includes("searx.example")
      ? new Response("forbidden", { status: 403 })
      : new Response(JSON.stringify(WIKI), { status: 200, headers: { "content-type": "application/json" } })
    )) as unknown as typeof fetch;

    const result = await executeWebSearch(
      resolveSearchBackend(config({ provider: "keyless" })),
      { query: "michigan" },
    );
    expect(result.backing).toBe("wikipedia");
    expect(String(result.degradedFrom)).toContain("formats: [json]");
  });

  it("drops index rows that point inside a private network", () => {
    expect(keepPublicHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(keepPublicHttpUrl("http://127.0.0.1/admin")).toBeUndefined();
    expect(keepPublicHttpUrl("http://10.1.2.3/")).toBeUndefined();
    expect(keepPublicHttpUrl("http://192.168.0.1/")).toBeUndefined();
    expect(keepPublicHttpUrl("http://metadata.internal/")).toBeUndefined();
    expect(keepPublicHttpUrl("file:///etc/passwd")).toBeUndefined();
    expect(keepPublicHttpUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("treats the opt-in as strictly explicit", () => {
    expect(resolveKeylessFallback(undefined)).toBe(false);
    expect(resolveKeylessFallback({})).toBe(false);
    expect(resolveKeylessFallback({ keylessFallback: false })).toBe(false);
    expect(resolveKeylessFallback({ keylessFallback: true })).toBe(true);
  });
});

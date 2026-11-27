import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../gateway/gateway", () => ({ getBaseUrl: () => "https://api.example" }));
const session = vi.hoisted(() => ({ jwt: "tenant.jwt" as string | undefined }));
vi.mock("./session", () => ({
  getTenantJwt: async () => session.jwt,
  refreshTenantJwt: async () => session.jwt,
  onSessionChange: () => undefined,
}));

import { getScopedToken, invalidateScopedTokens, resetScopedTokens, ScopedTokenUnavailableError, setScopedTokenErrorSink } from "./scopedToken";

const realFetch = globalThis.fetch;
const secrets = {} as never;
let clock = 0;
const now = () => clock;

function stubMint(ttlMs: number) {
  let n = 0;
  const fetchMock = vi.fn(async () => {
    n++;
    return new Response(JSON.stringify({ token: `scoped.${n}`, expiresAt: new Date(clock + ttlMs).toISOString() }), { status: 200 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  clock = Date.parse("2026-01-01T00:00:00Z");
  session.jwt = "tenant.jwt";
  resetScopedTokens();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("getScopedToken", () => {
  it("mints once and serves the cache while 2+ minutes remain", async () => {
    const fetchMock = stubMint(15 * 60_000);
    expect(await getScopedToken(secrets, "spawn", now)).toBe("scoped.1");
    clock += 10 * 60_000;
    expect(await getScopedToken(secrets, "spawn", now)).toBe("scoped.1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-mints once less than 2 minutes remain", async () => {
    const fetchMock = stubMint(15 * 60_000);
    await getScopedToken(secrets, "spawn", now);
    clock += 13.5 * 60_000;
    expect(await getScopedToken(secrets, "spawn", now)).toBe("scoped.2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidateScopedTokens drops the cache so the next call mints fresh", async () => {
    const fetchMock = stubMint(15 * 60_000);
    expect(await getScopedToken(secrets, "spawn", now)).toBe("scoped.1");
    invalidateScopedTokens();
    expect(await getScopedToken(secrets, "spawn", now)).toBe("scoped.2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("regression: a mint that resolves after the session changed is not cached and is retried", async () => {
    let n = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    globalThis.fetch = vi.fn(async () => {
      n++;
      const mine = n;
      if (mine === 1) await gate;
      return new Response(JSON.stringify({ token: `scoped.${mine}`, expiresAt: new Date(clock + 15 * 60_000).toISOString() }), { status: 200 });
    }) as unknown as typeof fetch;
    const first = getScopedToken(secrets, "spawn", now);
    await new Promise((r) => setTimeout(r, 0));
    invalidateScopedTokens();
    release();
    expect(await first).toBe("scoped.2");
    expect(await getScopedToken(secrets, "spawn", now)).toBe("scoped.2");
    expect(n).toBe(2);
  });

  it("reports a mint failure to the error sink instead of swallowing it", async () => {
    const sink = vi.fn();
    setScopedTokenErrorSink(sink);
    globalThis.fetch = vi.fn(async () => { throw new Error("boom"); }) as unknown as typeof fetch;
    await expect(getScopedToken(secrets, "spawn", now)).rejects.toBeInstanceOf(ScopedTokenUnavailableError);
    expect(sink).toHaveBeenCalledTimes(1);
    setScopedTokenErrorSink(() => undefined);
  });

  it.each([500, 503, 429])("throws unavailable and reports on HTTP %i", async (status) => {
    const sink = vi.fn();
    setScopedTokenErrorSink(sink);
    globalThis.fetch = vi.fn(async () => new Response("", { status })) as unknown as typeof fetch;
    await expect(getScopedToken(secrets, "spawn", now)).rejects.toBeInstanceOf(ScopedTokenUnavailableError);
    expect(sink).toHaveBeenCalledTimes(1);
    setScopedTokenErrorSink(() => undefined);
  });

  it("returns undefined (no session) and reports on a 401 that survives a refresh", async () => {
    const sink = vi.fn();
    setScopedTokenErrorSink(sink);
    globalThis.fetch = vi.fn(async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    expect(await getScopedToken(secrets, "spawn", now)).toBeUndefined();
    expect(sink).toHaveBeenCalledTimes(1);
    setScopedTokenErrorSink(() => undefined);
  });

  it("returns undefined when signed out and never calls the gateway", async () => {
    const fetchMock = stubMint(15 * 60_000);
    session.jwt = undefined;
    expect(await getScopedToken(secrets, "spawn", now)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

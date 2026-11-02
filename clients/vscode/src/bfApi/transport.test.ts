import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../gateway", () => ({ getBaseUrl: () => "https://api.example" }));
vi.mock("../outboxStorage", () => ({ trackReachability: <T>(p: T) => p }));
vi.mock("./session", () => ({ exchangeJwt: async () => "jwt", tenantOfToken: () => 1 }));
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({ NOT_SIGNED_IN: "not_signed_in" }));

import { fetchAuthed } from "./transport";

let sent: RequestInit | undefined;
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = undefined;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => { sent = init; return new Response("{}"); }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("fetchAuthed's timeout", () => {
  it("bounds a request that passed no signal", async () => {
    await fetchAuthed({} as never, "/api/x", { method: "GET" });
    expect(sent?.signal).toBeInstanceOf(AbortSignal);
  });

  it("leaves the caller's own signal alone", async () => {
    const own = new AbortController().signal;
    await fetchAuthed({} as never, "/api/x", { signal: own });
    expect(sent?.signal).toBe(own);
  });

  it("leaves an upload (FormData) unbounded", async () => {
    await fetchAuthed({} as never, "/api/x", { method: "POST", body: new FormData() });
    expect(sent?.signal).toBeUndefined();
  });
});

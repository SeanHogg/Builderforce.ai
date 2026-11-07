import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../gateway", () => ({ getBaseUrl: () => "https://api.example" }));
vi.mock("../outboxStorage", () => ({ trackReachability: <T>(p: T) => p }));
const current = vi.hoisted(() => ({ workspace: undefined as number | undefined }));
vi.mock("./session", () => ({ exchangeJwt: async () => "jwt", tenantOfToken: () => 1, workspaceTenantId: () => current.workspace }));
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

describe("asTenant: \"current\"", () => {
  it("is refused when no current workspace is known (never sent unpinned)", async () => {
    current.workspace = undefined;
    await expect(fetchAuthed({} as never, "/api/x", { asTenant: "current" })).rejects.toThrow(/no current workspace/);
    expect(sent).toBeUndefined();
  });

  it("is refused when the token acts as another tenant than the current workspace", async () => {
    current.workspace = 2; // the mocked token acts as tenant 1
    await expect(fetchAuthed({} as never, "/api/x", { asTenant: "current" })).rejects.toThrow(/not the current workspace/);
  });

  it("is sent when the token acts as the current workspace", async () => {
    current.workspace = 1;
    await fetchAuthed({} as never, "/api/x", { asTenant: "current" });
    expect(sent).toBeDefined();
  });
});

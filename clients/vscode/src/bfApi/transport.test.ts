import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({ l10n: { t: (m: string) => m } }));
vi.mock("../gateway", () => ({ getBaseUrl: () => "https://api.example" }));
vi.mock("../outboxStorage", () => ({ trackReachability: <T>(p: T) => p }));
const current = vi.hoisted(() => ({ workspace: undefined as number | undefined }));
vi.mock("./session", () => ({ exchangeJwt: async () => "jwt", tenantOfToken: () => 1, workspaceTenantId: () => current.workspace }));
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({ NOT_SIGNED_IN: "not_signed_in" }));

import { fetchAuthed, isWorkspaceParked, WorkspaceParkedError } from "./transport";

let sent: RequestInit | undefined;
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = undefined;
  current.workspace = 1; // the mocked token acts as tenant 1; the default is now "current"
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
  it("throws a WorkspaceParkedError carrying the code, without \"write parked\" wording", async () => {
    current.workspace = 2;
    const error = await fetchAuthed({} as never, "/api/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkspaceParkedError);
    expect((error as WorkspaceParkedError).code).toBe("workspace_parked");
    expect((error as Error).message).not.toMatch(/write parked/);
    expect(isWorkspaceParked(error)).toBe(true);
    expect(isWorkspaceParked(new Error("boom"))).toBe(false);
  });

  it("is refused when no current workspace is known (never sent unpinned)", async () => {
    current.workspace = undefined;
    await expect(fetchAuthed({} as never, "/api/x", { asTenant: "current" })).rejects.toBeInstanceOf(WorkspaceParkedError);
    expect(sent).toBeUndefined();
  });

  it("is refused when the token acts as another tenant than the current workspace", async () => {
    current.workspace = 2; // the mocked token acts as tenant 1
    await expect(fetchAuthed({} as never, "/api/x", { asTenant: "current" })).rejects.toMatchObject({ code: "workspace_parked" });
  });

  it("is sent when the token acts as the current workspace", async () => {
    current.workspace = 1;
    await fetchAuthed({} as never, "/api/x", { asTenant: "current" });
    expect(sent).toBeDefined();
  });
});

describe("the default asTenant (omitted = \"current\", fail closed)", () => {
  it("is refused on a mismatch without naming asTenant", async () => {
    current.workspace = 2; // the mocked token acts as tenant 1 (a parked re-scope)
    await expect(fetchAuthed({} as never, "/api/x")).rejects.toBeInstanceOf(WorkspaceParkedError);
    expect(sent).toBeUndefined();
  });

  it("is refused when no current workspace is known", async () => {
    current.workspace = undefined;
    await expect(fetchAuthed({} as never, "/api/x", { method: "POST" })).rejects.toMatchObject({ code: "workspace_parked" });
    expect(sent).toBeUndefined();
  });

  it("is sent when the token acts as the current workspace", async () => {
    current.workspace = 1;
    await fetchAuthed({} as never, "/api/x");
    expect(sent).toBeDefined();
  });

  it("still honours a numeric pin", async () => {
    current.workspace = 1;
    await expect(fetchAuthed({} as never, "/api/x", { asTenant: 3 })).rejects.toBeInstanceOf(WorkspaceParkedError);
  });
});

describe("asTenant: \"any\" (explicit opt-out)", () => {
  it("is sent regardless of the current workspace", async () => {
    current.workspace = 2;
    await fetchAuthed({} as never, "/api/x", { asTenant: "any" });
    expect(sent).toBeDefined();
    current.workspace = undefined;
    sent = undefined;
    await fetchAuthed({} as never, "/api/x", { asTenant: "any" });
    expect(sent).toBeDefined();
  });
});

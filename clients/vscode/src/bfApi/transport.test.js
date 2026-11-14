import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({ l10n: { t: (m) => m } }));
vi.mock("../gateway", () => ({ getBaseUrl: () => "https://api.example" }));
vi.mock("../outboxStorage", () => ({ trackReachability: (p) => p }));
const current = vi.hoisted(() => ({ workspace: undefined }));
vi.mock("./session", () => ({ exchangeJwt: async () => "jwt", tenantOfToken: () => 1, workspaceTenantId: () => current.workspace }));
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({ NOT_SIGNED_IN: "not_signed_in" }));
import { fetchAuthed, isWorkspaceParked, WorkspaceParkedError } from "./transport";
let sent;
const realFetch = globalThis.fetch;
beforeEach(() => {
    sent = undefined;
    current.workspace = 1; // the mocked token acts as tenant 1; the default is now "current"
    globalThis.fetch = (async (_url, init) => { sent = init; return new Response("{}"); });
});
afterEach(() => { globalThis.fetch = realFetch; });
describe("fetchAuthed's timeout", () => {
    it("bounds a request that passed no signal", async () => {
        await fetchAuthed({}, "/api/x", { method: "GET" });
        expect(sent?.signal).toBeInstanceOf(AbortSignal);
    });
    it("leaves the caller's own signal alone", async () => {
        const own = new AbortController().signal;
        await fetchAuthed({}, "/api/x", { signal: own });
        expect(sent?.signal).toBe(own);
    });
    it("leaves an upload (FormData) unbounded", async () => {
        await fetchAuthed({}, "/api/x", { method: "POST", body: new FormData() });
        expect(sent?.signal).toBeUndefined();
    });
});
describe("asTenant: \"current\"", () => {
    it("throws a WorkspaceParkedError carrying the code, without \"write parked\" wording", async () => {
        current.workspace = 2;
        const error = await fetchAuthed({}, "/api/x").catch((e) => e);
        expect(error).toBeInstanceOf(WorkspaceParkedError);
        expect(error.code).toBe("workspace_parked");
        expect(error.message).not.toMatch(/write parked/);
        expect(isWorkspaceParked(error)).toBe(true);
        expect(isWorkspaceParked(new Error("boom"))).toBe(false);
    });
    it("is refused when no current workspace is known (never sent unpinned)", async () => {
        current.workspace = undefined;
        await expect(fetchAuthed({}, "/api/x", { asTenant: "current" })).rejects.toBeInstanceOf(WorkspaceParkedError);
        expect(sent).toBeUndefined();
    });
    it("is refused when the token acts as another tenant than the current workspace", async () => {
        current.workspace = 2; // the mocked token acts as tenant 1
        await expect(fetchAuthed({}, "/api/x", { asTenant: "current" })).rejects.toMatchObject({ code: "workspace_parked" });
    });
    it("is sent when the token acts as the current workspace", async () => {
        current.workspace = 1;
        await fetchAuthed({}, "/api/x", { asTenant: "current" });
        expect(sent).toBeDefined();
    });
});
describe("the default asTenant (omitted = \"current\", fail closed)", () => {
    it("is refused on a mismatch without naming asTenant", async () => {
        current.workspace = 2; // the mocked token acts as tenant 1 (a parked re-scope)
        await expect(fetchAuthed({}, "/api/x")).rejects.toBeInstanceOf(WorkspaceParkedError);
        expect(sent).toBeUndefined();
    });
    it("is refused when no current workspace is known", async () => {
        current.workspace = undefined;
        await expect(fetchAuthed({}, "/api/x", { method: "POST" })).rejects.toMatchObject({ code: "workspace_parked" });
        expect(sent).toBeUndefined();
    });
    it("is sent when the token acts as the current workspace", async () => {
        current.workspace = 1;
        await fetchAuthed({}, "/api/x");
        expect(sent).toBeDefined();
    });
    it("still honours a numeric pin", async () => {
        current.workspace = 1;
        await expect(fetchAuthed({}, "/api/x", { asTenant: 3 })).rejects.toBeInstanceOf(WorkspaceParkedError);
    });
});
describe("asTenant: \"any\" (explicit opt-out)", () => {
    it("is sent regardless of the current workspace", async () => {
        current.workspace = 2;
        await fetchAuthed({}, "/api/x", { asTenant: "any" });
        expect(sent).toBeDefined();
        current.workspace = undefined;
        sent = undefined;
        await fetchAuthed({}, "/api/x", { asTenant: "any" });
        expect(sent).toBeDefined();
    });
});
//# sourceMappingURL=transport.test.js.map
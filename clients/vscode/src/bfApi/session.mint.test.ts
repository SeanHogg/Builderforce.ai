import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  EventEmitter: class {
    private listeners: Array<(e: unknown) => void> = [];
    event = (l: (e: unknown) => void) => { this.listeners.push(l); return { dispose: () => undefined }; };
    fire(e: unknown) { for (const l of this.listeners) l(e); }
  },
}));
vi.mock("../gateway", () => ({ getApiKey: async () => "bfk_stored", getBaseUrl: () => "https://api.example" }));
vi.mock("../outboxStorage", () => ({ setOutboxScope: () => undefined, trackReachability: <T>(p: T) => p }));

import { onWorkspaceRefused } from "../gatewayAuth";
import { getCurrentWorkspace } from "../workspaceSelection";
import {
  clearJwt,
  dropWorkspaceSelection,
  exchangeJwt,
  onEditorKeyRejected,
  onWorkspaceDropped,
  setSelectedWorkspace,
} from "./session";

const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const baseOk = () => json({ token: "base.jwt", expiresIn: 3600, tenantId: 1 });

/** The base exchange answers for tenant 1; each re-scope POST takes the next queued answer. */
function stubApi(...rescopes: Response[]) {
  const queue = [...rescopes];
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url).includes("/tenant-api-key-token") ? "base" : "rescope");
    return String(url).includes("/tenant-api-key-token") ? baseOk() : queue.shift() ?? json({}, 500);
  }) as typeof fetch;
  return calls;
}

/** Answers requests strictly in order, whatever the URL; records which endpoint each hit. */
function stubSequence(...answers: Response[]) {
  const queue = [...answers];
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url).includes("/tenant-api-key-token") ? "base" : "rescope");
    return queue.shift() ?? json({}, 500);
  }) as typeof fetch;
  return calls;
}

describe("mintJwt re-scope", () => {
  const dropped = vi.fn();
  const refused = vi.fn();
  let offDropped: () => void;
  let offRefused: () => void;

  beforeEach(() => {
    clearJwt();
    setSelectedWorkspace(undefined);
    dropped.mockReset();
    refused.mockReset();
    offDropped = onWorkspaceDropped(dropped);
    offRefused = onWorkspaceRefused(refused);
    setSelectedWorkspace(7);
  });
  afterEach(() => {
    offDropped();
    offRefused();
    globalThis.fetch = realFetch;
  });

  it("editor_key_required goes to the editor-key refusal path (naming the workspace), not a silent drop", async () => {
    stubApi(json({ error: "x", code: "editor_key_required" }, 403));
    expect(await exchangeJwt({} as never)).toBe("base.jwt");
    expect(refused).toHaveBeenCalledWith({ refusal: "editor_key_required", key: "bfk_stored", workspace: 7 });
    expect(dropped).not.toHaveBeenCalled();
  });

  it("a plain 403 (no longer a member) still drops the selection", async () => {
    stubApi(json({ error: "Not a member of this workspace" }, 403));
    expect(await exchangeJwt({} as never)).toBe("base.jwt");
    expect(dropped).toHaveBeenCalledWith(7);
    expect(refused).not.toHaveBeenCalled();
  });

  it("session_stale re-mints the base ONCE and asks again, never touching the editor-key path", async () => {
    const calls = stubApi(json({ code: "session_stale" }, 403), json({ token: "scoped.jwt", expiresIn: 3600 }));
    expect(await exchangeJwt({} as never)).toBe("scoped.jwt");
    expect(calls).toEqual(["base", "rescope", "base", "rescope"]);
    expect(refused).not.toHaveBeenCalled();
    expect(dropped).not.toHaveBeenCalled();
  });

  it("a second session_stale does not loop: it parks on the base token", async () => {
    const calls = stubApi(json({ code: "session_stale" }, 403), json({ code: "session_stale" }, 403));
    expect(await exchangeJwt({} as never)).toBe("base.jwt");
    expect(calls).toEqual(["base", "rescope", "base", "rescope"]);
    expect(refused).not.toHaveBeenCalled();
  });

  it("a 401 re-mints the base once and, on success, completes the re-scope", async () => {
    const calls = stubSequence(baseOk(), json({}, 401), baseOk(), json({ token: "scoped.jwt", expiresIn: 3600 }));
    expect(await exchangeJwt({} as never)).toBe("scoped.jwt");
    expect(calls).toEqual(["base", "rescope", "base", "rescope"]);
  });

  it("a second 401 parks on the base token without looping", async () => {
    const calls = stubSequence(baseOk(), json({}, 401), baseOk(), json({}, 401));
    expect(await exchangeJwt({} as never)).toBe("base.jwt");
    expect(calls).toEqual(["base", "rescope", "base", "rescope"]);
    expect(dropped).not.toHaveBeenCalled();
  });

  it("a 401 whose key exchange is then rejected fires onEditorKeyRejected and keeps the selection", async () => {
    const rejected = vi.fn();
    onEditorKeyRejected(rejected);
    const calls = stubSequence(baseOk(), json({}, 401), json({}, 401));
    await exchangeJwt({} as never);
    expect(calls).toEqual(["base", "rescope", "base"]);
    expect(rejected).toHaveBeenCalledWith("bfk_stored");
    expect(dropped).not.toHaveBeenCalled();
    expect(getCurrentWorkspace()).toBe(7);
  });

  it("an unreachable re-exchange after session_stale falls back to the still-valid base token", async () => {
    const calls = stubSequence(baseOk(), json({ code: "session_stale" }, 403), json({}, 503));
    expect(await exchangeJwt({} as never)).toBe("base.jwt");
    expect(calls).toEqual(["base", "rescope", "base"]);
  });

  it("a drop for a workspace that is no longer the selection is ignored", () => {
    dropWorkspaceSelection(99);
    expect(dropped).not.toHaveBeenCalled();
    expect(getCurrentWorkspace()).toBe(7);
  });
});

describe("the workspace the gateway names always follows the selection", () => {
  beforeEach(() => {
    clearJwt();
    setSelectedWorkspace(undefined);
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("is the selection as soon as it is set, before any exchange", () => {
    setSelectedWorkspace(7);
    expect(getCurrentWorkspace()).toBe(7);
  });

  it("stays the selection after a successful mint", async () => {
    setSelectedWorkspace(7);
    stubApi(json({ token: "scoped.jwt", expiresIn: 3600 }));
    await exchangeJwt({} as never);
    expect(getCurrentWorkspace()).toBe(7);
  });

  it("stays the selection while re-scope writes are parked (a failed re-scope)", async () => {
    setSelectedWorkspace(7);
    stubApi(json({}, 500));
    await exchangeJwt({} as never);
    expect(getCurrentWorkspace()).toBe(7);
  });

  it("clearJwt (a re-key) keeps the selection; signing out (clearing it) clears it", () => {
    setSelectedWorkspace(7);
    clearJwt();
    expect(getCurrentWorkspace()).toBe(7);
    setSelectedWorkspace(undefined);
    expect(getCurrentWorkspace()).toBeUndefined();
  });

  it("falls back to the key's own workspace when the selection is dropped", async () => {
    setSelectedWorkspace(7);
    stubApi(json({ error: "Not a member" }, 403));
    await exchangeJwt({} as never);
    expect(getCurrentWorkspace()).toBe(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scopes = vi.hoisted(() => [] as Array<number | undefined>);

vi.mock("vscode", () => ({
  EventEmitter: class {
    private listeners: Array<(e: unknown) => void> = [];
    event = (l: (e: unknown) => void) => { this.listeners.push(l); return { dispose: () => undefined }; };
    fire(e: unknown) { for (const l of this.listeners) l(e); }
  },
}));
vi.mock("../gateway", () => ({ getApiKey: async () => "bfk_stored", getBaseUrl: () => "https://api.example" }));
vi.mock("../outboxStorage", () => ({
  setOutboxScope: (ids: { workspace: number | undefined }) => { scopes.push(ids.workspace); },
  trackReachability: <T>(p: T) => p,
}));

import { clearJwt, exchangeJwt, setSelectedWorkspace } from "./session";

const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Base exchange answers for tenant 1; each re-scope takes the next queued answer. */
function stubApi(...rescopes: Response[]) {
  const queue = [...rescopes];
  globalThis.fetch = (async (url: string) =>
    String(url).includes("/tenant-api-key-token")
      ? json({ token: "base.jwt", expiresIn: 3600, tenantId: 1 })
      : queue.shift() ?? json({}, 500)) as typeof fetch;
}

const lastScope = () => scopes[scopes.length - 1];

describe("durable writes only replay into a tenant we hold a token for", () => {
  beforeEach(() => {
    clearJwt();
    setSelectedWorkspace(undefined);
    scopes.length = 0;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("regression: editor_key_required parks workspace writes synchronously (no replay of B's writes on A's token)", async () => {
    setSelectedWorkspace(7);
    stubApi(json({ error: "x", code: "editor_key_required" }, 403));
    expect(await exchangeJwt({} as never)).toBe("base.jwt");
    // The base mint must never have opened tenant 7's queue, and it ends parked.
    expect(scopes).not.toContain(7);
    expect(lastScope()).toBeUndefined();
  });

  it("regression: a forced re-mint after a refused re-scope stays parked until a re-scope succeeds", async () => {
    setSelectedWorkspace(7);
    stubApi(json({ token: "scoped.jwt", expiresIn: 3600 }), json({ error: "x", code: "editor_key_required" }, 403));
    expect(await exchangeJwt({} as never)).toBe("scoped.jwt");
    expect(lastScope()).toBe(7);
    expect(await exchangeJwt({} as never, true)).toBe("base.jwt");
    expect(lastScope()).toBeUndefined();
  });

  it("selecting another workspace parks until its re-scoped token is minted, then opens it", async () => {
    setSelectedWorkspace(7);
    expect(lastScope()).toBeUndefined();
    stubApi(json({ token: "scoped.jwt", expiresIn: 3600 }));
    await exchangeJwt({} as never);
    expect(scopes.filter((s) => s !== undefined)).toEqual([7]);
  });

  it("the key's own workspace opens as soon as the base token is minted", async () => {
    stubApi();
    await exchangeJwt({} as never);
    expect(lastScope()).toBe(1);
  });
});

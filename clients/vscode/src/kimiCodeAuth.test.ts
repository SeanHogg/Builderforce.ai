import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  classifyCredential,
  loadCredential,
  refreshThresholdSeconds,
  saveCredential,
  type KimiCredentialFs,
} from "./kimiCodeCredentials";
import {
  KIMI_OAUTH_CLIENT_ID,
  ensureFreshKimiToken,
  kimiOAuthHost,
  refreshKimiAccessToken,
  resetKimiTokenRefreshState,
} from "./kimiCodeAuth";

/**
 * Kimi's credential is a FOREIGN file that Kimi Code also writes, and its refresh token
 * ROTATES on every grant. That combination is why these tests exist: getting the format
 * or the rotation wrong does not degrade this extension, it breaks the user's own Kimi
 * Code install. The shapes below are the real ones, read from the shipped client.
 */

const HOME = path.join("/tmp", "kimi-home");
const CRED_DIR = path.join(HOME, "credentials");
const CRED_PATH = path.join(CRED_DIR, "kimi-code.json");
const NOW = 1_788_640_000_000;

function record(expiresAtSeconds: number, access = "a".repeat(704), refresh = "r".repeat(705)) {
  return {
    access_token: access,
    refresh_token: refresh,
    expires_at: expiresAtSeconds,
    scope: "coding",
    token_type: "Bearer",
    expires_in: 900,
  };
}

/** In-memory install that also records what was written, so the write protocol is
 *  observable (temp file first, rename over the target — never a direct write). */
function fakeFs(files: Record<string, string>) {
  const written: Array<{ target: string; data: string; mode: number }> = [];
  const renames: Array<{ from: string; to: string }> = [];
  const store = { ...files };
  const fs: KimiCredentialFs = {
    existsSync: (t) => t === CRED_DIR || t in store,
    readFileSync: (t) => {
      if (!(t in store)) throw new Error(`ENOENT ${t}`);
      return store[t]!;
    },
    readdirSync: () => Object.keys(store).filter((k) => k.startsWith(CRED_DIR)).map((k) => path.basename(k)),
    mkdirSync: () => {},
    writeFileSync: (t, data, opts) => {
      written.push({ target: t, data, mode: opts.mode });
      store[t] = data;
    },
    renameSync: (from, to) => {
      renames.push({ from, to });
      store[to] = store[from]!;
      delete store[from];
    },
    unlinkSync: (t) => { delete store[t]; },
  };
  return { fs, store, written, renames };
}

beforeEach(() => resetKimiTokenRefreshState());

describe("refresh threshold", () => {
  it("matches Kimi Code's own rule: max(300s, half the grant)", () => {
    // Copied rather than invented — two clients refreshing a ROTATING credential on
    // different schedules is how one ends up holding a retired refresh token.
    expect(refreshThresholdSeconds(900)).toBe(450);
    expect(refreshThresholdSeconds(120)).toBe(300);
    expect(refreshThresholdSeconds(0)).toBe(300);
  });

  it("calls a token inside the window stale while it is still technically valid", () => {
    // 400s of life left on a 900s grant: usable this second, gone before a long stream
    // finishes. Kimi replaces it at the halfway mark and so do we.
    expect(classifyCredential(
      { accessToken: "a", refreshToken: "r", expiresAt: 1_788_640_400, scope: "", tokenType: "Bearer", expiresIn: 900 },
      NOW,
    ).kind).toBe("stale");
  });
});

describe("credential store", () => {
  it("reads Kimi's wire format", () => {
    const { fs } = fakeFs({ [CRED_PATH]: JSON.stringify(record(1_788_640_600)) });
    const state = loadCredential(fs, HOME, NOW);
    expect(state.kind).toBe("fresh");
  });

  it("treats an empty access_token as the signed-out tombstone", () => {
    const { fs } = fakeFs({ [CRED_PATH]: JSON.stringify(record(0, "", "")) });
    expect(loadCredential(fs, HOME, NOW).kind).toBe("revoked");
  });

  it("names the fields of an unfamiliar shape without leaking a value", () => {
    const { fs } = fakeFs({ [CRED_PATH]: JSON.stringify({ blob: "s".repeat(50), kind: "oauth" }) });
    const state = loadCredential(fs, HOME, NOW);
    expect(state.kind).toBe("unreadable");
    const detail = (state as { detail: string }).detail;
    expect(detail).toContain("blob");
    expect(detail).not.toContain("s".repeat(50));
  });

  it("writes through a temp file and renames — never straight over the target", () => {
    // A half-written credential signs the user out of Kimi Code too, so the rename is the
    // only moment the real path changes.
    const { fs, written, renames } = fakeFs({});
    saveCredential(fs, HOME, {
      accessToken: "new", refreshToken: "rot", expiresAt: 1_788_641_000,
      scope: "coding", tokenType: "Bearer", expiresIn: 900,
    });
    expect(written).toHaveLength(1);
    expect(written[0]!.target).not.toBe(CRED_PATH);
    expect(written[0]!.target.startsWith(`${CRED_PATH}.tmp.`)).toBe(true);
    expect(written[0]!.mode).toBe(0o600);
    expect(renames).toEqual([{ from: written[0]!.target, to: CRED_PATH }]);
  });

  it("round-trips through Kimi's exact snake_case wire fields", () => {
    // A file we write must be indistinguishable from one Kimi Code wrote, or Kimi Code
    // stops being able to read its own store.
    const { fs, store, written } = fakeFs({});
    saveCredential(fs, HOME, {
      accessToken: "acc", refreshToken: "ref", expiresAt: 1_788_641_000,
      scope: "coding", tokenType: "Bearer", expiresIn: 900,
    });
    expect(Object.keys(JSON.parse(written[0]!.data)).sort()).toEqual([
      "access_token", "expires_at", "expires_in", "refresh_token", "scope", "token_type",
    ]);
    expect(store[CRED_PATH]!.endsWith("\n")).toBe(true);
  });
});

describe("the refresh grant", () => {
  it("posts the form Kimi Code posts, to Kimi's token endpoint", async () => {
    let seen: { url: string; body: string; headers: Record<string, string> } | null = null;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      seen = { url, body: init.body as string, headers: init.headers as Record<string, string> };
      return new Response(JSON.stringify({ access_token: "new-a", refresh_token: "new-r", expires_in: 900, scope: "coding", token_type: "Bearer" }), { status: 200 });
    });
    const result = await refreshKimiAccessToken("old-r", { fetchImpl, nowMs: NOW });

    expect(seen!.url).toBe("https://auth.kimi.com/api/oauth/token");
    expect(seen!.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(seen!.body);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("old-r");
    expect(form.get("client_id")).toBe(KIMI_OAUTH_CLIENT_ID);
    // expires_at is derived from OUR clock plus the grant, exactly as Kimi derives it.
    expect(result).toMatchObject({ kind: "refreshed", record: { expiresAt: Math.floor(NOW / 1000) + 900 } });
  });

  it("keeps the ROTATED refresh token, not the one it presented", async () => {
    // The whole reason this module writes: the server retires the presented token.
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "a", refresh_token: "rotated", expires_in: 900 }), { status: 200 }));
    const result = await refreshKimiAccessToken("presented", { fetchImpl, nowMs: NOW });
    expect(result).toMatchObject({ kind: "refreshed", record: { refreshToken: "rotated" } });
  });

  it("falls back to the presented token when the server rotates nothing", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "a", expires_in: 900 }), { status: 200 }));
    expect(await refreshKimiAccessToken("presented", { fetchImpl, nowMs: NOW }))
      .toMatchObject({ kind: "refreshed", record: { refreshToken: "presented" } });
  });

  it("classifies invalid_grant as unauthorized, and a 503 as merely unavailable", async () => {
    // Different remedies: one needs a new sign-in, the other needs a retry.
    const denied = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    expect(await refreshKimiAccessToken("r", { fetchImpl: denied })).toMatchObject({ kind: "unauthorized" });
    const down = vi.fn(async () => new Response("", { status: 503 }));
    expect(await refreshKimiAccessToken("r", { fetchImpl: down })).toMatchObject({ kind: "unavailable" });
  });

  it("honours Kimi Code's own host overrides", () => {
    expect(kimiOAuthHost({ KIMI_CODE_OAUTH_HOST: "https://staging.example/" } as NodeJS.ProcessEnv))
      .toBe("https://staging.example");
    expect(kimiOAuthHost({} as NodeJS.ProcessEnv)).toBe("https://auth.kimi.com");
  });
});

describe("ensureFreshKimiToken", () => {
  it("uses a fresh credential with NO network call and NO write", async () => {
    const { fs, written } = fakeFs({ [CRED_PATH]: JSON.stringify(record(1_788_640_600)) });
    const fetchImpl = vi.fn();
    const result = await ensureFreshKimiToken(fs, HOME, { fetchImpl, nowMs: () => NOW });
    expect(result).toEqual({ kind: "token", accessToken: "a".repeat(704) });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(written).toHaveLength(0);
  });

  it("refreshes a stale credential and PERSISTS the rotation", async () => {
    const { fs, store } = fakeFs({ [CRED_PATH]: JSON.stringify(record(1_788_639_592)) });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "fresh-a", refresh_token: "fresh-r", expires_in: 900 }), { status: 200 }));
    const result = await ensureFreshKimiToken(fs, HOME, { fetchImpl, nowMs: () => NOW });

    expect(result).toEqual({ kind: "token", accessToken: "fresh-a" });
    // Persisted, or Kimi Code would keep presenting a refresh token the server retired.
    expect(JSON.parse(store[CRED_PATH]!)).toMatchObject({ access_token: "fresh-a", refresh_token: "fresh-r" });
  });

  it("collapses concurrent callers onto ONE grant", async () => {
    // Two turns starting together must not both spend the rotating token — the second
    // grant would present one the first had already rotated away.
    const { fs } = fakeFs({ [CRED_PATH]: JSON.stringify(record(1_788_639_592)) });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "one", refresh_token: "r2", expires_in: 900 }), { status: 200 }));
    const [a, b] = await Promise.all([
      ensureFreshKimiToken(fs, HOME, { fetchImpl, nowMs: () => NOW }),
      ensureFreshKimiToken(fs, HOME, { fetchImpl, nowMs: () => NOW }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("recovers when another process won the rotation race", async () => {
    // Windows has no cross-process lock (Kimi disables it there), so losing the race is
    // expected. The winner has already written a good credential — re-read and use it.
    const { fs, store } = fakeFs({ [CRED_PATH]: JSON.stringify(record(1_788_639_592)) });
    const fetchImpl = vi.fn(async () => {
      store[CRED_PATH] = JSON.stringify(record(1_788_640_800, "winner-token"));
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    });
    expect(await ensureFreshKimiToken(fs, HOME, { fetchImpl, nowMs: () => NOW }))
      .toEqual({ kind: "token", accessToken: "winner-token" });
  });

  it("reports a genuine sign-out rather than looping", async () => {
    const { fs } = fakeFs({ [CRED_PATH]: JSON.stringify(record(1_788_639_592)) });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    expect(await ensureFreshKimiToken(fs, HOME, { fetchImpl, nowMs: () => NOW }))
      .toMatchObject({ kind: "signed_out" });
  });

  it("still returns the token when persisting it fails", async () => {
    // A working request must not be traded for a bookkeeping problem.
    const { fs } = fakeFs({ [CRED_PATH]: JSON.stringify(record(1_788_639_592)) });
    const broken: KimiCredentialFs = { ...fs, writeFileSync: () => { throw new Error("EACCES"); } };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "ok-a", refresh_token: "r", expires_in: 900 }), { status: 200 }));
    expect(await ensureFreshKimiToken(broken, HOME, { fetchImpl, nowMs: () => NOW }))
      .toEqual({ kind: "token", accessToken: "ok-a" });
  });
});

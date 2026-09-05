import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  isKimiCodeInstall,
  loadKimiCodeInstall,
  parseKimiCodeConfig,
  resolveKimiCodeHome,
  resolveKimiToken,
  type KimiCodeFs,
} from "./kimiCodeInstall";

// The real file this reader was written against, reduced to the tables it reads and with
// the credential blanked — which is itself the load-bearing detail: Kimi leaves `api_key`
// EMPTY in config.toml and keeps the live token in its OAuth file store. A reader that
// stopped at `api_key` would find nothing and silently offer no Kimi models.
const CONFIG = `default_model = "kimi-code/kimi-for-coding"

[providers."managed:kimi-code"]
type = "kimi"
api_key = ""
base_url = "https://api.kimi.com/coding/v1"

[providers."managed:kimi-code".oauth]
storage = "file"
key = "kimi-code"

[models."kimi-code/kimi-for-coding"]
provider = "managed:kimi-code"
model = "kimi-for-coding"
max_context_size = 262144
capabilities = [ "thinking", "always_thinking", "image_in", "video_in", "tool_use" ]
display_name = "K2.7 Coding"

[models."kimi-code/k3"]
provider = "managed:kimi-code"
model = "k3"
max_context_size = 1048576
capabilities = [ "thinking", "tool_use" ]
display_name = "K3"
support_efforts = [ "low", "high", "max" ]
default_effort = "high"

[thinking]
enabled = true
effort = "high"

[services.moonshot_search]
base_url = "https://api.kimi.com/coding/v1/search"
api_key = ""
`;

/** An in-memory install. Paths are compared with `path.join` so the fixture matches on
 *  whichever separator the host platform uses. */
function fakeFs(files: Record<string, string>, dirs: Record<string, string[]> = {}): KimiCodeFs {
  return {
    existsSync: (target) => target in files || target in dirs,
    readFileSync: (target) => {
      if (!(target in files)) throw new Error(`ENOENT: ${target}`);
      return files[target]!;
    },
    readdirSync: (target) => dirs[target] ?? [],
  };
}

const HOME = path.join("/tmp", "kimi-home");
const CONFIG_PATH = path.join(HOME, "config.toml");
const CRED_DIR = path.join(HOME, "credentials");
const CRED_PATH = path.join(CRED_DIR, "kimi-code.json");
const env = { KIMI_CODE_HOME: HOME } as NodeJS.ProcessEnv;

describe("resolveKimiCodeHome", () => {
  it("honours KIMI_CODE_HOME — the only relocation Kimi documents", () => {
    expect(resolveKimiCodeHome({ KIMI_CODE_HOME: "/custom/home" } as NodeJS.ProcessEnv)).toBe("/custom/home");
  });

  it("falls back to ~/.kimi-code", () => {
    expect(resolveKimiCodeHome({} as NodeJS.ProcessEnv, () => "/home/dev")).toBe(
      path.join("/home/dev", ".kimi-code"),
    );
  });

  it("treats a blank variable as unset rather than as the empty path", () => {
    expect(resolveKimiCodeHome({ KIMI_CODE_HOME: "   " } as NodeJS.ProcessEnv, () => "/home/dev")).toBe(
      path.join("/home/dev", ".kimi-code"),
    );
  });
});

describe("parseKimiCodeConfig", () => {
  it("reads the completions base URL from the provider table", () => {
    expect(parseKimiCodeConfig(CONFIG).baseUrl).toBe("https://api.kimi.com/coding/v1");
  });

  it("does NOT let a SERVICE base URL win — those are different APIs", () => {
    // `[services.moonshot_search]` also declares a base_url, and it points at /v1/search.
    // Reading the last one seen would send completions to the search endpoint.
    expect(parseKimiCodeConfig(CONFIG).baseUrl).not.toContain("/search");
  });

  it("survives the provider table being closed by its own .oauth child", () => {
    // `base_url` sits in the parent table AFTER nothing, but the child follows it; a
    // strict `=== '[providers."managed:kimi-code"]'` header match on a file that ordered
    // them the other way would lose the URL. Prefix matching keeps the parent open.
    const reordered = CONFIG.replace(
      '[providers."managed:kimi-code"]\ntype = "kimi"\napi_key = ""\nbase_url = "https://api.kimi.com/coding/v1"',
      '[providers."managed:kimi-code"]\ntype = "kimi"\nbase_url = "https://api.kimi.com/coding/v1"\napi_key = ""',
    );
    expect(parseKimiCodeConfig(reordered).baseUrl).toBe("https://api.kimi.com/coding/v1");
  });

  it("reads the model table with Kimi's own display names and context sizes", () => {
    expect(parseKimiCodeConfig(CONFIG).models).toEqual([
      { model: "kimi-for-coding", displayName: "K2.7 Coding", maxContextSize: 262144 },
      { model: "k3", displayName: "K3", maxContextSize: 1048576 },
    ]);
  });

  it("prefers the table's `model` field over the id in the header", () => {
    // The header carries Kimi's REF (`kimi-code/<id>`); the field carries what its API
    // expects on the wire. Sending the ref would 404 on a perfectly good account.
    const aliased = `[models."kimi-code/some-alias"]\nmodel = "k3-256k"\ndisplay_name = "K3-256k"\n`;
    expect(parseKimiCodeConfig(aliased).models[0]).toMatchObject({ model: "k3-256k" });
  });

  it("returns no endpoint for a file that declares none, rather than throwing", () => {
    expect(parseKimiCodeConfig("# nothing here\n")).toEqual({ baseUrl: null, models: [] });
  });
});

describe("resolveKimiToken", () => {
  it("reads the OAuth access token", () => {
    const raw = JSON.stringify({ access_token: "kc-".padEnd(48, "x"), token_type: "Bearer" });
    expect(resolveKimiToken(raw)).toEqual({ token: "kc-".padEnd(48, "x") });
  });

  it("finds a token nested under a profile key", () => {
    const raw = JSON.stringify({ "managed:kimi-code": { accessToken: "y".repeat(40) } });
    expect(resolveKimiToken(raw)).toEqual({ token: "y".repeat(40) });
  });

  it("ignores short enum-ish strings that share a field name", () => {
    // `token_type: "Bearer"` must never be mistaken for the credential.
    const raw = JSON.stringify({ token: "Bearer", access_token: "z".repeat(40) });
    expect(resolveKimiToken(raw)).toEqual({ token: "z".repeat(40) });
  });

  it("names the fields it saw when no token matches — and leaks no values", () => {
    // The whole point: an unknown store shape must produce ONE actionable sentence, not
    // an empty model picker. The user can read this and tell us the field name.
    const result = resolveKimiToken(JSON.stringify({ credential_blob: "q".repeat(40), kind: "oauth" }));
    expect(result).toMatchObject({ reason: "no_credential" });
    const detail = (result as { detail: string }).detail;
    expect(detail).toContain("credential_blob");
    expect(detail).toContain("kind");
    expect(detail).not.toContain("q".repeat(40));
  });

  it("reports an expired login rather than sending a dead token", () => {
    const raw = JSON.stringify({ access_token: "a".repeat(40), expires_at: 1_000 });
    expect(resolveKimiToken(raw, 2_000_000)).toMatchObject({ reason: "expired" });
  });

  it("reads a SECONDS expiry as seconds and a MILLISECONDS one as milliseconds", () => {
    const now = 1_800_000_000_000; // ms
    const future = { access_token: "a".repeat(40), expires_at: 1_900_000_000 }; // seconds
    expect(resolveKimiToken(JSON.stringify(future), now)).toHaveProperty("token");
    const futureMs = { access_token: "a".repeat(40), expires_at: 1_900_000_000_000 };
    expect(resolveKimiToken(JSON.stringify(futureMs), now)).toHaveProperty("token");
  });

  it("treats an unparseable store as no credential, not a crash", () => {
    expect(resolveKimiToken("not json")).toMatchObject({ reason: "no_credential" });
  });
});

describe("loadKimiCodeInstall", () => {
  it("assembles endpoint, credential and catalog from a signed-in install", () => {
    const fs = fakeFs(
      { [CONFIG_PATH]: CONFIG, [CRED_PATH]: JSON.stringify({ access_token: "k".repeat(40) }) },
      { [CRED_DIR]: ["kimi-code.json"] },
    );
    const result = loadKimiCodeInstall(fs, env);
    expect(isKimiCodeInstall(result)).toBe(true);
    expect(result).toMatchObject({
      home: HOME,
      baseUrl: "https://api.kimi.com/coding/v1",
      token: "k".repeat(40),
    });
    expect((result as { models: readonly { model: string }[] }).models.map((m) => m.model)).toEqual([
      "kimi-for-coding",
      "k3",
    ]);
  });

  it("reports 'no install' for a machine without Kimi Code — the NORMAL case", () => {
    // Must never throw: every developer without Kimi Code still opens the model picker.
    expect(loadKimiCodeInstall(fakeFs({}), env)).toMatchObject({ reason: "no_install" });
  });

  it("distinguishes 'installed but signed out' from 'not installed'", () => {
    // Different remedies: install/enable vs. sign in. Collapsing them to null is what
    // made an empty Kimi group unexplainable.
    const fs = fakeFs({ [CONFIG_PATH]: CONFIG }, { [CRED_DIR]: [] });
    expect(loadKimiCodeInstall(fs, env)).toMatchObject({ reason: "no_credential" });
  });

  it("reports a config with no provider endpoint", () => {
    const fs = fakeFs({ [CONFIG_PATH]: "default_model = \"x\"\n" }, { [CRED_DIR]: ["kimi-code.json"] });
    expect(loadKimiCodeInstall(fs, env)).toMatchObject({ reason: "no_endpoint" });
  });
});

// The shape of the REAL store on a signed-in machine, confirmed against a live install:
// a standard OAuth record whose access token lives fifteen minutes and is refreshed on
// disk by Kimi Code itself. The lifetime is the reason the skew rule below exists.
describe("the real credential shape", () => {
  const live = (expiresAtSeconds: number) =>
    JSON.stringify({
      access_token: "a".repeat(704),
      refresh_token: "r".repeat(705),
      expires_at: expiresAtSeconds,
      scope: "coding",
      token_type: "Bearer",
      expires_in: 900,
    });

  it("reads the access token, not the refresh token", () => {
    // Both are long strings on the same record; sending the refresh token as a bearer
    // would 401 against a perfectly good account.
    const now = 1_788_640_000_000;
    expect(resolveKimiToken(live(1_788_641_000), now)).toEqual({ token: "a".repeat(704) });
  });

  it("does NOT mistake `expires_in` (a duration) for an expiry timestamp", () => {
    // 900 read as an absolute time is 1970, which would call every live token expired.
    const now = 1_788_640_000_000;
    expect(resolveKimiToken(live(1_788_641_000), now)).toHaveProperty("token");
  });

  it("refuses a token inside the skew window rather than dying mid-stream", () => {
    // 10s of life left: enough to start a completion, not enough to finish one.
    const now = 1_788_640_000_000;
    expect(resolveKimiToken(live(1_788_640_010), now)).toMatchObject({ reason: "expired" });
  });

  it("accepts a token comfortably clear of the window", () => {
    const now = 1_788_640_000_000;
    expect(resolveKimiToken(live(1_788_640_600), now)).toHaveProperty("token");
  });

  it("sends the user to Kimi Code, not to a pointless re-login", () => {
    const result = resolveKimiToken(live(1_000), 1_788_640_000_000) as { detail: string };
    expect(result.detail).toContain("Open Kimi Code");
    expect(result.detail).not.toContain("Sign in again");
  });
});

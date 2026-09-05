import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  isKimiCodeInstall,
  loadKimiCodeInstall,
  parseKimiCodeConfig,
  resolveKimiCodeHome,
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
    // Writes belong to the credential store, which has its own suite; an install read
    // must never reach them, so they fail loudly rather than silently succeeding.
    mkdirSync: () => { throw new Error("loadKimiCodeInstall must not write"); },
    writeFileSync: () => { throw new Error("loadKimiCodeInstall must not write"); },
    renameSync: () => { throw new Error("loadKimiCodeInstall must not write"); },
    unlinkSync: () => { throw new Error("loadKimiCodeInstall must not write"); },
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

describe("loadKimiCodeInstall", () => {
  /** A live credential record in Kimi's real wire shape. */
  const credential = (expiresAtSeconds: number) =>
    JSON.stringify({
      access_token: "k".repeat(704),
      refresh_token: "r".repeat(705),
      expires_at: expiresAtSeconds,
      scope: "coding",
      token_type: "Bearer",
      expires_in: 900,
    });
  const NOW = 1_788_640_000_000;

  it("assembles endpoint, catalog and credential STATE from a signed-in install", () => {
    const fs = fakeFs(
      { [CONFIG_PATH]: CONFIG, [CRED_PATH]: credential(1_788_640_600) },
      { [CRED_DIR]: ["kimi-code.json"] },
    );
    const result = loadKimiCodeInstall(fs, env, undefined, NOW);
    expect(isKimiCodeInstall(result)).toBe(true);
    expect(result).toMatchObject({ home: HOME, baseUrl: "https://api.kimi.com/coding/v1" });
    // A STATE, never a bare token: a fifteen-minute credential cannot be resolved
    // synchronously, so the install reports what it found and the request path refreshes.
    expect((result as { credential: { kind: string } }).credential.kind).toBe("fresh");
    expect((result as { models: readonly { model: string }[] }).models.map((m) => m.model)).toEqual([
      "kimi-for-coding",
      "k3",
    ]);
  });

  it("still OFFERS an install whose token is stale — it is one refresh away", () => {
    // Refusing to list a model that a single grant would make usable is what sends the
    // user back to poking another app, which is the whole failure being fixed.
    const fs = fakeFs(
      { [CONFIG_PATH]: CONFIG, [CRED_PATH]: credential(1_788_639_592) },
      { [CRED_DIR]: ["kimi-code.json"] },
    );
    const result = loadKimiCodeInstall(fs, env, undefined, NOW);
    expect(isKimiCodeInstall(result)).toBe(true);
    expect((result as { credential: { kind: string } }).credential.kind).toBe("stale");
  });

  it("reports Kimi's signed-out tombstone as signed_out, not as a broken file", () => {
    // An empty access_token is how Kimi records a sign-out. Calling it corruption would
    // send the user to debug a file that is doing exactly its job.
    const fs = fakeFs(
      { [CONFIG_PATH]: CONFIG, [CRED_PATH]: JSON.stringify({ access_token: "", refresh_token: "" }) },
      { [CRED_DIR]: ["kimi-code.json"] },
    );
    expect(loadKimiCodeInstall(fs, env, undefined, NOW)).toMatchObject({ reason: "signed_out" });
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


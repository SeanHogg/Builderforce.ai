import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBuilderforceCredential, storeBuilderforceCredential, warnBuilderforceCredentialFallback } from "./builderforce-credential-store.js";
import { readRuntimeEnvVar, readSharedEnvVar, upsertSharedEnvVar } from "./env-file.js";

vi.mock("./builderforce-credential-store.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./builderforce-credential-store.js")>(),
  readBuilderforceCredential: vi.fn(),
  storeBuilderforceCredential: vi.fn(),
  warnBuilderforceCredentialFallback: vi.fn(),
}));

describe("runtime credential persistence", () => {
  const key = "BUILDERFORCE_API_KEY";
  let directory: string;
  let env: NodeJS.ProcessEnv;
  let envFile: string;

  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(join(tmpdir(), "bf-env-test-"));
    env = { BUILDERFORCE_AGENTS_STATE_DIR: directory };
    envFile = join(directory, ".env");
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("removes legacy credentials from the settings file after saving to the system store", () => {
    writeFileSync(envFile, "BUILDERFORCE_URL=https://fixture.example\nexport BUILDERFORCE_API_KEY = old-fixture\n");
    vi.mocked(storeBuilderforceCredential).mockReturnValue(true);
    vi.mocked(readBuilderforceCredential).mockReturnValue("new-fixture");

    upsertSharedEnvVar({ key, value: "new-fixture", env });

    expect(storeBuilderforceCredential).toHaveBeenCalledWith(directory, key, "new-fixture");
    expect(readFileSync(envFile, "utf8")).toBe("BUILDERFORCE_URL=https://fixture.example\n");
    expect(readSharedEnvVar(key, env)).toBe("new-fixture");
    expect(readRuntimeEnvVar(key, { ...env, [key]: "override-fixture" })).toBe("override-fixture");
  });

  it("warns and retains a private fallback when the system store is unavailable", () => {
    vi.mocked(storeBuilderforceCredential).mockReturnValue(false);
    vi.mocked(readBuilderforceCredential).mockReturnValue("older-keychain-fixture");

    upsertSharedEnvVar({ key, value: "fallback-fixture", env });

    expect(warnBuilderforceCredentialFallback).toHaveBeenCalled();
    expect(readSharedEnvVar(key, env)).toBe("fallback-fixture");
    if (process.platform !== "win32") expect(statSync(envFile).mode & 0o777).toBe(0o600);
  });
});

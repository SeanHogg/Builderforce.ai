import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "builderforce",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "builderforce", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "builderforce", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "builderforce", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "builderforce", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "builderforce", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "builderforce", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "builderforce", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "builderforce", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".builderforce-dev");
    expect(env.BUILDERFORCE_AGENTS_PROFILE).toBe("dev");
    expect(env.BUILDERFORCE_AGENTS_STATE_DIR).toBe(expectedStateDir);
    expect(env.BUILDERFORCE_AGENTS_CONFIG_PATH).toBe(path.join(expectedStateDir, "builderforce.json"));
    expect(env.BUILDERFORCE_AGENTS_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      BUILDERFORCE_AGENTS_STATE_DIR: "/custom",
      BUILDERFORCE_AGENTS_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.BUILDERFORCE_AGENTS_STATE_DIR).toBe("/custom");
    expect(env.BUILDERFORCE_AGENTS_GATEWAY_PORT).toBe("19099");
    expect(env.BUILDERFORCE_AGENTS_CONFIG_PATH).toBe(path.join("/custom", "builderforce.json"));
  });

  it("uses BUILDERFORCE_AGENTS_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      BUILDERFORCE_AGENTS_HOME: "/srv/builderforce-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/builderforce-home");
    expect(env.BUILDERFORCE_AGENTS_STATE_DIR).toBe(path.join(resolvedHome, ".builderforce-work"));
    expect(env.BUILDERFORCE_AGENTS_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".builderforce-work", "builderforce.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("builderforce doctor --fix", {})).toBe("builderforce doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("builderforce doctor --fix", { BUILDERFORCE_AGENTS_PROFILE: "default" })).toBe(
      "builderforce doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("builderforce doctor --fix", { BUILDERFORCE_AGENTS_PROFILE: "Default" })).toBe(
      "builderforce doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("builderforce doctor --fix", { BUILDERFORCE_AGENTS_PROFILE: "bad profile" })).toBe(
      "builderforce doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(
      formatCliCommand("builderforce --profile work doctor --fix", { BUILDERFORCE_AGENTS_PROFILE: "work" }),
    ).toBe("builderforce --profile work doctor --fix");
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("builderforce --dev doctor", { BUILDERFORCE_AGENTS_PROFILE: "dev" })).toBe(
      "builderforce --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("builderforce doctor --fix", { BUILDERFORCE_AGENTS_PROFILE: "work" })).toBe(
      "builderforce --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(
      formatCliCommand("builderforce doctor --fix", { BUILDERFORCE_AGENTS_PROFILE: "  jbbuilderforce  " }),
    ).toBe("builderforce --profile jbbuilderforce doctor --fix");
  });

  it("handles command with no args after builderforce", () => {
    expect(formatCliCommand("builderforce", { BUILDERFORCE_AGENTS_PROFILE: "test" })).toBe(
      "builderforce --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm builderforce doctor", { BUILDERFORCE_AGENTS_PROFILE: "work" })).toBe(
      "pnpm builderforce --profile work doctor",
    );
  });
});

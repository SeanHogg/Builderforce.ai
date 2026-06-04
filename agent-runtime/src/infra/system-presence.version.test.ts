import { describe, expect, it, vi } from "vitest";
import { withEnvAsync } from "../test-utils/env.js";

async function withPresenceModule<T>(
  env: Record<string, string | undefined>,
  run: (module: typeof import("./system-presence.js")) => Promise<T> | T,
): Promise<T> {
  return withEnvAsync(env, async () => {
    vi.resetModules();
    try {
      const module = await import("./system-presence.js");
      return await run(module);
    } finally {
      vi.resetModules();
    }
  });
}

describe("system-presence version fallback", () => {
  it("uses BUILDERFORCE_AGENTS_SERVICE_VERSION when BUILDERFORCE_AGENTS_VERSION is not set", async () => {
    await withPresenceModule(
      {
        BUILDERFORCE_AGENTS_SERVICE_VERSION: "2.4.6-service",
        npm_package_version: "1.0.0-package",
      },
      ({ listSystemPresence }) => {
        const selfEntry = listSystemPresence().find((entry) => entry.reason === "self");
        expect(selfEntry?.version).toBe("2.4.6-service");
      },
    );
  });

  it("prefers BUILDERFORCE_AGENTS_VERSION over BUILDERFORCE_AGENTS_SERVICE_VERSION", async () => {
    await withPresenceModule(
      {
        BUILDERFORCE_AGENTS_VERSION: "9.9.9-cli",
        BUILDERFORCE_AGENTS_SERVICE_VERSION: "2.4.6-service",
        npm_package_version: "1.0.0-package",
      },
      ({ listSystemPresence }) => {
        const selfEntry = listSystemPresence().find((entry) => entry.reason === "self");
        expect(selfEntry?.version).toBe("9.9.9-cli");
      },
    );
  });

  it("uses npm_package_version when BUILDERFORCE_AGENTS_VERSION and BUILDERFORCE_AGENTS_SERVICE_VERSION are blank", async () => {
    await withPresenceModule(
      {
        BUILDERFORCE_AGENTS_VERSION: " ",
        BUILDERFORCE_AGENTS_SERVICE_VERSION: "\t",
        npm_package_version: "1.0.0-package",
      },
      ({ listSystemPresence }) => {
        const selfEntry = listSystemPresence().find((entry) => entry.reason === "self");
        expect(selfEntry?.version).toBe("1.0.0-package");
      },
    );
  });
});

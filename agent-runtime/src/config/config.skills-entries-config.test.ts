import { describe, expect, it } from "vitest";
import { BuilderForceAgentsSchema } from "./zod-schema.js";

describe("skills entries config schema", () => {
  it("accepts custom fields under config", () => {
    const res = BuilderForceAgentsSchema.safeParse({
      skills: {
        entries: {
          "custom-skill": {
            enabled: true,
            config: {
              url: "https://example.invalid",
              token: "abc123",
            },
          },
        },
      },
    });

    expect(res.success).toBe(true);
  });

  it("rejects unknown top-level fields", () => {
    const res = BuilderForceAgentsSchema.safeParse({
      skills: {
        entries: {
          "custom-skill": {
            url: "https://example.invalid",
          },
        },
      },
    });

    expect(res.success).toBe(false);
    if (res.success) {
      return;
    }

    expect(
      res.error.issues.some(
        (issue) =>
          issue.path.join(".") === "skills.entries.custom-skill" &&
          issue.message.toLowerCase().includes("unrecognized"),
      ),
    ).toBe(true);
  });

  it("allows specifying a registry url and CLI hint", () => {
    const res = BuilderForceAgentsSchema.safeParse({
      skills: {
        registry: { url: "https://my.registry/", cli: "npx openagentNode" },
      },
    });
    expect(res.success).toBe(true);
  });
});

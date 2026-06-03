import { describe, expect, it } from "vitest";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { DEFAULT_ASSISTANT_IDENTITY, resolveAssistantIdentity } from "./assistant-identity.js";

describe("resolveAssistantIdentity avatar normalization", () => {
  it("drops sentence-like avatar placeholders", () => {
    const cfg: BuilderForceAgentsConfig = {
      ui: {
        assistant: {
          avatar: "workspace-relative path, http(s) URL, or data URI",
        },
      },
    };

    expect(resolveAssistantIdentity({ cfg, workspaceDir: "" }).avatar).toBe(
      DEFAULT_ASSISTANT_IDENTITY.avatar,
    );
  });

  it("keeps short text avatars", () => {
    const cfg: BuilderForceAgentsConfig = {
      ui: {
        assistant: {
          avatar: "PS",
        },
      },
    };

    expect(resolveAssistantIdentity({ cfg, workspaceDir: "" }).avatar).toBe("PS");
  });

  it("keeps path avatars", () => {
    const cfg: BuilderForceAgentsConfig = {
      ui: {
        assistant: {
          avatar: "avatars/builderforce.png",
        },
      },
    };

    expect(resolveAssistantIdentity({ cfg, workspaceDir: "" }).avatar).toBe(
      "avatars/builderforce.png",
    );
  });
});

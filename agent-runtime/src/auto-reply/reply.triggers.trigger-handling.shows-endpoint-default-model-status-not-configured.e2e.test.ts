import { beforeAll, describe, expect, it } from "vitest";
import { normalizeTestText } from "../../test/helpers/normalize-text.js";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import {
  getRunEmbeddedAgentMock,
  installTriggerHandlingE2eTestHooks,
  makeCfg,
  withTempHome,
} from "./reply.triggers.trigger-handling.test-harness.js";

let getReplyFromConfig: typeof import("./reply.js").getReplyFromConfig;
beforeAll(async () => {
  ({ getReplyFromConfig } = await import("./reply.js"));
});

installTriggerHandlingE2eTestHooks();

const modelStatusCtx = {
  Body: "/model status",
  From: "telegram:111",
  To: "telegram:111",
  ChatType: "direct",
  Provider: "telegram",
  Surface: "telegram",
  SessionKey: "telegram:slash:111",
  CommandAuthorized: true,
} as const;

describe("trigger handling", () => {
  it("shows endpoint default in /model status when not configured", async () => {
    await withTempHome(async (home) => {
      const cfg = makeCfg(home);
      const res = await getReplyFromConfig(modelStatusCtx, {}, cfg);

      const text = Array.isArray(res) ? res[0]?.text : res?.text;
      expect(normalizeTestText(text ?? "")).toContain("endpoint: default");
    });
  });
  it("includes endpoint details in /model status when configured", async () => {
    await withTempHome(async (home) => {
      const cfg = {
        ...makeCfg(home),
        models: {
          providers: {
            minimax: {
              baseUrl: "https://api.minimax.io/anthropic",
              api: "anthropic-messages",
            },
          },
        },
      } as unknown as BuilderForceAgentsConfig;
      const res = await getReplyFromConfig(modelStatusCtx, {}, cfg);

      const text = Array.isArray(res) ? res[0]?.text : res?.text;
      const normalized = normalizeTestText(text ?? "");
      expect(normalized).toContain(
        "[minimax] endpoint: https://api.minimax.io/anthropic api: anthropic-messages auth:",
      );
    });
  });
  it("rejects /restart by default", async () => {
    await withTempHome(async (home) => {
      const runEmbeddedAgentMock = getRunEmbeddedAgentMock();
      const res = await getReplyFromConfig(
        {
          Body: "  [Dec 5] /restart",
          From: "+1001",
          To: "+2000",
          CommandAuthorized: true,
        },
        {},
        makeCfg(home),
      );
      const text = Array.isArray(res) ? res[0]?.text : res?.text;
      expect(text).toContain("/restart is disabled");
      expect(runEmbeddedAgentMock).not.toHaveBeenCalled();
    });
  });
  it("restarts when enabled", async () => {
    await withTempHome(async (home) => {
      const runEmbeddedAgentMock = getRunEmbeddedAgentMock();
      const cfg = { ...makeCfg(home), commands: { restart: true } } as BuilderForceAgentsConfig;
      const res = await getReplyFromConfig(
        {
          Body: "/restart",
          From: "+1001",
          To: "+2000",
          CommandAuthorized: true,
        },
        {},
        cfg,
      );
      const text = Array.isArray(res) ? res[0]?.text : res?.text;
      expect(text?.startsWith("⚙️ Restarting") || text?.startsWith("⚠️ Restart failed")).toBe(true);
      expect(runEmbeddedAgentMock).not.toHaveBeenCalled();
    });
  });
  it("reports status without invoking the agent", async () => {
    await withTempHome(async (home) => {
      const runEmbeddedAgentMock = getRunEmbeddedAgentMock();
      const res = await getReplyFromConfig(
        {
          Body: "/status",
          From: "+1002",
          To: "+2000",
          CommandAuthorized: true,
        },
        {},
        makeCfg(home),
      );
      const text = Array.isArray(res) ? res[0]?.text : res?.text;
      expect(text).toContain("BuilderForceAgents");
      expect(runEmbeddedAgentMock).not.toHaveBeenCalled();
    });
  });
});

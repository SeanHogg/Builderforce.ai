import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRichMenuList: vi.fn(),
  getDefaultRichMenuId: vi.fn(),
  getRichMenuIdOfUser: vi.fn(),
  linkRichMenuToUser: vi.fn(),
  unlinkRichMenuFromUser: vi.fn(),
  setDefaultRichMenu: vi.fn(),
  cancelDefaultRichMenu: vi.fn(),
}));

vi.mock("../../../src/line/rich-menu.js", () => mocks);

import {
  registerLineRichMenuTool,
  resolveRichMenuRef,
  runLineRichMenuAction,
} from "./rich-menu-tool.js";

const MENUS = [
  { richMenuId: "rm-1", name: "Main", chatBarText: "Menu", size: {}, areas: [] },
  { richMenuId: "rm-2", name: "Support", chatBarText: "Help", size: {}, areas: [] },
];

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    fn.mockReset();
  }
  mocks.getRichMenuList.mockResolvedValue(MENUS);
  mocks.getDefaultRichMenuId.mockResolvedValue("rm-1");
  mocks.getRichMenuIdOfUser.mockResolvedValue(null);
});

describe("resolveRichMenuRef", () => {
  it("resolves by id, by case-insensitive name, and by 'default'", async () => {
    await expect(resolveRichMenuRef("rm-2", {})).resolves.toBe("rm-2");
    await expect(resolveRichMenuRef("support", {})).resolves.toBe("rm-2");
    await expect(resolveRichMenuRef("DEFAULT", {})).resolves.toBe("rm-1");
  });

  it("rejects unknown or empty references", async () => {
    await expect(resolveRichMenuRef("nope", {})).rejects.toThrow('unknown rich menu "nope"');
    await expect(resolveRichMenuRef("  ", {})).rejects.toThrow("rich menu reference required");
    mocks.getDefaultRichMenuId.mockResolvedValue(null);
    await expect(resolveRichMenuRef("default", {})).rejects.toThrow("no default rich menu");
  });
});

describe("runLineRichMenuAction", () => {
  it("lists menus with the current default", async () => {
    const result = await runLineRichMenuAction({ action: "list", accountId: "acct" });

    expect(result.defaultRichMenuId).toBe("rm-1");
    expect(result.menus).toEqual([
      { richMenuId: "rm-1", name: "Main", chatBarText: "Menu" },
      { richMenuId: "rm-2", name: "Support", chatBarText: "Help" },
    ]);
    expect(mocks.getRichMenuList).toHaveBeenCalledWith({ accountId: "acct" });
  });

  it("links a menu by name to a user", async () => {
    const result = await runLineRichMenuAction({ action: "link", menu: "Support", userId: "U1" });

    expect(mocks.linkRichMenuToUser).toHaveBeenCalledWith("U1", "rm-2", { accountId: undefined });
    expect(result).toEqual({ userId: "U1", richMenuId: "rm-2", linked: true });
  });

  it("requires a user id for per-user actions", async () => {
    await expect(runLineRichMenuAction({ action: "link", menu: "Main" })).rejects.toThrow(
      "link requires a LINE user id",
    );
    await expect(runLineRichMenuAction({ action: "unlink" })).rejects.toThrow(
      "unlink requires a LINE user id",
    );
    await expect(runLineRichMenuAction({ action: "status" })).rejects.toThrow(
      "status requires a LINE user id",
    );
    expect(mocks.linkRichMenuToUser).not.toHaveBeenCalled();
  });

  it("unlinks, reports status, and manages the default", async () => {
    await expect(runLineRichMenuAction({ action: "unlink", userId: "U1" })).resolves.toEqual({
      userId: "U1",
      linked: false,
    });
    expect(mocks.unlinkRichMenuFromUser).toHaveBeenCalledWith("U1", { accountId: undefined });

    mocks.getRichMenuIdOfUser.mockResolvedValue("rm-2");
    await expect(runLineRichMenuAction({ action: "status", userId: "U1" })).resolves.toEqual({
      userId: "U1",
      richMenuId: "rm-2",
      defaultRichMenuId: "rm-1",
    });

    await expect(runLineRichMenuAction({ action: "set_default", menu: "rm-2" })).resolves.toEqual({
      defaultRichMenuId: "rm-2",
    });
    expect(mocks.setDefaultRichMenu).toHaveBeenCalledWith("rm-2", { accountId: undefined });

    await expect(runLineRichMenuAction({ action: "cancel_default" })).resolves.toEqual({
      defaultRichMenuId: null,
    });
    expect(mocks.cancelDefaultRichMenu).toHaveBeenCalled();
  });
});

describe("registerLineRichMenuTool", () => {
  function createApi(accountIds: string[]) {
    const registerTool = vi.fn();
    const api = {
      config: {},
      logger: { debug: vi.fn() },
      runtime: { channel: { line: { listLineAccountIds: () => accountIds } } },
      registerTool,
    } as unknown as BuilderForceAgentsPluginApi;
    return { api, registerTool };
  }

  it("skips registration when no LINE account is configured", () => {
    const { api, registerTool } = createApi([]);
    registerLineRichMenuTool(api);
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("registers line_rich_menu and routes tool calls through the dispatcher", async () => {
    const { api, registerTool } = createApi(["default"]);
    registerLineRichMenuTool(api);

    expect(registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: "line_rich_menu" }), {
      name: "line_rich_menu",
      optional: true,
    });
    const tool = registerTool.mock.calls[0][0] as {
      execute: (id: string, params: unknown) => Promise<{ details: unknown }>;
    };

    const ok = await tool.execute("call-1", { action: "link", menu: "Main", user_id: "U9" });
    expect(ok.details).toEqual({ userId: "U9", richMenuId: "rm-1", linked: true });

    const failed = await tool.execute("call-2", { action: "link", menu: "ghost", user_id: "U9" });
    expect(failed.details).toEqual({ error: 'unknown rich menu "ghost"' });
  });
});

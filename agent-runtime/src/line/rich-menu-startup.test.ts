import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRichMenuList: vi.fn(),
  createRichMenu: vi.fn(),
  uploadRichMenuImage: vi.fn(),
  getDefaultRichMenuId: vi.fn(),
  setDefaultRichMenu: vi.fn(),
}));

vi.mock("./rich-menu.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rich-menu.js")>();
  return {
    ...actual,
    getRichMenuList: mocks.getRichMenuList,
    createRichMenu: mocks.createRichMenu,
    uploadRichMenuImage: mocks.uploadRichMenuImage,
    getDefaultRichMenuId: mocks.getDefaultRichMenuId,
    setDefaultRichMenu: mocks.setDefaultRichMenu,
  };
});

vi.mock("../globals.js", () => ({ logVerbose: vi.fn() }));

import { buildRichMenuParamsFromConfig, ensureDefaultRichMenu } from "./rich-menu-startup.js";

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    fn.mockReset();
  }
  mocks.getRichMenuList.mockResolvedValue([]);
  mocks.createRichMenu.mockResolvedValue("rm-new");
  mocks.uploadRichMenuImage.mockResolvedValue(undefined);
  mocks.getDefaultRichMenuId.mockResolvedValue(null);
  mocks.setDefaultRichMenu.mockResolvedValue(undefined);
});

describe("buildRichMenuParamsFromConfig", () => {
  it("falls back to the built-in default menu when only enabled", () => {
    const params = buildRichMenuParamsFromConfig({ enabled: true });

    expect(params.name).toBe("Default Menu");
    expect(params.chatBarText).toBe("Menu");
    expect(params.size).toEqual({ width: 2500, height: 843 });
    expect(params.areas).toHaveLength(6);
  });

  it("scales the default grid to a tall menu", () => {
    const params = buildRichMenuParamsFromConfig({ height: 1686 });

    expect(params.size.height).toBe(1686);
    expect(params.areas[3].bounds.y).toBe(842);
    expect(params.areas[3].bounds.height).toBe(842);
  });

  it("maps configured areas through the action helpers", () => {
    const params = buildRichMenuParamsFromConfig({
      name: "  Support ",
      chatBarText: "Open",
      selected: true,
      areas: [
        {
          bounds: { x: 0, y: 0, width: 1250, height: 843 },
          action: { type: "uri", label: "A label that is far too long", uri: "https://x.test" },
        },
        {
          bounds: { x: 1250, y: 0, width: 1250, height: 843 },
          action: { type: "postback", label: "Order", data: "action=order" },
        },
      ],
    });

    expect(params.name).toBe("Support");
    expect(params.selected).toBe(true);
    expect(params.areas).toHaveLength(2);
    expect(params.areas[0].action.label).toBe("A label that is far ");
    expect((params.areas[0].action as { uri: string }).uri).toBe("https://x.test");
    expect(params.areas[1].action.type).toBe("postback");
  });
});

describe("ensureDefaultRichMenu", () => {
  it("does nothing when no menu is configured", async () => {
    expect(await ensureDefaultRichMenu({ richMenu: undefined })).toBeNull();
    expect(mocks.getRichMenuList).not.toHaveBeenCalled();
  });

  it("does nothing when the menu is disabled", async () => {
    expect(await ensureDefaultRichMenu({ richMenu: { enabled: false, name: "X" } })).toBeNull();
    expect(mocks.getRichMenuList).not.toHaveBeenCalled();
  });

  it("creates, uploads the image, and sets the default on first run", async () => {
    const result = await ensureDefaultRichMenu({
      richMenu: { name: "Main", imagePath: "/tmp/menu.png" },
      accountId: "default",
      channelAccessToken: "token",
    });

    expect(result).toEqual({ richMenuId: "rm-new", created: true, setDefault: true });
    expect(mocks.createRichMenu).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Main" }),
      expect.objectContaining({ accountId: "default", channelAccessToken: "token" }),
    );
    expect(mocks.uploadRichMenuImage).toHaveBeenCalledWith(
      "rm-new",
      "/tmp/menu.png",
      expect.anything(),
    );
    expect(mocks.setDefaultRichMenu).toHaveBeenCalledWith("rm-new", expect.anything());
  });

  it("reuses an existing menu with the same name and skips setDefault when already default", async () => {
    mocks.getRichMenuList.mockResolvedValue([
      { richMenuId: "rm-old", name: "Main", chatBarText: "Menu", size: {}, areas: [] },
    ]);
    mocks.getDefaultRichMenuId.mockResolvedValue("rm-old");

    const result = await ensureDefaultRichMenu({ richMenu: { name: "Main" } });

    expect(result).toEqual({ richMenuId: "rm-old", created: false, setDefault: false });
    expect(mocks.createRichMenu).not.toHaveBeenCalled();
    expect(mocks.uploadRichMenuImage).not.toHaveBeenCalled();
    expect(mocks.setDefaultRichMenu).not.toHaveBeenCalled();
  });

  it("re-applies the default when an existing menu lost it", async () => {
    mocks.getRichMenuList.mockResolvedValue([
      { richMenuId: "rm-old", name: "Main", chatBarText: "Menu", size: {}, areas: [] },
    ]);
    mocks.getDefaultRichMenuId.mockResolvedValue("rm-other");

    const result = await ensureDefaultRichMenu({ richMenu: { name: "Main" } });

    expect(result).toEqual({ richMenuId: "rm-old", created: false, setDefault: true });
    expect(mocks.setDefaultRichMenu).toHaveBeenCalledWith("rm-old", expect.anything());
  });

  it("propagates API failures so the caller can log them", async () => {
    mocks.createRichMenu.mockRejectedValue(new Error("boom"));

    await expect(ensureDefaultRichMenu({ richMenu: { name: "Main" } })).rejects.toThrow("boom");
  });
});

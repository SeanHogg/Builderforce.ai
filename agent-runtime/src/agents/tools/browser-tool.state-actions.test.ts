import { afterEach, describe, expect, it, vi } from "vitest";

const stateWrapperMocks = vi.hoisted(() => ({
  browserClearPermissions: vi.fn(async () => ({ ok: true })),
  browserCookies: vi.fn(async () => ({ ok: true, targetId: "t1", cookies: [] })),
  browserCookiesClear: vi.fn(async () => ({ ok: true, targetId: "t1" })),
  browserCookiesSet: vi.fn(async () => ({ ok: true, targetId: "t1" })),
  browserSetDevice: vi.fn(async () => ({ ok: true, targetId: "t1" })),
  browserSetGeolocation: vi.fn(async () => ({ ok: true, targetId: "t1" })),
  browserSetHeaders: vi.fn(async () => ({ ok: true, targetId: "t1" })),
  browserSetHttpCredentials: vi.fn(async () => ({ ok: true, targetId: "t1" })),
  browserSetLocale: vi.fn(async () => ({ ok: true, targetId: "t1" })),
  browserSetMedia: vi.fn(async () => ({ ok: true, targetId: "t1" })),
  browserSetOffline: vi.fn(async () => ({ ok: true, targetId: "t1" })),
  browserSetTimezone: vi.fn(async () => ({ ok: true, targetId: "t1" })),
  browserStorageClear: vi.fn(async () => ({ ok: true, targetId: "t1" })),
  browserStorageGet: vi.fn(async () => ({ ok: true, targetId: "t1", values: { a: "1" } })),
  browserStorageSet: vi.fn(async () => ({ ok: true, targetId: "t1" })),
}));
vi.mock("../../browser/client-actions.js", () => stateWrapperMocks);

import * as clientActionsState from "../../browser/client-actions-state.js";
import {
  BROWSER_STATE_ACTIONS,
  type BrowserStateAction,
  isBrowserStateAction,
  runBrowserStateAction,
} from "./browser-tool.state-actions.js";
import { ToolInputError } from "./common.js";

const BASE = "http://127.0.0.1:18791";

function hostCtx(params: Record<string, unknown>, profile = "builderforce") {
  return { params, profile, baseUrl: BASE, proxyRequest: null };
}

function proxyCtx(params: Record<string, unknown>, profile = "builderforce") {
  const proxyRequest = vi.fn(async () => ({ ok: true, targetId: "t1" }));
  return { ctx: { params, profile, baseUrl: undefined, proxyRequest }, proxyRequest };
}

describe("browser state actions table", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exposes one tool action per state wrapper in client-actions-state.ts", () => {
    const wrapperCount = Object.keys(clientActionsState).filter((name) =>
      name.startsWith("browser"),
    ).length;
    expect(BROWSER_STATE_ACTIONS).toHaveLength(wrapperCount);
    expect(new Set(BROWSER_STATE_ACTIONS).size).toBe(BROWSER_STATE_ACTIONS.length);
  });

  it("recognises state actions and nothing else", () => {
    for (const action of BROWSER_STATE_ACTIONS) {
      expect(isBrowserStateAction(action)).toBe(true);
    }
    expect(isBrowserStateAction("snapshot")).toBe(false);
    expect(isBrowserStateAction("act")).toBe(false);
  });

  describe("host / sandbox routing (client wrappers)", () => {
    it("cookies -> browserCookies", async () => {
      const result = await runBrowserStateAction("cookies", hostCtx({ targetId: " t1 " }));
      expect(stateWrapperMocks.browserCookies).toHaveBeenCalledWith(BASE, {
        targetId: "t1",
        profile: "builderforce",
      });
      expect(result.details).toMatchObject({ ok: true, cookies: [] });
    });

    it("cookies_set -> browserCookiesSet with the cookie object", async () => {
      const cookie = { name: "sid", value: "abc", url: "https://example.com" };
      await runBrowserStateAction("cookies_set", hostCtx({ cookie, targetId: "t1" }));
      expect(stateWrapperMocks.browserCookiesSet).toHaveBeenCalledWith(BASE, {
        cookie,
        targetId: "t1",
        profile: "builderforce",
      });
    });

    it("cookies_clear -> browserCookiesClear", async () => {
      await runBrowserStateAction("cookies_clear", hostCtx({}));
      expect(stateWrapperMocks.browserCookiesClear).toHaveBeenCalledWith(BASE, {
        targetId: undefined,
        profile: "builderforce",
      });
    });

    it("storage_get -> browserStorageGet with kind and optional key", async () => {
      await runBrowserStateAction(
        "storage_get",
        hostCtx({ storageKind: "session", key: "token", targetId: "t1" }),
      );
      expect(stateWrapperMocks.browserStorageGet).toHaveBeenCalledWith(BASE, {
        kind: "session",
        key: "token",
        targetId: "t1",
        profile: "builderforce",
      });
    });

    it("storage_set -> browserStorageSet and keeps an empty value", async () => {
      await runBrowserStateAction(
        "storage_set",
        hostCtx({ storageKind: "local", key: "flag", value: "" }),
      );
      expect(stateWrapperMocks.browserStorageSet).toHaveBeenCalledWith(BASE, {
        kind: "local",
        key: "flag",
        value: "",
        targetId: undefined,
        profile: "builderforce",
      });
    });

    it("storage_clear -> browserStorageClear", async () => {
      await runBrowserStateAction("storage_clear", hostCtx({ storageKind: "local" }));
      expect(stateWrapperMocks.browserStorageClear).toHaveBeenCalledWith(BASE, {
        kind: "local",
        targetId: undefined,
        profile: "builderforce",
      });
    });

    it("set_offline -> browserSetOffline", async () => {
      await runBrowserStateAction("set_offline", hostCtx({ offline: true }));
      expect(stateWrapperMocks.browserSetOffline).toHaveBeenCalledWith(BASE, {
        offline: true,
        targetId: undefined,
        profile: "builderforce",
      });
    });

    it("set_headers -> browserSetHeaders keeping only string values", async () => {
      await runBrowserStateAction(
        "set_headers",
        hostCtx({ headers: { "X-Test": "1", Bad: 42 } }),
      );
      expect(stateWrapperMocks.browserSetHeaders).toHaveBeenCalledWith(BASE, {
        headers: { "X-Test": "1" },
        targetId: undefined,
        profile: "builderforce",
      });
    });

    it("set_credentials -> browserSetHttpCredentials", async () => {
      await runBrowserStateAction(
        "set_credentials",
        hostCtx({ username: "u", password: "p w", targetId: "t1" }),
      );
      expect(stateWrapperMocks.browserSetHttpCredentials).toHaveBeenCalledWith(BASE, {
        username: "u",
        password: "p w",
        clear: false,
        targetId: "t1",
        profile: "builderforce",
      });
    });

    it("set_credentials clear=true needs no username", async () => {
      await runBrowserStateAction("set_credentials", hostCtx({ clear: true }));
      expect(stateWrapperMocks.browserSetHttpCredentials).toHaveBeenCalledWith(
        BASE,
        expect.objectContaining({ clear: true, username: undefined }),
      );
    });

    it("set_geolocation -> browserSetGeolocation", async () => {
      await runBrowserStateAction(
        "set_geolocation",
        hostCtx({ latitude: 51.5, longitude: -0.12, accuracy: 10, origin: "https://a.b" }),
      );
      expect(stateWrapperMocks.browserSetGeolocation).toHaveBeenCalledWith(BASE, {
        latitude: 51.5,
        longitude: -0.12,
        accuracy: 10,
        origin: "https://a.b",
        clear: false,
        targetId: undefined,
        profile: "builderforce",
      });
    });

    it("clear_permissions -> browserClearPermissions", async () => {
      await runBrowserStateAction("clear_permissions", hostCtx({ targetId: "t1" }));
      expect(stateWrapperMocks.browserClearPermissions).toHaveBeenCalledWith(BASE, {
        targetId: "t1",
        profile: "builderforce",
      });
    });

    it("set_media -> browserSetMedia", async () => {
      await runBrowserStateAction("set_media", hostCtx({ colorScheme: "dark" }));
      expect(stateWrapperMocks.browserSetMedia).toHaveBeenCalledWith(BASE, {
        colorScheme: "dark",
        targetId: undefined,
        profile: "builderforce",
      });
    });

    it("set_timezone -> browserSetTimezone", async () => {
      await runBrowserStateAction("set_timezone", hostCtx({ timezoneId: "Europe/Paris" }));
      expect(stateWrapperMocks.browserSetTimezone).toHaveBeenCalledWith(BASE, {
        timezoneId: "Europe/Paris",
        targetId: undefined,
        profile: "builderforce",
      });
    });

    it("set_locale -> browserSetLocale", async () => {
      await runBrowserStateAction("set_locale", hostCtx({ locale: "fr-FR" }));
      expect(stateWrapperMocks.browserSetLocale).toHaveBeenCalledWith(BASE, {
        locale: "fr-FR",
        targetId: undefined,
        profile: "builderforce",
      });
    });

    it("set_device -> browserSetDevice (device -> name)", async () => {
      await runBrowserStateAction("set_device", hostCtx({ device: "iPhone 13" }));
      expect(stateWrapperMocks.browserSetDevice).toHaveBeenCalledWith(BASE, {
        name: "iPhone 13",
        targetId: undefined,
        profile: "builderforce",
      });
    });
  });

  describe("node routing (browser proxy)", () => {
    it("cookies -> GET /cookies with targetId query", async () => {
      const { ctx, proxyRequest } = proxyCtx({ targetId: "t1" });
      await runBrowserStateAction("cookies", ctx);
      expect(proxyRequest).toHaveBeenCalledWith({
        method: "GET",
        path: "/cookies",
        profile: "builderforce",
        query: { targetId: "t1" },
      });
      expect(stateWrapperMocks.browserCookies).not.toHaveBeenCalled();
    });

    it("storage_get -> GET /storage/:kind with key query", async () => {
      const { ctx, proxyRequest } = proxyCtx({ storageKind: "local", key: "k" });
      await runBrowserStateAction("storage_get", ctx);
      expect(proxyRequest).toHaveBeenCalledWith({
        method: "GET",
        path: "/storage/local",
        profile: "builderforce",
        query: { targetId: undefined, key: "k" },
      });
    });

    it("storage_set -> POST /storage/:kind/set", async () => {
      const { ctx, proxyRequest } = proxyCtx({ storageKind: "session", key: "k", value: "v" });
      await runBrowserStateAction("storage_set", ctx);
      expect(proxyRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/storage/session/set",
        profile: "builderforce",
        body: { targetId: undefined, key: "k", value: "v" },
      });
    });

    it("clear_permissions -> POST /set/geolocation clear=true", async () => {
      const { ctx, proxyRequest } = proxyCtx({ targetId: "t1" });
      await runBrowserStateAction("clear_permissions", ctx);
      expect(proxyRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/set/geolocation",
        profile: "builderforce",
        body: { targetId: "t1", clear: true },
      });
    });

    it("set_device -> POST /set/device with name", async () => {
      const { ctx, proxyRequest } = proxyCtx({ device: "Pixel 5" });
      await runBrowserStateAction("set_device", ctx);
      expect(proxyRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/set/device",
        profile: "builderforce",
        body: { targetId: undefined, name: "Pixel 5" },
      });
    });

    it.each<[BrowserStateAction, Record<string, unknown>, string]>([
      ["cookies_set", { cookie: { name: "a", value: "b" } }, "/cookies/set"],
      ["cookies_clear", {}, "/cookies/clear"],
      ["storage_clear", { storageKind: "local" }, "/storage/local/clear"],
      ["set_offline", { offline: false }, "/set/offline"],
      ["set_headers", { headers: {} }, "/set/headers"],
      ["set_credentials", { clear: true }, "/set/credentials"],
      ["set_geolocation", { clear: true }, "/set/geolocation"],
      ["set_media", { colorScheme: "none" }, "/set/media"],
      ["set_timezone", { timezoneId: "UTC" }, "/set/timezone"],
      ["set_locale", { locale: "de-DE" }, "/set/locale"],
    ])("%s -> POST %s", async (action, params, path) => {
      const { ctx, proxyRequest } = proxyCtx(params);
      await runBrowserStateAction(action, ctx);
      expect(proxyRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "POST", path, profile: "builderforce" }),
      );
    });
  });

  describe("parameter validation", () => {
    it.each<[BrowserStateAction, Record<string, unknown>, string]>([
      ["cookies_set", {}, "cookie required"],
      ["cookies_set", { cookie: { value: "x" } }, "cookie.name required"],
      ["cookies_set", { cookie: { name: "x" } }, "cookie.value required"],
      ["storage_get", {}, "storageKind required"],
      ["storage_get", { storageKind: "cookie" }, "storageKind must be local|session"],
      ["storage_set", { storageKind: "local" }, "key required"],
      ["storage_set", { storageKind: "local", key: "k" }, "value required"],
      ["set_offline", {}, "offline required"],
      ["set_headers", {}, "headers required"],
      ["set_headers", { headers: ["a"] }, "headers required"],
      ["set_credentials", {}, "username required (or clear=true)"],
      ["set_geolocation", { latitude: 1 }, "latitude and longitude required (or clear=true)"],
      ["set_media", {}, "colorScheme required"],
      ["set_media", { colorScheme: "sepia" }, "colorScheme must be dark|light|no-preference|none"],
      ["set_timezone", {}, "timezoneId required"],
      ["set_locale", { locale: "  " }, "locale required"],
      ["set_device", {}, "device required"],
    ])("%s rejects %j", async (action, params, message) => {
      const { ctx, proxyRequest } = proxyCtx(params);
      await expect(runBrowserStateAction(action, ctx)).rejects.toThrow(ToolInputError);
      await expect(runBrowserStateAction(action, ctx)).rejects.toThrow(message);
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it("validates before touching the host wrapper too", async () => {
      await expect(
        runBrowserStateAction("set_offline", hostCtx({ offline: "yes" })),
      ).rejects.toThrow(ToolInputError);
      expect(stateWrapperMocks.browserSetOffline).not.toHaveBeenCalled();
    });
  });
});

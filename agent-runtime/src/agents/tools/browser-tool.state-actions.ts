import {
  browserClearPermissions,
  browserCookies,
  browserCookiesClear,
  browserCookiesSet,
  browserSetDevice,
  browserSetGeolocation,
  browserSetHeaders,
  browserSetHttpCredentials,
  browserSetLocale,
  browserSetMedia,
  browserSetOffline,
  browserSetTimezone,
  browserStorageClear,
  browserStorageGet,
  browserStorageSet,
} from "../../browser/client-actions.js";
import {
  type AgentToolResult,
  jsonResult,
  readNumberParam,
  readStringParam,
  ToolInputError,
} from "./common.js";

/**
 * Browser "state" actions: cookies, web storage, network/emulation state.
 *
 * Each entry maps a tool action name to the matching client wrapper in
 * `src/browser/client-actions-state.ts` (host/sandbox) or to the equivalent
 * browser-proxy HTTP request (node target). The HTTP routes are registered in
 * `src/browser/routes/agent.storage.ts`.
 */
export const BROWSER_STATE_ACTIONS = [
  "cookies",
  "cookies_set",
  "cookies_clear",
  "storage_get",
  "storage_set",
  "storage_clear",
  "set_offline",
  "set_headers",
  "set_credentials",
  "set_geolocation",
  "clear_permissions",
  "set_media",
  "set_timezone",
  "set_locale",
  "set_device",
] as const;

export type BrowserStateAction = (typeof BROWSER_STATE_ACTIONS)[number];

export const BROWSER_STORAGE_KINDS = ["local", "session"] as const;
export const BROWSER_COLOR_SCHEMES = ["dark", "light", "no-preference", "none"] as const;

type BrowserStateProxyRequest = (opts: {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  profile?: string;
}) => Promise<unknown>;

type BrowserStateActionContext = {
  params: Record<string, unknown>;
  profile?: string;
  baseUrl?: string;
  proxyRequest: BrowserStateProxyRequest | null;
};

type BrowserStateActionHandler = (
  ctx: BrowserStateActionContext,
) => Promise<AgentToolResult<unknown>>;

export function isBrowserStateAction(action: string): action is BrowserStateAction {
  return (BROWSER_STATE_ACTIONS as readonly string[]).includes(action);
}

function readTargetId(params: Record<string, unknown>): string | undefined {
  return typeof params.targetId === "string" ? params.targetId.trim() || undefined : undefined;
}

function readBooleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  return typeof params[key] === "boolean" ? (params[key] as boolean) : undefined;
}

function readRecordParam(
  params: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const raw = params[key];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return undefined;
}

function readStorageKind(params: Record<string, unknown>): "local" | "session" {
  const raw = readStringParam(params, "storageKind", { required: true });
  if (raw === "local" || raw === "session") {
    return raw;
  }
  throw new ToolInputError("storageKind must be local|session");
}

function readColorScheme(
  params: Record<string, unknown>,
): "dark" | "light" | "no-preference" | "none" {
  const raw = readStringParam(params, "colorScheme", { required: true });
  if (raw === "dark" || raw === "light" || raw === "no-preference" || raw === "none") {
    return raw;
  }
  throw new ToolInputError("colorScheme must be dark|light|no-preference|none");
}

function readHeadersParam(params: Record<string, unknown>): Record<string, string> {
  const raw = readRecordParam(params, "headers");
  if (!raw) {
    throw new ToolInputError("headers required (object of string values; {} clears)");
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      headers[name] = value;
    }
  }
  return headers;
}

const STATE_ACTION_HANDLERS: Record<BrowserStateAction, BrowserStateActionHandler> = {
  cookies: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({ method: "GET", path: "/cookies", profile, query: { targetId } }),
      );
    }
    return jsonResult(await browserCookies(baseUrl, { targetId, profile }));
  },

  cookies_set: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    const cookie = readRecordParam(params, "cookie");
    if (!cookie) {
      throw new ToolInputError("cookie required");
    }
    if (!readStringParam(cookie, "name")) {
      throw new ToolInputError("cookie.name required");
    }
    if (typeof cookie.value !== "string") {
      throw new ToolInputError("cookie.value required");
    }
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "POST",
          path: "/cookies/set",
          profile,
          body: { targetId, cookie },
        }),
      );
    }
    return jsonResult(await browserCookiesSet(baseUrl, { cookie, targetId, profile }));
  },

  cookies_clear: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "POST",
          path: "/cookies/clear",
          profile,
          body: { targetId },
        }),
      );
    }
    return jsonResult(await browserCookiesClear(baseUrl, { targetId, profile }));
  },

  storage_get: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    const kind = readStorageKind(params);
    const key = readStringParam(params, "key");
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "GET",
          path: `/storage/${kind}`,
          profile,
          query: { targetId, key },
        }),
      );
    }
    return jsonResult(await browserStorageGet(baseUrl, { kind, key, targetId, profile }));
  },

  storage_set: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    const kind = readStorageKind(params);
    const key = readStringParam(params, "key", { required: true });
    const value = readStringParam(params, "value", {
      required: true,
      trim: false,
      allowEmpty: true,
    });
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "POST",
          path: `/storage/${kind}/set`,
          profile,
          body: { targetId, key, value },
        }),
      );
    }
    return jsonResult(await browserStorageSet(baseUrl, { kind, key, value, targetId, profile }));
  },

  storage_clear: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    const kind = readStorageKind(params);
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "POST",
          path: `/storage/${kind}/clear`,
          profile,
          body: { targetId },
        }),
      );
    }
    return jsonResult(await browserStorageClear(baseUrl, { kind, targetId, profile }));
  },

  set_offline: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    const offline = readBooleanParam(params, "offline");
    if (offline === undefined) {
      throw new ToolInputError("offline required (true|false)");
    }
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "POST",
          path: "/set/offline",
          profile,
          body: { targetId, offline },
        }),
      );
    }
    return jsonResult(await browserSetOffline(baseUrl, { offline, targetId, profile }));
  },

  set_headers: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    const headers = readHeadersParam(params);
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "POST",
          path: "/set/headers",
          profile,
          body: { targetId, headers },
        }),
      );
    }
    return jsonResult(await browserSetHeaders(baseUrl, { headers, targetId, profile }));
  },

  set_credentials: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    const clear = readBooleanParam(params, "clear") ?? false;
    const username = readStringParam(params, "username");
    const password = readStringParam(params, "password", { trim: false, allowEmpty: true });
    if (!clear && !username) {
      throw new ToolInputError("username required (or clear=true)");
    }
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "POST",
          path: "/set/credentials",
          profile,
          body: { targetId, username, password, clear },
        }),
      );
    }
    return jsonResult(
      await browserSetHttpCredentials(baseUrl, { username, password, clear, targetId, profile }),
    );
  },

  set_geolocation: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    const clear = readBooleanParam(params, "clear") ?? false;
    const latitude = readNumberParam(params, "latitude");
    const longitude = readNumberParam(params, "longitude");
    const accuracy = readNumberParam(params, "accuracy");
    const origin = readStringParam(params, "origin");
    if (!clear && (latitude === undefined || longitude === undefined)) {
      throw new ToolInputError("latitude and longitude required (or clear=true)");
    }
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "POST",
          path: "/set/geolocation",
          profile,
          body: { targetId, latitude, longitude, accuracy, origin, clear },
        }),
      );
    }
    return jsonResult(
      await browserSetGeolocation(baseUrl, {
        latitude,
        longitude,
        accuracy,
        origin,
        clear,
        targetId,
        profile,
      }),
    );
  },

  clear_permissions: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "POST",
          path: "/set/geolocation",
          profile,
          body: { targetId, clear: true },
        }),
      );
    }
    return jsonResult(await browserClearPermissions(baseUrl, { targetId, profile }));
  },

  set_media: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    const colorScheme = readColorScheme(params);
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "POST",
          path: "/set/media",
          profile,
          body: { targetId, colorScheme },
        }),
      );
    }
    return jsonResult(await browserSetMedia(baseUrl, { colorScheme, targetId, profile }));
  },

  set_timezone: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    const timezoneId = readStringParam(params, "timezoneId", { required: true });
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "POST",
          path: "/set/timezone",
          profile,
          body: { targetId, timezoneId },
        }),
      );
    }
    return jsonResult(await browserSetTimezone(baseUrl, { timezoneId, targetId, profile }));
  },

  set_locale: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    const locale = readStringParam(params, "locale", { required: true });
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "POST",
          path: "/set/locale",
          profile,
          body: { targetId, locale },
        }),
      );
    }
    return jsonResult(await browserSetLocale(baseUrl, { locale, targetId, profile }));
  },

  set_device: async ({ params, profile, baseUrl, proxyRequest }) => {
    const targetId = readTargetId(params);
    const name = readStringParam(params, "device", { required: true });
    if (proxyRequest) {
      return jsonResult(
        await proxyRequest({
          method: "POST",
          path: "/set/device",
          profile,
          body: { targetId, name },
        }),
      );
    }
    return jsonResult(await browserSetDevice(baseUrl, { name, targetId, profile }));
  },
};

/** Dispatch a browser state action; the caller has already resolved target/base URL/proxy. */
export async function runBrowserStateAction(
  action: BrowserStateAction,
  ctx: BrowserStateActionContext,
): Promise<AgentToolResult<unknown>> {
  return await STATE_ACTION_HANDLERS[action](ctx);
}

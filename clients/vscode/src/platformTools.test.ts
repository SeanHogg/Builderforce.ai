/**
 * chatId translation at the platform-tool dispatch boundary (slice 1 of the
 * VSIX local↔server id-space fix).
 *
 * The model sees only LOCAL chat ids (e.g. local chat #46169, server chat #203).
 * A `chatId` arg equal to this run's known local id must reach the gateway relay
 * as the bound SERVER chat id — otherwise the server looks up a local id it has
 * never heard of and the call fails as "Chat not found" (HTTP 502). An UNBOUND
 * chat is a named error instead of a wasted round trip; any other `chatId`
 * (another chat's, or no identity supplied) passes through verbatim, as before.
 *
 * `./gateway` is mocked (key + fixed http:// base URL) and `globalThis.fetch`
 * is stubbed to answer the catalog GET and capture the relay POST body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

vi.mock("vscode", () => ({}));

vi.mock("./gateway", () => ({
  getApiKey: vi.fn(async () => "test-api-key"),
  getBaseUrl: () => "http://api.test",
}));

import {
  clearPlatformToolsCache,
  listPlatformTools,
  type PlatformChatIdentity,
} from "./platformTools";

const secrets = {} as unknown as vscode.SecretStorage;

/** The one tool the stubbed catalog advertises (shape: gateway McpToolEntry). */
const CATALOG_ENTRY = {
  extensionId: "chats",
  tool: "list_tickets",
  name: "builtin_chats_list_tickets",
  description: "List a chat's tickets",
  parameters: { type: "object", properties: {} },
  mutates: false,
};

/** Relay POSTs captured by the fetch stub: `{ extensionId, tool, arguments }`. */
let posts: Array<{ url: string; body: unknown }>;
let catalogGets: number;

beforeEach(() => {
  posts = [];
  catalogGets = 0;
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "http://api.test/llm/v1/mcp/tools") {
      catalogGets += 1;
      return new Response(JSON.stringify({ tools: [CATALOG_ENTRY] }), { status: 200 });
    }
    if (url === "http://api.test/llm/v1/mcp/call") {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ result: { ok: true } }), { status: 200 });
    }
    return new Response("unexpected url", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Each case builds its own identity; the catalog cache must not leak across them.
  clearPlatformToolsCache();
});

/** The adapted platform tool under test, built with the given (or no) identity. */
async function toolFor(identity?: PlatformChatIdentity) {
  const tools = await listPlatformTools(secrets, identity);
  const tool = tools.find((t) => t.name === "builtin_chats_list_tickets");
  expect(tool).toBeDefined();
  return tool!;
}

describe("platformTools chatId translation", () => {
  it("sends the bound serverChatId when args.chatId equals the localChatId", async () => {
    const tool = await toolFor({ localChatId: 46169, serverChatId: 203 });
    const out = await tool.execute({ chatId: 46169, scope: "open" }, "");
    expect(out).toBe(`{"ok":true}`);
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({
      extensionId: "chats",
      tool: "list_tickets",
      arguments: { chatId: 203, scope: "open" },
    });
  });

  it("translates the string form of the localChatId too (args arrive as JSON)", async () => {
    const tool = await toolFor({ localChatId: 46169, serverChatId: 203 });
    await tool.execute({ chatId: "46169" }, "");
    expect(posts).toHaveLength(1);
    expect((posts[0].body as { arguments: unknown }).arguments).toEqual({ chatId: 203 });
  });

  it("returns the named error and never calls the relay when the chat is unbound", async () => {
    const tool = await toolFor({ localChatId: 46169, serverChatId: null });
    await expect(tool.execute({ chatId: 46169 }, "")).resolves.toBe(
      "chat_not_synced: chat 46169 has no server binding yet",
    );
    expect(posts).toHaveLength(0);
  });

  it("passes a non-matching chatId through unchanged (another chat's id)", async () => {
    const tool = await toolFor({ localChatId: 46169, serverChatId: 203 });
    await tool.execute({ chatId: 999, scope: "open" }, "");
    expect(posts).toHaveLength(1);
    expect((posts[0].body as { arguments: unknown }).arguments).toEqual({ chatId: 999, scope: "open" });
  });

  it("passes args without a chatId through unchanged", async () => {
    const tool = await toolFor({ localChatId: 46169, serverChatId: 203 });
    await tool.execute({ scope: "all", limit: 5 }, "");
    expect(posts).toHaveLength(1);
    expect((posts[0].body as { arguments: unknown }).arguments).toEqual({ scope: "all", limit: 5 });
  });

  it("keeps verbatim pass-through when no identity is supplied", async () => {
    const tool = await toolFor(undefined);
    await tool.execute({ chatId: 46169 }, "");
    expect(posts).toHaveLength(1);
    expect((posts[0].body as { arguments: unknown }).arguments).toEqual({ chatId: 46169 });
  });

  it("adapts per-identity within one catalog TTL (two chats cannot share an execute closure)", async () => {
    const first = await toolFor({ localChatId: 46169, serverChatId: 203 });
    const second = await toolFor({ localChatId: 777, serverChatId: 42 });
    expect(catalogGets).toBe(1); // raw entries cached, adapted per call
    await first.execute({ chatId: 46169 }, "");
    await second.execute({ chatId: 777 }, "");
    expect(posts).toHaveLength(2);
    expect((posts[0].body as { arguments: unknown }).arguments).toEqual({ chatId: 203 });
    expect((posts[1].body as { arguments: unknown }).arguments).toEqual({ chatId: 42 });
  });
});

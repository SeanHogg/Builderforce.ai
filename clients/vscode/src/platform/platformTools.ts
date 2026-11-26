import { createMcpRelay, createMcpCatalogCache, type RelayToolEntry as McpToolEntry } from "@seanhogg/builderforce-mcp";
import type * as vscode from "vscode";
import { getApiKey, getBaseUrl } from "../gateway/gateway";
import { GATEWAY_WORKSPACE_HEADER, gatewayAuthHeaders, gatewayWorkspaceHeaders, observeGatewayResponse } from "../auth/gatewayAuth";
import type { ToolDef } from "../tools/fileTools";
import { hostLog } from "../host/hostLog";
import { namesRunChat } from "../tickets/localTicketScope";
import { toolMutating } from "../tools/toolMutating";
import { describeNetworkError, retryOnConnectFailure } from "@seanhogg/builderforce-brain-embedded";
import { messageOf } from "../shared/messageOf";

/**
 * Platform tools = the SHARED, server-side capability catalog (projects, tasks,
 * OKRs, specs, …) exposed by the gateway MCP relay (`GET /llm/v1/mcp/tools`,
 * `POST /llm/v1/mcp/call`). The web Brain and this extension are BOTH thin
 * clients of that one catalog — there is no second copy of the tool list here.
 * Adding a capability server-side makes it appear in the IDE chat automatically.
 *
 * This module fetches the advertised catalog and adapts each entry to the
 * extension's {@link ToolDef} shape so the existing agent loop can dispatch it
 * alongside the local file tools. Calls are authed with the same gateway key the
 * chat stream uses, so the IDE "brain" and the web "brain" act as one.
 */


/** Best-effort stringify of a relay result for the model's tool message. */
function stringifyResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

// The advertised catalog is stable; cache it briefly so the chat doesn't refetch
// the tool list on every message. Keyed by base URL (busted on sign-out/URL change
// via clearPlatformToolsCache); short TTL covers a freshly-deployed catalog.
// The RAW entries are cached, not the adapted ToolDefs: each call adapts with the
// identity it is given, so two chats inside one TTL cannot inherit each other's
// `chatId` translation through a shared `execute` closure.
const catalogCache = createMcpCatalogCache<McpToolEntry[]>();

/**
 * The chat identity a platform-tool call's `chatId` arguments are translated through
 * at the dispatch boundary. `localChatId` is the id the model sees (a local chat's
 * view key — the run host's numeric chat id or the persistence chat id); the gateway
 * knows only `serverChatId`.
 */
export interface PlatformChatIdentity {
  /** The id this chat answers to locally. */
  localChatId: unknown;
  /** The server chat this local chat is bound to; `null` = not bound yet. */
  serverChatId: number | null;
  /**
   * The chat's LOCAL entity id (the client UUID its store row and sync mapping use).
   * Not sent to the relay: a locally written ticket stamps it so sync can link the
   * chat to the ticket (`localDomainToolRouting.ts`).
   */
  clientChatId?: string;
  /**
   * The chat's bound server id NOW, read at call time. `serverChatId` is what the run's start
   * bound; a sync receipt can rebind the chat while the run goes (bind made chat #281, the
   * chat's import landed as #282: the model kept passing 281 and read an empty chat). Absent:
   * `serverChatId` stands.
   */
  serverChatIdNow?: () => Promise<number | undefined>;
}

/**
 * `identity` reading its chat's bound server id live from the local chat identity (the chat's
 * mapping in the current account). A run whose local id is not a chat view key keeps its start's.
 */
export function liveChatIdentity(
  identity: PlatformChatIdentity,
  chats: { serverIdFor(localId: number): Promise<number | undefined> },
): PlatformChatIdentity {
  const localId = Number(identity.localChatId);
  if (!Number.isSafeInteger(localId) || localId <= 0) return identity;
  return { ...identity, serverChatIdNow: () => chats.serverIdFor(localId) };
}

/**
 * The run's chat's bound server id: the live binding when the host can read it, else the run's
 * start. A failed live read is REPORTED (`report`, the host log by default) and the start's id
 * stands, so one store read failing never breaks every chat-scoped tool.
 */
export async function runServerChatId(
  identity: PlatformChatIdentity,
  report: (line: string) => void = hostLog,
): Promise<number | null> {
  if (!identity.serverChatIdNow) return identity.serverChatId;
  try {
    return (await identity.serverChatIdNow()) ?? identity.serverChatId;
  } catch (error) {
    report(`[platform tools] reading the live server chat of local chat ${String(identity.localChatId)} failed; using the run's start binding (${String(identity.serverChatId)}): ${messageOf(error)}`);
    return identity.serverChatId;
  }
}

/**
 * The `chatId` to send the platform for one tool call's args. The model may pass the
 * LOCAL chat id (it sees only local ids) or the server id the run bound at its start:
 * either names this run's chat ({@link namesRunChat}), and the chat's CURRENT bound
 * server id goes instead ({@link runServerChatId}). An UNBOUND chat is a named error
 * rather than a 502 round trip; an args chatId that is not this chat's (another chat's,
 * or no identity supplied) passes through untouched.
 */
async function chatIdForServer(
  identity: PlatformChatIdentity | undefined,
  args: Record<string, unknown>,
): Promise<{ args: Record<string, unknown> } | { error: string }> {
  const argChatId = args.chatId;
  if (identity == null || !namesRunChat(identity, argChatId)) return { args };
  const serverChatId = await runServerChatId(identity);
  if (serverChatId == null) {
    return { error: `chat_not_synced: chat ${String(argChatId)} has no server binding yet` };
  }
  return { args: argChatId === serverChatId ? args : { ...args, chatId: serverChatId } };
}

/** Drop the cached catalog (call on sign-out / workspace change). */
export function clearPlatformToolsCache(): void {
  catalogCache.clear();
}

/**
 * Fetch the shared platform-tool catalog and adapt it to ToolDef[]. Returns an
 * empty list (never throws) when signed out or the relay is unreachable, so the
 * chat keeps working with just the local file tools.
 *
 * `identity` is THIS chat's local↔server binding: when given, an `execute` that
 * receives a `chatId` equal to the known local id sends the bound server id to the
 * relay instead, so server-side tools never see a local chat id. Omit it (webviews,
 * one-off fetches) and arguments pass through verbatim, as before.
 */
export async function listPlatformTools(
  secrets: vscode.SecretStorage,
  identity?: PlatformChatIdentity,
): Promise<ToolDef[]> {
  const key = await getApiKey(secrets);
  if (!key) {
    catalogCache.clear();
    return [];
  }
  const url = getBaseUrl();
  const catalogKey = JSON.stringify([url, gatewayWorkspaceHeaders()[GATEWAY_WORKSPACE_HEADER], key]);
  let entries: McpToolEntry[];
  try {
    entries = await catalogCache.get(catalogKey, async () => {
      const headers = gatewayAuthHeaders(key, { "content-type": "application/json" });
      const response = observeGatewayResponse(await retryOnConnectFailure(() => fetch(`${url}/llm/v1/mcp/tools`, { headers })), headers);
      if (!response.ok) throw new Error(`tool catalog unavailable (HTTP ${response.status})`);
      const body = (await response.json()) as { tools?: McpToolEntry[] };
      return Array.isArray(body.tools) ? body.tools : [];
    });
  } catch {
    return [];
  }

  const tools = entries.map((e): ToolDef => ({
    name: e.name,
    description: e.description,
    parameters: e.parameters ?? { type: "object", properties: {} },
    // Fail safe: only a tool that explicitly advertises mutates=false skips the
    // write-confirm gate; anything else (incl. external tools that omit it) asks.
    mutating: toolMutating(e.name, { mutates: e.mutates }),
    remote: true,
    execute: async (args) => {
      const translated = await chatIdForServer(identity, args);
      if ("error" in translated) return translated.error;
      return callPlatformTool(secrets, e.extensionId, e.tool, translated.args);
    },
  }));
  return tools;
}

function platformRelay(baseUrl: string, key: string) {
  const headers = gatewayAuthHeaders(key);
  return createMcpRelay({
    baseUrl, headers,
    // Retry connection failures only, before a write could have reached the gateway.
    fetch: async (input, init) => observeGatewayResponse(await retryOnConnectFailure(() => fetch(input, init)), headers),
  });
}

/** Invoke one platform tool through the gateway MCP relay; returns its result text. */
export async function callPlatformTool(
  secrets: vscode.SecretStorage,
  extensionId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  const key = await getApiKey(secrets);
  if (!key) throw new Error("not signed in");
  const res = await platformRelay(getBaseUrl(), key).call({ extensionId, tool, arguments: args }).catch((error: unknown) => {
    throw new Error(describeNetworkError(error), { cause: error });
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) msg = parsed.error;
    } catch {
      /* non-JSON */
    }
    throw new Error(`${msg} (HTTP ${res.status})`);
  }
  try {
    const parsed = JSON.parse(text) as { result?: unknown };
    return stringifyResult("result" in parsed ? parsed.result : parsed);
  } catch {
    return text;
  }
}

// The human one-liner for a platform tool call (approval prompt / activity row) lives
// with the rest of the run's labelling in `nativeRunTool.toolLabel` — it needs the
// local/remote split to choose between the two phrasings, and having half of that
// decision here is what let a second copy grow inside the old SDK adapter.

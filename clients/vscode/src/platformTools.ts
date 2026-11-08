import type * as vscode from "vscode";
import { getApiKey, getBaseUrl } from "./gateway";
import { GATEWAY_WORKSPACE_HEADER, gatewayAuthHeaders, gatewayWorkspaceHeaders, observeGatewayResponse } from "./gatewayAuth";
import type { ToolDef } from "./fileTools";
import { toolMutating } from "./toolMutating";
import { ttlCache } from "./ttlCache";
import { describeNetworkError, retryOnConnectFailure } from "@seanhogg/builderforce-brain-embedded";

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

/** One advertised tool from the gateway MCP relay (mirror of api McpToolEntry). */
interface McpToolEntry {
  extensionId: string;
  /** Original tool name on the owning server, sent back on the relay call. */
  tool: string;
  /** Flat, gateway-safe name the model sees (e.g. `builtin_tasks_create`). */
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Whether the tool writes. Undefined (external servers) ⇒ treat as mutating. */
  mutates?: boolean;
}

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
const CATALOG_TTL = 60_000;
const catalogCache = ttlCache<string, McpToolEntry[]>(CATALOG_TTL);

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
}

/**
 * The `chatId` to send the platform for one tool call's args. The model may pass the
 * LOCAL chat id (it sees only local ids): when it matches this run's known local id
 * AND the run's local chat is bound, the bound server id goes instead. An UNBOUND
 * chat is a named error rather than a 502 round trip; an args chatId that is not this
 * chat's (another chat's, or no identity supplied) passes through untouched.
 */
function chatIdForServer(
  identity: PlatformChatIdentity | undefined,
  args: Record<string, unknown>,
): { args: Record<string, unknown> } | { error: string } {
  const argChatId = args.chatId;
  if (identity == null || argChatId === undefined) return { args };
  // The model's args arrive as JSON: the same chat id may be the run host's number or
  // its string form. Anything else is a different chat's id and passes through.
  if (String(argChatId) !== String(identity.localChatId)) return { args };
  if (identity.serverChatId == null) {
    return { error: `chat_not_synced: chat ${String(argChatId)} has no server binding yet` };
  }
  return { args: argChatId === identity.serverChatId ? args : { ...args, chatId: identity.serverChatId } };
}

/** Drop the cached catalog (call on sign-out / workspace change). */
export function clearPlatformToolsCache(): void {
  catalogCache.invalidate();
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
  if (!key) return [];
  const url = getBaseUrl();
  // The catalog is per workspace: the gateway resolves the key to the selected tenant.
  const catalogKey = `${url}|${gatewayWorkspaceHeaders()[GATEWAY_WORKSPACE_HEADER] ?? ""}`;
  const cached = catalogCache.get(catalogKey);
  let entries: McpToolEntry[];
  if (cached) {
    entries = cached.value;
  } else {
    try {
      // A run that starts while the network is down would otherwise hold NO platform tools,
      // and every `builtin_*` call it was told to make would fail as an unknown tool.
      const headers = gatewayAuthHeaders(key, { "content-type": "application/json" });
      const res = observeGatewayResponse(await retryOnConnectFailure(() => fetch(`${url}/llm/v1/mcp/tools`, {
        headers,
      })), headers);
      if (!res.ok) return [];
      const body = (await res.json()) as { tools?: McpToolEntry[] };
      entries = Array.isArray(body.tools) ? body.tools : [];
    } catch {
      return [];
    }
    catalogCache.set(catalogKey, entries);
  }

  const tools = entries.map((e): ToolDef => ({
    name: e.name,
    description: e.description,
    parameters: e.parameters ?? { type: "object", properties: {} },
    // Fail safe: only a tool that explicitly advertises mutates=false skips the
    // write-confirm gate; anything else (incl. external tools that omit it) asks.
    mutating: toolMutating(e.name, { mutates: e.mutates }),
    remote: true,
    execute: (args) => {
      const translated = chatIdForServer(identity, args);
      if ("error" in translated) return Promise.resolve(translated.error);
      return callPlatformTool(secrets, e.extensionId, e.tool, translated.args);
    },
  }));
  return tools;
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
  // Sent again only while the connection cannot be opened — then nothing reached the
  // gateway, so even a write is safe to repeat. Any other failure is reported as it is.
  const headers = gatewayAuthHeaders(key, { "content-type": "application/json" });
  const res = await retryOnConnectFailure(() => fetch(`${getBaseUrl()}/llm/v1/mcp/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ extensionId, tool, arguments: args }),
  })).then((r) => observeGatewayResponse(r, headers)).catch((e: unknown) => {
    throw new Error(describeNetworkError(e), { cause: e });
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
// with the rest of the run's labelling in `nativeBrainRun.toolLabel` — it needs the
// local/remote split to choose between the two phrasings, and having half of that
// decision here is what let a second copy grow inside the old SDK adapter.

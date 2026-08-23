/**
 * Connector access for cloud coding agents.
 *
 * The web Brain and the VS Code chat get connector actions for free: they load
 * `GET /llm/v1/mcp/tools` and register every advertised entry, so a new connector
 * appears in their tool list with no client change. This runtime does not — its
 * tool list is assembled synchronously at session start from a fixed set — so
 * without these two tools a cloud agent is the ONE surface that cannot touch a
 * tenant's connected systems.
 *
 * ── WHY TWO GENERIC TOOLS AND NOT N ADVERTISED ONES ──────────────────────────
 * Fanning the catalog out into one tool per action would mean making the whole
 * tool-assembly path async, and would put an unbounded number of tool definitions
 * (25 built-in connectors is ~120 actions, before anything custom) into the prompt
 * of every coding run — crowding out the code tools that are the agent's actual
 * job. Instead the catalog is DISCOVERED at call time:
 *
 *   connectors_list  → what is connected, and what each can do
 *   connector_call   → invoke one action
 *
 * Two definitions, constant prompt cost, and a tenant connecting a new system is
 * immediately usable with no redeploy. The trade is one extra round-trip when an
 * agent first needs a connector, which is the right price.
 */

import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "../model/agent-types.js";
import { readSharedEnvVar } from "../../infra/env-file.js";
import { jsonResult } from "../../agents/tools/common.js";

/** Sentinel the gateway routes to the connector runtime. Mirrors `connectorTools.ts`. */
const CONNECTOR_EXTENSION_ID = "connector";
/** Separator inside the round-tripped tool value: `<connectorKey>::<actionKey>`. */
const TOOL_SEP = "::";

const GATEWAY_TIMEOUT_MS = 30_000;

interface GatewayToolEntry {
  extensionId: string;
  tool: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mutates?: boolean;
}

function resolveGateway(): { base: string; apiKey: string } | { error: string } {
  const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
  const baseUrl = readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai";
  if (!apiKey) {
    return {
      error:
        "BUILDERFORCE_API_KEY not set; cannot reach the platform gateway. " +
        "Set it in ~/.builderforce/.env to use connectors.",
    };
  }
  return { base: baseUrl.replace(/\/+$/, ""), apiKey };
}

/** Fetch the tenant's advertised catalog and keep only the connector entries. */
async function fetchConnectorEntries(): Promise<GatewayToolEntry[] | { error: string }> {
  const gw = resolveGateway();
  if ("error" in gw) return gw;
  try {
    // `?surface=connectors` asks the gateway for the connector source ALONE. Without
    // it this call downloaded the entire platform catalog (300+ tool definitions with
    // full JSON-Schemas) on every `connectors_list`, only to throw all of it away one
    // line later. The client-side filter stays as the belt: a gateway too old to know
    // the parameter ignores it and answers with everything, which must still be correct.
    const res = await fetch(`${gw.base}/llm/v1/mcp/tools?surface=connectors`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${gw.apiKey}` },
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    if (!res.ok) return { error: `Gateway returned ${res.status} listing connector tools` };
    const body = (await res.json()) as { tools?: GatewayToolEntry[] };
    return (body.tools ?? []).filter((t) => t.extensionId === CONNECTOR_EXTENSION_ID);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const ConnectorsListSchema = Type.Object({
  connector: Type.Optional(
    Type.String({
      description:
        "Only describe this connector (e.g. slack, hubspot). Omit to list every connected connector.",
    }),
  ),
});

export const connectorsListTool: AgentTool<typeof ConnectorsListSchema, string> = {
  name: "connectors_list",
  label: "List Connectors",
  description:
    "List the external systems this workspace has connected (Slack, HubSpot, Stripe, Jira, custom APIs …) and the actions available on each, with the inputs every action takes. " +
    "Call this before connector_call so you use a real connector key, action key and argument names. Only connected systems are listed.",
  parameters: ConnectorsListSchema,
  async execute(_toolCallId: string, params: { connector?: string }) {
    const entries = await fetchConnectorEntries();
    if ("error" in entries) return jsonResult(entries) as AgentToolResult<string>;

    // Regroup the flat tool list back into connector → actions, which is what the
    // model needs to reason about ("can I reach their CRM?") and is far cheaper to
    // read than 120 separate tool definitions.
    const byConnector = new Map<string, Array<Record<string, unknown>>>();
    for (const entry of entries) {
      const sep = entry.tool.indexOf(TOOL_SEP);
      if (sep <= 0) continue;
      const connectorKey = entry.tool.slice(0, sep);
      const actionKey = entry.tool.slice(sep + TOOL_SEP.length);
      if (params.connector && params.connector !== connectorKey) continue;
      const list = byConnector.get(connectorKey) ?? [];
      list.push({
        action: actionKey,
        description: entry.description,
        mutates: entry.mutates !== false,
        input: entry.parameters,
      });
      byConnector.set(connectorKey, list);
    }

    if (byConnector.size === 0) {
      return jsonResult({
        connectors: [],
        note: params.connector
          ? `No connected connector named "${params.connector}". Connect it under Settings → Integrations → Connectors first.`
          : "No connectors are connected in this workspace yet. They are configured under Settings → Integrations → Connectors.",
      }) as AgentToolResult<string>;
    }

    return jsonResult({
      connectors: [...byConnector.entries()].map(([connector, actions]) => ({ connector, actions })),
    }) as AgentToolResult<string>;
  },
};

const ConnectorCallSchema = Type.Object({
  connector: Type.String({ description: "Connector key from connectors_list, e.g. slack." }),
  action: Type.String({ description: "Action key from connectors_list, e.g. post_message." }),
  input: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Arguments for the action, matching the input schema connectors_list reported.",
    }),
  ),
});

export const connectorCallTool: AgentTool<typeof ConnectorCallSchema, string> = {
  name: "connector_call",
  label: "Call Connector Action",
  description:
    "Run one action on a connected external system — post a Slack message, create a HubSpot contact, open a Zendesk ticket, call any custom connector. " +
    "Use connectors_list first to get the exact connector key, action key and input fields. Actions marked mutates:true change data in the customer's system, so only call those when the task asks for it.",
  parameters: ConnectorCallSchema,
  async execute(
    _toolCallId: string,
    params: { connector: string; action: string; input?: Record<string, unknown> },
  ) {
    const gw = resolveGateway();
    if ("error" in gw) return jsonResult(gw) as AgentToolResult<string>;
    try {
      const res = await fetch(`${gw.base}/llm/v1/mcp/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${gw.apiKey}` },
        body: JSON.stringify({
          extensionId: CONNECTOR_EXTENSION_ID,
          tool: `${params.connector}${TOOL_SEP}${params.action}`,
          arguments: params.input ?? {},
        }),
        signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
      });
      const text = await res.text();
      let payload: unknown;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }
      // An upstream failure is DATA the model should read and react to (fix an
      // argument, pick another action), not a thrown error that ends the run.
      if (!res.ok) {
        return jsonResult({
          error: `Connector call failed (${res.status})`,
          response: payload,
          hint: "Call connectors_list to confirm the connector key, action key and required inputs.",
        }) as AgentToolResult<string>;
      }
      return jsonResult(payload as Record<string, unknown>) as AgentToolResult<string>;
    } catch (err) {
      return jsonResult({
        error: err instanceof Error ? err.message : String(err),
      }) as AgentToolResult<string>;
    }
  },
};

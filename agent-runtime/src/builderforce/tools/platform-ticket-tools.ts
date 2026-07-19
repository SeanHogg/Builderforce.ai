/**
 * Platform-relay tools for external CLI callers (Cursor / Claude Code / Continue).
 *
 * These bridge two server-side built-in MCP tools — `tickets.from_delta` and
 * `reviews.record` — so an external coding tool reaching this runtime's local MCP
 * server can also record code deltas and Done-item review outcomes on the board.
 *
 * There is no existing relay from this runtime to the platform gateway's builtin
 * MCP catalog, so we add a thin one here: each tool forwards to
 * `${base}/llm/v1/mcp/call` with `{ extensionId:'builtin', tool, arguments }`, using
 * the same `BUILDERFORCE_URL` / `BUILDERFORCE_API_KEY` base+bearer pattern the rest of
 * agent-runtime uses to reach the gateway (see server-startup.ts, node-orchestration-tools.ts).
 */

import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "../model/agent-types.js";
import { readSharedEnvVar } from "../../infra/env-file.js";
import { jsonResult } from "../../agents/tools/common.js";

/**
 * Relay a call to a server-side built-in MCP tool via the platform gateway.
 * Mirrors the base+bearer resolution used elsewhere in agent-runtime.
 */
async function callBuiltinMcp(
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
  const baseUrl = readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai";
  if (!apiKey) {
    return {
      error:
        "BUILDERFORCE_API_KEY not set; cannot reach the platform gateway. " +
        "Set it in ~/.builderforce/.env to record deltas/reviews on the board.",
    };
  }
  const base = baseUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/llm/v1/mcp/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ extensionId: "builtin", tool, arguments: args }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!res.ok) {
      return { error: `Gateway returned ${res.status}`, response: payload };
    }
    return { ok: true, result: payload };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const KIND = Type.Union([Type.Literal("improvement"), Type.Literal("fix"), Type.Literal("bug")]);

const TicketsFromDeltaSchema = Type.Object({
  projectId: Type.Number({ description: "Project the change belongs to." }),
  summary: Type.String({ description: "One-line summary of the code change." }),
  detail: Type.Optional(Type.String({ description: "Optional longer description." })),
  kind: Type.Optional(KIND),
  files: Type.Optional(
    Type.Array(Type.String(), { description: "Files touched by the change." }),
  ),
  modality: Type.Optional(Type.String()),
  chatId: Type.Optional(Type.Number()),
  createTicket: Type.Optional(
    Type.Boolean({ description: "Whether to open a board ticket for the delta." }),
  ),
});

type TicketsFromDeltaParams = {
  projectId: number;
  summary: string;
  detail?: string;
  kind?: "improvement" | "fix" | "bug";
  files?: string[];
  modality?: string;
  chatId?: number;
  createTicket?: boolean;
};

export const ticketsFromDeltaTool: AgentTool<typeof TicketsFromDeltaSchema, string> = {
  name: "tickets_from_delta",
  label: "Record Code Delta",
  description:
    "Record a code change as a ticket on the Builderforce board so the change is visible. Provide a one-line summary, the kind (improvement | fix | bug), and the files touched.",
  parameters: TicketsFromDeltaSchema,
  async execute(_toolCallId: string, params: TicketsFromDeltaParams) {
    return jsonResult(
      await callBuiltinMcp("tickets.from_delta", params as Record<string, unknown>),
    ) as AgentToolResult<string>;
  },
};

const VERDICT = Type.Union([Type.Literal("complete"), Type.Literal("gaps")]);
const PRIORITY = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("urgent"),
]);

const ReviewsRecordSchema = Type.Object({
  taskId: Type.Number({ description: "The Done work item being reviewed." }),
  verdict: VERDICT,
  summary: Type.String({ description: "Summary of the acceptance-review outcome." }),
  reviewerRef: Type.Optional(Type.String({ description: "Identifier of the reviewer." })),
  gaps: Type.Optional(
    Type.Array(
      Type.Object({
        title: Type.String(),
        detail: Type.Optional(Type.String()),
        priority: Type.Optional(PRIORITY),
      }),
      { description: "One entry per missing piece; each becomes a GAP task." },
    ),
  ),
});

type ReviewsRecordParams = {
  taskId: number;
  verdict: "complete" | "gaps";
  summary: string;
  reviewerRef?: string;
  gaps?: Array<{ title: string; detail?: string; priority?: "low" | "medium" | "high" | "urgent" }>;
};

export const reviewsRecordTool: AgentTool<typeof ReviewsRecordSchema, string> = {
  name: "reviews_record",
  label: "Record Review Outcome",
  description:
    "Report a Done-item acceptance review. Use verdict 'complete' when the delivered code fully satisfies the ticket, or 'gaps' with one gaps[] entry per missing piece (each becomes a GAP task).",
  parameters: ReviewsRecordSchema,
  async execute(_toolCallId: string, params: ReviewsRecordParams) {
    return jsonResult(
      await callBuiltinMcp("reviews.record", params as Record<string, unknown>),
    ) as AgentToolResult<string>;
  },
};

const SEVERITY = Type.Union([
  Type.Literal("critical"),
  Type.Literal("high"),
  Type.Literal("medium"),
  Type.Literal("low"),
  Type.Literal("info"),
]);
const TSC = Type.Union([
  Type.Literal("security"),
  Type.Literal("availability"),
  Type.Literal("processing_integrity"),
  Type.Literal("confidentiality"),
  Type.Literal("privacy"),
]);

const SecurityRecordSchema = Type.Object({
  title: Type.String({ description: "Short, specific finding title." }),
  detail: Type.Optional(Type.String({ description: "What the issue is and why it matters." })),
  severity: Type.Optional(SEVERITY),
  tsc: Type.Optional(TSC),
  location: Type.Optional(Type.String({ description: "file:line or component." })),
  recommendation: Type.Optional(Type.String({ description: "Concrete, actionable fix." })),
  auditId: Type.Optional(Type.Number({ description: "The audit run to attach to (defaults to the current run)." })),
});

type SecurityRecordParams = {
  title: string;
  detail?: string;
  severity?: "critical" | "high" | "medium" | "low" | "info";
  tsc?: "security" | "availability" | "processing_integrity" | "confidentiality" | "privacy";
  location?: string;
  recommendation?: string;
  auditId?: number;
};

export const securityRecordTool: AgentTool<typeof SecurityRecordSchema, string> = {
  name: "security_record",
  label: "Record Security Finding",
  description:
    "File ONE SOC 2 audit finding. Each call mints an access-restricted SECURITY ticket carrying the severity, the Trust Service Criterion (security|availability|processing_integrity|confidentiality|privacy), a location, and a recommendation.",
  parameters: SecurityRecordSchema,
  async execute(_toolCallId: string, params: SecurityRecordParams) {
    return jsonResult(
      await callBuiltinMcp("security.record_finding", params as Record<string, unknown>),
    ) as AgentToolResult<string>;
  },
};

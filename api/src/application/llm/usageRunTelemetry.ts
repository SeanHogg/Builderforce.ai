/**
 * The run telemetry a GATEWAY call's usage row carries (PRD 35 §8.2, WS6).
 *
 * Three facts the per-turn cost metrics and the §8.1 baseline read off
 * `llm_usage_log`, which only the cloud loop ever wrote — so every VS Code, web and
 * on-prem gateway row landed with them NULL:
 *
 *   • `entry_point`        which entry point ran the call. A client states it in
 *     `x-builderforce-entry-point`; it is a telemetry LABEL only (§5 rule 3 — never
 *     branched on, never a billing input), so it needs no corroboration beyond being
 *     one of the client labels. `cloud` is not accepted off the wire: cloud turns
 *     record through `cloudLlmTurn`, never this HTTP path.
 *   • `turn_index`         the 1-based position of the call in its run's loop, from
 *     `x-builderforce-turn-index`. Only the client knows its loop; absent ⇒ NULL.
 *   • `tool_schema_tokens` MEASURED here from the request's own `tools` — the same
 *     chars/4 estimate the cloud loop stamps (`toolSchemaTokens`) — so no client has
 *     to report it and none can misreport it.
 *
 * Pure: headers and body in, three nullable values out. Never throws.
 */

import { CLIENT_ENTRY_POINTS, type ClientEntryPoint } from '@builderforce/learned-routing';
import { toolSchemaTokens } from '../costMetrics/contextCategories';

export const ENTRY_POINT_HEADER = 'x-builderforce-entry-point';
export const TURN_INDEX_HEADER = 'x-builderforce-turn-index';

/** A turn index above this is not a run's loop position — it is a broken client. */
const TURN_INDEX_MAX = 100_000;

export interface UsageRunTelemetry {
  entryPoint: ClientEntryPoint | null;
  turnIndex: number | null;
  toolSchemaTokens: number | null;
}

export function readUsageRunTelemetry(
  header: (name: string) => string | undefined,
  body: { tools?: unknown } | null | undefined,
): UsageRunTelemetry {
  const label = (header(ENTRY_POINT_HEADER) ?? '').trim().toLowerCase();
  const entryPoint = (CLIENT_ENTRY_POINTS as readonly string[]).includes(label) ? (label as ClientEntryPoint) : null;
  const rawTurn = (header(TURN_INDEX_HEADER) ?? '').trim();
  const turn = /^\d+$/.test(rawTurn) ? Number(rawTurn) : NaN;
  const turnIndex = turn >= 1 && turn <= TURN_INDEX_MAX ? turn : null;
  const tools = body && Array.isArray(body.tools) ? (body.tools as unknown[]) : null;
  return { entryPoint, turnIndex, toolSchemaTokens: tools && tools.length > 0 ? toolSchemaTokens(tools) : null };
}

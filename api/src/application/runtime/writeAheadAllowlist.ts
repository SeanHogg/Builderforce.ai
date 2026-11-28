import { WORKSPACE_INSPECTION_TOOLS } from '@builderforce/agent-tools';
import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * The PRD 39 §4b write-ahead RE-RUN ALLOWLIST — the ONE thing that decides whether a
 * tool is safe to re-run on a failover host. This is an explicit, enumerated config list
 * of tool names (reads / idempotent), NOT a free-form `category` match: the audit
 * `category` column is free-form (schema/agents.ts), so matching on it would classify
 * untrusted data. If a tool is not named here it is treated as NON-allowlisted.
 *
 * COST (PRD 39 §4b "Cost" line). Every NON-allowlisted tool call on a write-ahead host
 * gains one server round trip before it runs (its intent must be acknowledged). The
 * allowlist keeps reads — and any other idempotent call listed here — off that path, so
 * they pay no extra round trip.
 *
 * GROWING THE LIST: add a tool ONLY when re-running it cannot repeat or double a side
 * effect (a push, a POST, a mutation). Pure reads and idempotent gets qualify; anything
 * that writes external state does not. When in doubt, do NOT add it — the cost of a
 * false negative is one explicit "ask a human" failure; the cost of a false positive is
 * a repeated side effect.
 */
export const WRITE_AHEAD_ALLOWLIST: ReadonlySet<string> = new Set([
  // Read-only workspace / code inspection.
  ...WORKSPACE_INSPECTION_TOOLS,
  // Read-only platform lookups.
  'recall_facts',
]);

/** Whether `toolName` may be re-run without a server ack — it is on the explicit allowlist. */
export function isAllowlistedTool(toolName: string): boolean {
  return WRITE_AHEAD_ALLOWLIST.has(toolName);
}

/** Required write-ahead protocol version, stamped on the payload at dispatch so a host
 *  can confirm it speaks the protocol before advertising support (writeAhead:1). */
export const WRITE_AHEAD_PROTOCOL_VERSION = 1;

/** Payload key a write-ahead-capable host sets when it claims the run at ack time
 *  (relay `task.assign` ack). Parsed by the reaper to decide whether failover re-dispatch
 *  is even possible; absent ⇒ an old host, which fails at the deadline exactly as today. */
export function withWriteAheadSupport(payload: string | null | undefined): string {
  const obj = safeParse(payload);
  obj.writeAhead = WRITE_AHEAD_PROTOCOL_VERSION;
  return JSON.stringify(obj);
}

/** Read back the advertised support from a payload (null ⇒ the host never advertised —
 *  "no intent proves nothing" for old hosts, so their runs are NOT re-dispatched). */
export function parseWriteAheadSupport(payload: string | null | undefined): number | null {
  const obj = safeParse(payload);
  return typeof obj.writeAhead === 'number' ? obj.writeAhead : null;
}

function safeParse(payload: string | null | undefined): Record<string, unknown> {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/writeAheadAllowlist.ts', operation: 'safeParse', context: { logMessage: '[write-ahead] unparseable run payload; treating as no advertised support', details: { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) } } });
    return {};
  }
}

import type { ChatTicketsAdapter } from './types';

/** Resolved permission to dispatch a run, plus the host's localized explanation. */
export interface RunGate {
  allowed: boolean;
  /** Host-localized sentence for the disabled control's tooltip. */
  reason?: string;
}

/**
 * Resolve whether the host permits run dispatch.
 *
 * Extracted from the panel because the DEFAULT is the subtle part and deserves to
 * be pinned by a test rather than living as an inline `??` nobody re-reads: a host
 * that does NOT implement `canRunTicket` is treated as PERMITTED.
 *
 * That default is deliberate. This package is surface-agnostic — it renders in the
 * web app (which has tenant roles) and in the VS Code webview (which has none).
 * Defaulting to DENIED would disable the Run button outright in a surface that has
 * no way to answer the question, turning a missing capability into a dead control.
 * Enforcement does not rest on this either way: the web host's `runTicket` still
 * throws if the role is insufficient, so the gate is a signal, not the boundary.
 */
export function resolveRunGate(adapter: Pick<ChatTicketsAdapter, 'canRunTicket'>): RunGate {
  const probe = adapter.canRunTicket?.();
  if (!probe) return { allowed: true };
  return { allowed: probe.allowed, reason: probe.reason };
}

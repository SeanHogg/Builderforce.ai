/**
 * ClawStageDispatcher — pushes a claw-reachable (local/cloud/remote) dispatch to
 * a coderClaw runtime via the CLAW_RELAY Durable Object, mirroring the dispatch
 * pattern in runtimeRoutes.ts. Browser dispatches never reach here (the
 * coordinator leaves them `pending` for a browser pull worker).
 *
 * The relay binding is OPTIONAL: when unbound (e.g. local dev / tests) dispatch
 * returns not-accepted so the coordinator records the dispatch as failed instead
 * of hanging — the ticket then routes to needs_attention rather than silently
 * advancing.
 */
import type { DispatchLite } from './coordinatorStore';
import type { StageDispatcher } from './SwimlaneCoordinator';

/** Minimal shape of the CLAW_RELAY Durable Object namespace we use. */
export interface ClawRelayNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

export class ClawStageDispatcher implements StageDispatcher {
  constructor(private readonly relay: ClawRelayNamespace | undefined) {}

  async dispatch(d: DispatchLite): Promise<{ accepted: boolean; externalRef?: string; error?: string }> {
    if (!this.relay) {
      return { accepted: false, error: 'CLAW_RELAY not bound — no claw runtime available for dispatch.' };
    }
    // Route by the target encoded into the dispatch role (remote:<claw>:<role>),
    // falling back to the explicit target column.
    const clawTarget = parseClawTarget(d.role) ?? d.target ?? 'default';
    try {
      const stub = this.relay.get(this.relay.idFromName(String(clawTarget)));
      const res = await stub.fetch('https://claw/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'agent_dispatch',
          dispatchId: d.id,
          ticketRunId: d.ticketRunId,
          taskId: d.taskId,
          role: d.role,
          model: d.model,
          input: d.input,
        }),
      });
      if (!res.ok) {
        return { accepted: false, error: `claw relay returned ${res.status}` };
      }
      return { accepted: true, externalRef: d.id };
    } catch (err) {
      return { accepted: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Extract `<claw>` from a `remote:<claw>:<role>` encoded role, if present. */
export function parseClawTarget(role: string): string | null {
  const m = role.match(/^remote:([^:]+):/);
  return m?.[1] ?? null;
}

/**
 * host-policy-gates — the tenant's governance gates, for the runs that have no
 * dispatch payload.
 *
 * A ticket run is handed its gates inside the relay dispatch (`builderforce-relay.ts`).
 * A channel reply or a cron job is not dispatched by the platform, so nothing carried a
 * gate to it: a tenant `block` gate stopped a tool on a ticket and not on a chat reply.
 * `runEmbeddedAgent` — where channel, cron and CLI runs all converge — asks here when
 * its caller named no gates of its own.
 *
 * The api owns the gates (`GET /api/agent/governance/policy-gates`, the host-key door
 * over the same cached resolver dispatch uses) and answers with the wire shape
 * `coercePolicyGates` parses, so a gate reads identically on every surface. Scope is the
 * tenant: a channel/cron run has neither project nor ticket, so only tenant-wide packs
 * come back.
 *
 * Credentials are the host's ONE Builderforce link (`hostLink()`, set at gateway
 * startup) — the same one an approval request uses, so a gate that asks an approver and
 * the fetch that produced the gate share a credential and cannot disagree about linking.
 *
 * Failure behaviour, decided:
 *   - an unlinked host (no key / no host id) has no gates: it runs normally, no call, no
 *     warning;
 *   - a linked host whose fetch fails keeps the LAST GOOD set; with none held it runs
 *     with none and warns once per retry window, naming the failure. A network blip must
 *     not stop a channel reply, so this never throws and the wait is bounded;
 *   - a malformed answer is a failure (it never replaces a good set with an empty one).
 */
import { coercePolicyGates, type PolicyGate } from "@builderforce/agent-tools";
import { logWarn } from "../logger.js";
import { hostLink } from "./approval-gate.js";

/** How long an answer is trusted. A policy edit reaches a channel within this window. */
export const POLICY_GATES_TTL_MS = 60_000;
/** After a failed fetch, how long before the next attempt (so a down api costs one wait, not one per message). */
export const POLICY_GATES_RETRY_MS = 15_000;
/** The longest a run waits for the answer before proceeding on what it holds. */
const FETCH_TIMEOUT_MS = 4_000;

const POLICY_GATES_PATH = "/api/agent/governance/policy-gates";

interface Held {
  /** Which link these gates belong to: a re-linked host must not inherit another tenant's policy. */
  linkKey: string;
  gates: PolicyGate[] | null;
  fetchedAt: number;
  retryAt: number;
  inflight: Promise<PolicyGate[]> | null;
}

let held: Held | null = null;

/** Forget everything held. Tests, and an operator forcing a re-read. */
export function resetHostPolicyGates(): void {
  held = null;
}

async function fetchGates(link: NonNullable<ReturnType<typeof hostLink>>): Promise<PolicyGate[]> {
  const res = await fetch(`${link.baseUrl}${POLICY_GATES_PATH}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${link.apiKey}`,
      "X-AgentHost-Id": link.agentNodeId,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const body = (await res.json()) as { gates?: unknown };
  if (!Array.isArray(body?.gates)) {
    throw new Error("malformed response (no gates array)");
  }
  return coercePolicyGates(body.gates);
}

/**
 * The gates a channel / cron run is held to. Never throws.
 * `now` is injectable so the TTL is testable without fake timers.
 */
export async function resolveHostPolicyGates(now: number = Date.now()): Promise<PolicyGate[]> {
  const link = hostLink();
  if (!link) {
    return [];
  }
  const linkKey = `${link.baseUrl}\n${link.agentNodeId}\n${link.apiKey}`;
  if (held?.linkKey !== linkKey) {
    held = { linkKey, gates: null, fetchedAt: 0, retryAt: 0, inflight: null };
  }
  const state = held;

  if (state.gates && now - state.fetchedAt < POLICY_GATES_TTL_MS) {
    return state.gates;
  }
  if (now < state.retryAt) {
    return state.gates ?? [];
  }
  if (state.inflight) {
    return state.inflight;
  }

  state.inflight = fetchGates(link)
    .then((gates) => {
      state.gates = gates;
      state.fetchedAt = now;
      state.retryAt = 0;
      return gates;
    })
    .catch((err: unknown) => {
      state.retryAt = now + POLICY_GATES_RETRY_MS;
      const reason = err instanceof Error ? err.message : String(err);
      logWarn(
        `[policy-gates] could not fetch the tenant's governance gates (${reason}); ` +
          (state.gates
            ? `keeping the last good set (${state.gates.length} gate(s))`
            : "running with none"),
      );
      return state.gates ?? [];
    })
    .finally(() => {
      state.inflight = null;
    });
  return state.inflight;
}

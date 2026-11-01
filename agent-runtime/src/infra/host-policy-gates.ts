/**
 * host-policy-gates — the tenant's governance gates, for the runs that have no
 * dispatch payload.
 *
 * A ticket run is handed its gates inside the relay dispatch (`builderforce-relay.ts`)
 * and never reaches this module. A channel reply or a cron job is not dispatched by the
 * platform, so nothing carried a gate to it: a tenant `block` gate stopped a tool on a
 * ticket and not on a chat reply. Two entries ask here, so no caller has to feed them:
 *   - `runEmbeddedAgent` (the embedded runner: channel replies, cron, and commands run inside a gateway process, which holds the
 *     host's link; a one-off CLI command outside one has none and so no gates);
 *   - `runCliAgent` (a CLI-backend model, which cannot be gated at the tool seam).
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
 * Freshness: a policy edit reaches a run after the api's version token turns over (up to
 * 30s of isolate cache plus KV propagation, which is eventual) and then this host's
 * {@link POLICY_GATES_TTL_MS}. It is bounded by minutes, not instant.
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

/** How long an answer is trusted before this host asks again. */
export const POLICY_GATES_TTL_MS = 60_000;
/** After a failed fetch, how long before the next attempt (so a down api costs one wait, not one per message). */
export const POLICY_GATES_RETRY_MS = 15_000;
/** The longest a run waits for the answer before proceeding on what it holds. */
export const POLICY_GATES_FETCH_TIMEOUT_MS = 4_000;

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
    signal: AbortSignal.timeout(POLICY_GATES_FETCH_TIMEOUT_MS),
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
 * Times are read from the clock when each step finishes (a slow fetch must not make its own answer look older than it is).
 */
export async function resolveHostPolicyGates(): Promise<PolicyGate[]> {
  const link = hostLink();
  if (!link) {
    return [];
  }
  const linkKey = `${link.baseUrl}\n${link.agentNodeId}\n${link.apiKey}`;
  if (held?.linkKey !== linkKey) {
    held = { linkKey, gates: null, fetchedAt: 0, retryAt: 0, inflight: null };
  }
  const state = held;

  const now = Date.now();
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
      state.fetchedAt = Date.now();
      state.retryAt = 0;
      return gates;
    })
    .catch((err: unknown) => {
      state.retryAt = Date.now() + POLICY_GATES_RETRY_MS;
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

/**
 * The gates a run is held to: the tenant's, resolved at the embedded runner's one seam. A model liveness probe (set by the host, never by a
 * client) is not a governed run, and a run nobody can approve in time (`unattended`) has its approval gates turned into refusals.
 */
export async function gatesForRun(run: { modelProbe?: boolean; unattended?: boolean }): Promise<readonly PolicyGate[]> {
  if (run.modelProbe === true) {
    return [];
  }
  return forUnattendedRun(await resolveHostPolicyGates(), run.unattended === true);
}

/**
 * The gates for a run nobody can approve in time (a memory flush runs between turns): an
 * approval gate becomes a refusal on the same tool, at once, instead of a wait for an
 * approver who is not there. `block` and directive gates are unchanged.
 */
export function forUnattendedRun(gates: readonly PolicyGate[], unattended: boolean): readonly PolicyGate[] {
  if (!unattended) {
    return gates;
  }
  return gates.map((g) =>
    g.effect === "require-approval"
      ? { ...g, effect: "block" as const, reason: g.reason ?? "this action needs a person's approval, and none is available during this run" }
      : g,
  );
}

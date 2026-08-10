/**
 * Machine (service) token subjects — the ONE decoder for a JWT `sub` that is NOT a
 * person.
 *
 * Two prefixes are minted server-to-server and reach the same middleware a human
 * token does:
 *
 *   `agentHost:<id>`   — an on-prem agent host that exchanged its API key for a
 *                        short-lived JWT (`authRoutes` API-key exchange). `<id>` is
 *                        `agent_hosts.id`, so this sub carries a REAL agent identity.
 *   `agentHost:mcp`    — the built-in MCP relay replaying a route in-process on behalf
 *                        of a gateway key. No specific agent — a service caller.
 *   `embed:<keyId>`    — a short-lived embed-session token minted from a `bfk_*` key.
 *
 * None of them has a `users` row, which is why every consumer has to know the shape:
 * the auth middleware skips session/terms checks for them, the superadmin resolver
 * skips its user lookup, and the gateway skips the membership check. That test used to
 * be open-coded as `sub.startsWith('agentHost:')` in three places, each with its own
 * idea of which prefixes counted — and the ticket-lifecycle writer, which sees the sub
 * only as `userId`, had no idea any of it existed and stamped an agent host's lane move
 * as `actor_kind='human'` with `actor_ref='agentHost:5'`.
 *
 * Decoding it ONCE, here, is what lets a machine caller be recognised as a machine
 * everywhere — and lets the agent-host case give up the identity it was carrying all
 * along (see {@link ../../application/task/taskLifecycle.resolveTransitionActor}).
 */

export type MachineSubjectKind = 'agent_host' | 'embed';

export interface MachineSubject {
  kind: MachineSubjectKind;
  /** `agent_hosts.id` when the sub names a specific host; null for `agentHost:mcp`
   *  and for embed sessions, which name no agent. */
  agentHostId: number | null;
  /** Everything after the prefix, verbatim (`'5'`, `'mcp'`, a key id). */
  suffix: string;
}

const PREFIXES: ReadonlyArray<readonly [string, MachineSubjectKind]> = [
  ['agentHost:', 'agent_host'],
  ['embed:', 'embed'],
];

/**
 * Decode a JWT subject into its machine identity, or null when it is an ordinary
 * user id. Total and allocation-cheap — it runs on every authenticated request.
 */
export function parseMachineSubject(sub: string | null | undefined): MachineSubject | null {
  if (!sub) return null;
  for (const [prefix, kind] of PREFIXES) {
    if (!sub.startsWith(prefix)) continue;
    const suffix = sub.slice(prefix.length);
    const numeric = kind === 'agent_host' && /^\d+$/.test(suffix) ? Number(suffix) : null;
    return { kind, agentHostId: numeric, suffix };
  }
  return null;
}

/** True when the subject is a service token, i.e. it resolves to NO `users` row. */
export function isMachineSubject(sub: string | null | undefined): boolean {
  return parseMachineSubject(sub) !== null;
}

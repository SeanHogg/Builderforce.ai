/**
 * Local egress — run a vendor's HTTP call from the tenant's OWN connected runtime
 * instead of from the Worker.
 *
 * Why this exists: some providers refuse our infrastructure, not our credentials.
 * Kimi Code's edge answers the Cloudflare Workers egress with an HTML 403 *before* the
 * API ever reads the key — the byte-identical request from an ordinary machine gets a
 * clean JSON reply. No header changes that, and impersonating an approved first-party
 * client is not on the table, so the only honest remedy is to make the call from a
 * machine the provider does not refuse. Every tenant running an agent host already has
 * one, holding a live WebSocket to {@link AgentHostRelayDO} — and a request made there
 * is exactly the personal interactive client such a subscription is licensed for.
 *
 *   vendor module → VendorEgress → AGENT_HOST_RELAY DO → ws → agent-runtime → provider
 *
 * The seam is `fetch`-shaped ({@link VendorEgress}), so the vendor's timeout, abort
 * handling, status ladder and error classification are completely unaware of it.
 *
 * Scope is deliberately narrow, in three independent ways:
 *   • only vendors that declare `requiresLocalEgress` are ever handed the transport
 *     (see `registry.ts`) — a tenant's laptop must not become the route for all traffic;
 *   • only hosts belonging to THIS tenant are considered;
 *   • the runtime itself enforces a host allowlist on what it is willing to call, so a
 *     compromised gateway cannot turn a user's machine into an open proxy.
 */

import { and, desc, eq, isNotNull } from 'drizzle-orm';

import { buildDatabase } from '../../infrastructure/database/connection';
import { agentHosts } from '../../infrastructure/database/schema';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { VendorEgress } from './vendors/types';

/** Minimal shape of the relay binding this module needs — narrower than the DO class so
 *  the LLM layer doesn't take a dependency on the whole relay implementation. */
export interface HostRelayNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

type HostEgressEnv = Env & { AGENT_HOST_RELAY?: HostRelayNamespace };

/** The relayed reply, as {@link AgentHostRelayDO.relayEgress} returns it. */
interface RelayEgressReply {
  ok?: boolean;
  error?: string | null;
  response?: {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
  } | null;
}

/**
 * How long a tenant's "which host is online" answer is reused.
 *
 * Short on purpose. This IS cached — it is a DB round-trip on a per-LLM-call path, and
 * the read-through helper collapses a burst of cascade attempts into one query — but a
 * host that goes offline must stop being chosen quickly, and the fallback for a stale
 * hit is cheap and self-correcting: the DO answers 409 `agent_host_offline` and the
 * vendor falls straight through to direct egress.
 */
const ONLINE_HOST_TTL_SECONDS = 30;

const onlineHostKey = (tenantId: number) => `llm:egress-host:${tenantId}`;

/**
 * The id of an online agent host for this tenant, or null.
 *
 * `connectedAt` is stamped when the host's upstream WebSocket attaches and cleared when
 * it drops, so it — not `lastSeenAt`, which a dead process leaves behind — is what
 * "online" means here. Most-recently-connected wins when a tenant runs several.
 */
export async function onlineAgentHostId(env: Env, tenantId: number): Promise<number | null> {
  return getOrSetCached(
    env,
    onlineHostKey(tenantId),
    async () => {
      const db = buildDatabase(env);
      const [row] = await db
        .select({ id: agentHosts.id })
        .from(agentHosts)
        .where(and(
          eq(agentHosts.tenantId, tenantId),
          eq(agentHosts.status, 'active'),
          isNotNull(agentHosts.connectedAt),
        ))
        .orderBy(desc(agentHosts.connectedAt))
        .limit(1);
      return row?.id ?? null;
    },
    { kvTtlSeconds: ONLINE_HOST_TTL_SECONDS, l1TtlMs: ONLINE_HOST_TTL_SECONDS * 1000 },
  );
}

/** Drop the cached online-host answer — call when a host connects or disconnects so the
 *  next dispatch sees the change instead of waiting out the TTL. */
export async function invalidateOnlineAgentHost(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, onlineHostKey(tenantId));
}

/**
 * Build a {@link VendorEgress} that routes through a connected host, or `null` when the
 * tenant has none online (the caller then leaves `egress` unset and the vendor calls
 * `fetch` directly, exactly as before).
 *
 * Returning `null` rather than a transport that always fails is deliberate: "no local
 * egress available" is a routing fact the dispatcher should act on once, not an error
 * every candidate in a cascade rediscovers.
 */
export async function buildHostEgress(env: Env, tenantId: number): Promise<VendorEgress | null> {
  const relay = (env as HostEgressEnv).AGENT_HOST_RELAY;
  if (!relay) return null;
  const hostId = await onlineAgentHostId(env, tenantId);
  if (hostId == null) return null;

  return async (endpoint, init, signal) => {
    const stub = relay.get(relay.idFromName(String(hostId)));
    // Headers are normalized to a plain object: the frame is JSON on a WebSocket, and
    // a `Headers` instance would serialize to `{}`.
    const headers: Record<string, string> = {};
    const raw = init.headers;
    if (raw instanceof Headers) raw.forEach((value, key) => { headers[key] = value; });
    else if (Array.isArray(raw)) for (const [key, value] of raw) headers[key] = value;
    else if (raw) Object.assign(headers, raw);

    const relayResponse = await stub.fetch('https://relay.internal/host-egress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: init.method ?? 'POST',
        url: endpoint,
        headers,
        body: typeof init.body === 'string' ? init.body : null,
      }),
      ...(signal ? { signal } : {}),
    });

    const reply = await relayResponse.json().catch(() => ({})) as RelayEgressReply;
    if (!relayResponse.ok || !reply.response) {
      // Surface as a THROW, not as a synthetic 5xx response: the vendor's status ladder
      // would read a fabricated 502 as "the provider had a bad minute" and cool the
      // model down. The relay being unavailable says nothing about the provider.
      throw new Error(`local egress unavailable: ${reply.error ?? `relay HTTP ${relayResponse.status}`}`);
    }
    return new Response(reply.response.body ?? '', {
      status: reply.response.status ?? 502,
      headers: reply.response.headers ?? {},
    });
  };
}

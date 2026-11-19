/**
 * The tenant's BYO ORDER as a client reads it — where a connected account this host calls
 * itself (Kimi) sits in "use my connected accounts", and on which of its models.
 *
 * The BYO pool implies server access, so the SERVER owns the order:
 * `GET /llm/byo-order?[role=]&projectId=&arcStage=&agentic=` answers, for the call's context
 * (its turn role — plan · code · review · verify · explore · chat · utility, or none —
 * refined by project, arc stage and whether it carries tools), the models in exactly the
 * order the gateway tries a `byo_pool` call, and the tenant's funding order (`freeFirst`).
 * A call with NO role sends none: the gateway orders a role-less body by the tenant's
 * precedence, not as a coding turn, and the order read for it must be that one. The client
 * never keeps a second ladder; it only reads where its own account falls in that one:
 *
 *  - the order's first LIVE entry is the account's provider, and the tenant funds its
 *    connected accounts first (`freeFirst: false`) → it LEADS (before the gateway), on that
 *    entry's model;
 *  - the same, but the tenant funds the FREE tier first (`freeFirst: true`) → it TRAILS, on
 *    that entry's model: the gateway tries the free tier before ANY connected account, so
 *    leading with this one would put it ahead of the free tier the person chose first;
 *  - otherwise → it TRAILS: the gateway goes first and the account is the fallback, on its
 *    highest-ranked model. "Otherwise" includes another provider ranking ahead, an entry
 *    with no provider (`provider: null` — an OpenRouter connection, an account only the
 *    gateway can call) ranking ahead, and the server not listing the account at all;
 *  - the order cannot be read (403, offline, signed out) → it leads as it always did, on the
 *    credential's own position 0 (the tenant's model order the credential carries).
 *
 * A LIVE entry is one of this account's own (judged by the account's own resolved credential,
 * never by the server's `healthy`, which cannot observe an account only this host calls), or
 * another entry that is `healthy` AND `callableByGateway` (an entry the gateway would skip
 * cannot lead anything). An absent `callableByGateway` (an older server) reads as true.
 *
 * An entry's model must be one the account's credential lists (matched through the
 * catalog's `ladderModelId` and the runtime registry's catalog aliases, so `k3` and
 * `kimi-k3` are one model); else the account runs its best-listed model among its entries,
 * and with none of those its credential's first.
 */
import { localRuntime, type ByoOrderQuery, type LocalRuntimeId } from '@builderforce/local-inference';
import { ladderModelId } from '@builderforce/model-catalog';
import { errorDetail, field, stringField, type GatewayRequest } from './port.js';

/** One model of a role's order, as the gateway tries it. */
export interface ByoOrderEntry {
  /** e.g. `direct/kimi-code/k3`. */
  ref: string;
  /** The gateway vendor, e.g. `kimi-code`. */
  vendor: string;
  /** The account provider, e.g. `kimi`; null for a gateway-only connection (OpenRouter). */
  provider: string | null;
  /** The gateway's view of the vendor's health — never consulted for this account's OWN
   *  entries (the account is judged by its own resolved credential). */
  healthy: boolean;
  /** False when the gateway cannot dispatch this vendor at all (it needs local egress and
   *  the tenant has no online agent host). Absent (an older server) = true. */
  callableByGateway: boolean;
}

export type ByoOrderOutcome =
  /** `freeFirst`: the tenant funds the free pool first (true) or its connected accounts first (false). */
  | { kind: 'order'; entries: readonly ByoOrderEntry[]; freeFirst: boolean }
  /** No usable answer — the caller keeps the credential's own order and says why. */
  | { kind: 'unreadable'; detail: string };

/** How long one context's order is reused before it is asked again. */
export const BYO_ORDER_TTL_MS = 60_000;

/**
 * How long an UNREADABLE answer is reused: briefly, so a burst of calls does not hammer a
 * failing endpoint, but a transient failure (a cold start, a dropped connection) does not
 * pin every account to "lead" for a whole minute.
 */
export const BYO_ORDER_UNREADABLE_TTL_MS = 5_000;

/**
 * Read an order body; null when it is not one (a missing list, an entry without its ref).
 * An entry's absent or null `provider` is a gateway-only account, not a malformed entry. An
 * absent `freeFirst` (a server that predates it) reads as free first — the order as before.
 */
export function parseByoOrder(body: unknown): { entries: ByoOrderEntry[]; freeFirst: boolean } | null {
  const raw = field(body, 'models');
  if (!Array.isArray(raw)) return null;
  const entries: ByoOrderEntry[] = [];
  for (const entry of raw) {
    const ref = stringField(entry, 'ref');
    if (!ref) return null;
    const provider = stringField(entry, 'provider') || null;
    entries.push({
      ref,
      vendor: stringField(entry, 'vendor'),
      provider,
      healthy: field(entry, 'healthy') !== false,
      callableByGateway: field(entry, 'callableByGateway') !== false,
    });
  }
  return { entries, freeFirst: field(body, 'freeFirst') !== false };
}

/** The order's path for a call's context — also its cache key, so every field keys it. A
 *  call with no role sends none (its own order and cache slot, never `code`'s). */
export function byoOrderPath(query: ByoOrderQuery): string {
  const params = new URLSearchParams();
  if (query.role) params.set('role', query.role);
  if (query.projectId !== undefined && Number.isInteger(query.projectId)) params.set('projectId', String(query.projectId));
  if (query.arcStage) params.set('arcStage', query.arcStage);
  params.set('agentic', query.agentic ? '1' : '0');
  return `/llm/byo-order?${params.toString()}`;
}

/** One fetch of a context's order, decided. Never throws. */
export async function fetchByoOrder(request: GatewayRequest, query: ByoOrderQuery): Promise<ByoOrderOutcome> {
  let res: { status: number; body: unknown };
  try {
    res = await request(byoOrderPath(query), { method: 'GET' });
  } catch (error) {
    return { kind: 'unreadable', detail: error instanceof Error ? error.message : String(error) };
  }
  if (res.status !== 200) return { kind: 'unreadable', detail: errorDetail(res.body, res.status) };
  const order = parseByoOrder(res.body);
  return order ? { kind: 'order', ...order } : { kind: 'unreadable', detail: 'malformed BYO order' };
}

export interface ByoOrderCache {
  /** The context's order — asked at most once per TTL per context (role, project, arc stage,
   *  agentic); concurrent reads share one ask. */
  read(query: ByoOrderQuery): Promise<ByoOrderOutcome>;
  /** Forget every context's order (sign-out, a credential arrived or dropped). */
  clear(): void;
}

export function createByoOrderCache(deps: {
  request: GatewayRequest;
  now: () => number;
  ttlMs?: number;
  unreadableTtlMs?: number;
}): ByoOrderCache {
  const ttl = deps.ttlMs ?? BYO_ORDER_TTL_MS;
  const unreadableTtl = deps.unreadableTtlMs ?? BYO_ORDER_UNREADABLE_TTL_MS;
  const held = new Map<string, { at: number; ttl: number; order: Promise<ByoOrderOutcome> }>();
  /** Each reason the order was unreadable is logged once, not per call. */
  const logged = new Set<string>();
  return {
    read(query) {
      const key = byoOrderPath(query);
      const at = deps.now();
      const hit = held.get(key);
      if (hit && at - hit.at < hit.ttl) return hit.order;
      // The TTL is settled with the answer: an unreadable one is reused only briefly.
      const entry = { at, ttl } as { at: number; ttl: number; order: Promise<ByoOrderOutcome> };
      entry.order = fetchByoOrder(deps.request, query).then((outcome) => {
        if (outcome.kind === 'unreadable') {
          entry.ttl = unreadableTtl;
          if (!logged.has(outcome.detail)) {
            logged.add(outcome.detail);
            console.warn(`Connected accounts: the BYO order is unreadable (${outcome.detail}); a host-called account keeps its own model order and goes first.`);
          }
        }
        return outcome;
      });
      held.set(key, entry);
      return entry.order;
    },
    clear() {
      held.clear();
    },
  };
}

/** Where a connected account sits for one call, and the model it runs. */
export interface AccountPlacement {
  model: string;
  /** Absent when the order was unreadable (the account leads, as it always did). */
  placement?: 'lead' | 'trail';
}

/**
 * Place a connected account in a context's order. `listed` is the credential's models in
 * the credential's order; null when it lists none.
 */
export function placeAccount(
  order: ByoOrderOutcome,
  account: { provider: string; runtime: LocalRuntimeId; listed: readonly string[] },
): AccountPlacement | null {
  const fallback = account.listed[0];
  if (!fallback) return null;
  if (order.kind === 'unreadable') return { model: fallback };
  const mine = order.entries.filter((e) => e.provider === account.provider);
  // The FIRST live entry decides — whoever it is. A gateway-only account (`provider: null`)
  // heading the order means the gateway leads, so this account trails. This account's own
  // entries are live because its credential resolved (that is how it got here) — the server
  // cannot observe an account it never calls, so its `healthy` is not the judge of them.
  // Another provider's entry the gateway cannot call (`callableByGateway: false`) leads
  // nothing: the gateway would skip it.
  const first = order.entries.find((e) =>
    e.provider === account.provider || (e.healthy && e.callableByGateway));
  const heads = !!first && first.provider === account.provider;
  // Heading the order leads only when the tenant funds its accounts first: free first, the
  // gateway tries the free tier before any connected account, so this one trails it — still
  // on the model it heads the order with.
  const placement = heads && !order.freeFirst ? 'lead' : 'trail';
  const ranked = heads && first ? [first, ...mine] : mine;
  const aliases = localRuntime(account.runtime).catalogAliases ?? {};
  const same = (a: string, b: string): boolean =>
    a === b || ladderModelId(a) === b || (!!aliases[a] && aliases[a] === aliases[b]);
  for (const entry of ranked) {
    const bare = ladderModelId(entry.ref);
    const model = account.listed.find((m) => same(m, bare));
    if (model) return { model, placement };
  }
  return { model: fallback, placement };
}

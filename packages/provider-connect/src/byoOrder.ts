/**
 * The tenant's BYO ORDER as a client reads it — where a connected account this host calls
 * itself (Kimi) sits in "use my connected accounts", and on which of its models.
 *
 * The BYO pool implies server access, so the SERVER owns the order: `GET /llm/byo-order?role=`
 * answers, per turn role (plan · code · review · verify · explore · chat · utility), the
 * models in exactly the order the gateway tries a `byo_pool` call. The client never keeps a
 * second ladder; it only reads where its own account falls in that one:
 *
 *  - the role's first HEALTHY entry is the account's provider → it LEADS (before the
 *    gateway), on that entry's model;
 *  - otherwise (another provider ranks ahead, or the server does not list it) → it TRAILS:
 *    the gateway goes first and the account is the fallback, on its highest-ranked model;
 *  - the order cannot be read (403, offline, signed out) → it leads as it always did, on the
 *    credential's own position 0 (the tenant's model order the credential carries).
 *
 * An entry's model must be one the account's credential lists (matched through the runtime
 * registry's catalog aliases, so `k3` and `kimi-k3` are one model); else the account runs
 * its best-listed model among its entries, and with none of those its credential's first.
 */
import { clientPinOf, localRuntime, type LocalRuntimeId } from '@builderforce/local-inference';
import { errorDetail, field, stringField, type GatewayRequest } from './port.js';

/** One model of a role's order, as the gateway tries it. */
export interface ByoOrderEntry {
  /** e.g. `direct/kimi-code/k3`. */
  ref: string;
  /** The gateway vendor, e.g. `kimi-code`. */
  vendor: string;
  /** The account provider, e.g. `kimi`. */
  provider: string;
  healthy: boolean;
}

export type ByoOrderOutcome =
  | { kind: 'order'; entries: readonly ByoOrderEntry[] }
  /** No usable answer — the caller keeps the credential's own order and says why. */
  | { kind: 'unreadable'; detail: string };

/** A call with no role is a coding turn — the gateway's default for a `byo_pool` call too. */
export const DEFAULT_BYO_ROLE = 'code';

/** How long one role's order is reused before it is asked again. */
export const BYO_ORDER_TTL_MS = 60_000;

/** Read an order body; null when it is not one (a missing list, an entry without its ref). */
export function parseByoOrder(body: unknown): ByoOrderEntry[] | null {
  const raw = field(body, 'models');
  if (!Array.isArray(raw)) return null;
  const entries: ByoOrderEntry[] = [];
  for (const entry of raw) {
    const ref = stringField(entry, 'ref');
    const provider = stringField(entry, 'provider');
    if (!ref || !provider) return null;
    entries.push({ ref, vendor: stringField(entry, 'vendor'), provider, healthy: field(entry, 'healthy') !== false });
  }
  return entries;
}

/** One fetch of a role's order, decided. Never throws. */
export async function fetchByoOrder(request: GatewayRequest, role: string): Promise<ByoOrderOutcome> {
  let res: { status: number; body: unknown };
  try {
    res = await request(`/llm/byo-order?role=${encodeURIComponent(role)}`, { method: 'GET' });
  } catch (error) {
    return { kind: 'unreadable', detail: error instanceof Error ? error.message : String(error) };
  }
  if (res.status !== 200) return { kind: 'unreadable', detail: errorDetail(res.body, res.status) };
  const entries = parseByoOrder(res.body);
  return entries ? { kind: 'order', entries } : { kind: 'unreadable', detail: 'malformed BYO order' };
}

export interface ByoOrderCache {
  /** The role's order — asked at most once per TTL per role (concurrent reads share one ask). */
  read(role: string): Promise<ByoOrderOutcome>;
  /** Forget every role's order (sign-out, a credential arrived or dropped). */
  clear(): void;
}

export function createByoOrderCache(deps: { request: GatewayRequest; now: () => number; ttlMs?: number }): ByoOrderCache {
  const ttl = deps.ttlMs ?? BYO_ORDER_TTL_MS;
  const held = new Map<string, { at: number; order: Promise<ByoOrderOutcome> }>();
  /** Each reason the order was unreadable is logged once, not per call. */
  const logged = new Set<string>();
  return {
    read(role) {
      const at = deps.now();
      const hit = held.get(role);
      if (hit && at - hit.at < ttl) return hit.order;
      const order = fetchByoOrder(deps.request, role).then((outcome) => {
        if (outcome.kind === 'unreadable' && !logged.has(outcome.detail)) {
          logged.add(outcome.detail);
          console.warn(`Connected accounts: the BYO order is unreadable (${outcome.detail}); a host-called account keeps its own model order and goes first.`);
        }
        return outcome;
      });
      held.set(role, { at, order });
      return order;
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
 * Place a connected account in a role's order. `listed` is the credential's models in the
 * credential's order; null when it lists none.
 */
export function placeAccount(
  order: ByoOrderOutcome,
  account: { provider: string; runtime: LocalRuntimeId; listed: readonly string[] },
): AccountPlacement | null {
  const fallback = account.listed[0];
  if (!fallback) return null;
  if (order.kind === 'unreadable') return { model: fallback };
  const mine = order.entries.filter((e) => e.provider === account.provider);
  const first = order.entries.find((e) => e.healthy);
  const placement = first && first.provider === account.provider ? 'lead' : 'trail';
  const ranked = placement === 'lead' && first ? [first, ...mine] : mine;
  const aliases = localRuntime(account.runtime).catalogAliases ?? {};
  const same = (a: string, b: string): boolean => a === b || (!!aliases[a] && aliases[a] === aliases[b]);
  for (const entry of ranked) {
    const bare = clientPinOf(entry.ref)?.model ?? entry.ref.slice(entry.ref.lastIndexOf('/') + 1);
    const model = account.listed.find((m) => same(m, bare));
    if (model) return { model, placement };
  }
  return { model: fallback, placement };
}

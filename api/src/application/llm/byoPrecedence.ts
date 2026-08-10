/**
 * BYO PRECEDENCE — the ONE ordered list a tenant ranks every routable account by.
 *
 * Two tables hold rankable things and they must interleave, not sit in two lists:
 *   • `tenant_llm_provider_keys` — a connected provider account (Anthropic, Meta, xAI, …),
 *     each contributing its frontier flagship (0338 added its `priority`);
 *   • `tenant_openrouter_connections` — a named OpenRouter model set (0382).
 * An operator's real intent is "Cheap coders, THEN my Claude account, THEN Frontier", which is
 * unexpressible if each table owns its own ordering. So both `priority` columns share ONE
 * integer space and are stamped together, here.
 *
 * This module is deliberately the only writer of either column: the previous
 * `setTenantProviderPriority` cleared every provider not in its list, which — once a second
 * table joined the space — would have silently reset the connections' ranks on every provider
 * reorder. {@link setByoPrecedence} instead stamps an explicit rank (or `null`) for EVERY
 * rankable row the tenant owns, so the list it is given is the whole truth.
 *
 * Wire format is a flat `string[]` of refs so the HTTP surface stays a plain ordered list:
 * `"anthropic"` for a provider, `"openrouter:12"` for a connection. See {@link parsePrecedenceRef}.
 */

import type { HonoEnv } from '../../env';
import {
  isSupportedProvider,
  listTenantProviderKeys,
  setTenantProviderPriorityRanks,
  type LlmProvider,
} from './tenantProviderKeyService';
import {
  listOpenRouterConnections,
  setOpenRouterConnectionPriority,
  type OpenRouterConnection,
} from './openRouterConnectionService';

type Env = HonoEnv['Bindings'];

/** Prefix that distinguishes a connection ref from a bare provider id on the wire. */
const CONNECTION_PREFIX = 'openrouter:';

/** One rankable account: a connected provider, or a named OpenRouter connection. */
export type PrecedenceRef =
  | { kind: 'provider'; provider: LlmProvider }
  | { kind: 'connection'; connectionId: number };

/** Wire form of a ref — `"anthropic"` or `"openrouter:12"`. */
export function formatPrecedenceRef(ref: PrecedenceRef): string {
  return ref.kind === 'provider' ? ref.provider : `${CONNECTION_PREFIX}${ref.connectionId}`;
}

/**
 * Parse one wire ref, or `null` when it names neither a supported provider nor a well-formed
 * connection id. Callers reject the whole request on a `null` rather than dropping the entry —
 * a silently-skipped ref would persist an ordering the operator never chose.
 *
 * Note the asymmetry with the provider id `openai`: an OpenRouter CONNECTION ref always
 * carries the `openrouter:` prefix AND a numeric id, so it can never be confused with a
 * provider id (there is no `openrouter` provider).
 */
export function parsePrecedenceRef(raw: unknown): PrecedenceRef | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith(CONNECTION_PREFIX)) {
    const id = Number(value.slice(CONNECTION_PREFIX.length));
    return Number.isInteger(id) && id > 0 ? { kind: 'connection', connectionId: id } : null;
  }
  return isSupportedProvider(value) ? { kind: 'provider', provider: value } : null;
}

/** One entry of the precedence list as the settings UI renders it. */
export interface PrecedenceEntry {
  /** Wire ref — the id the UI sends back in a reorder. */
  ref: string;
  kind: 'provider' | 'connection';
  /** Provider id, when `kind === 'provider'`. */
  provider?: LlmProvider;
  /** The full connection record, when `kind === 'connection'` — the UI shows its model count
   *  and whether the tenant's own key backs it, both of which change the billing story. */
  connection?: OpenRouterConnection;
  /** Current stored rank; `null` = unset (catalog-tier fallback). */
  priority: number | null;
}

/**
 * The tenant's full precedence list, most-preferred first.
 *
 * Merges the two tables on the shared integer space. Unset (`null`) rows sort last — the same
 * meaning both tables already give NULL — with providers before connections at equal rank so
 * the order is total and a repeated read never reshuffles.
 */
export async function listByoPrecedence(env: Env, tenantId: number): Promise<PrecedenceEntry[]> {
  const [providers, connections] = await Promise.all([
    listTenantProviderKeys(env, tenantId).catch(() => []),
    listOpenRouterConnections(env, tenantId).catch(() => []),
  ]);
  const entries: PrecedenceEntry[] = [
    ...providers.map((p) => ({
      ref: formatPrecedenceRef({ kind: 'provider' as const, provider: p.provider }),
      kind: 'provider' as const,
      provider: p.provider,
      priority: p.priority,
    })),
    ...connections.map((c) => ({
      ref: formatPrecedenceRef({ kind: 'connection' as const, connectionId: c.id }),
      kind: 'connection' as const,
      connection: c,
      priority: c.priority,
    })),
  ];
  // `Infinity` is safe as the unset sentinel here (unlike inside byoAutoSeedModels' subtraction
  // comparator): this comparator branches on <, never subtracts, so two unset rows compare
  // equal and fall through to the kind/id tiebreak.
  const rank = (e: PrecedenceEntry): number => e.priority ?? Number.POSITIVE_INFINITY;
  return entries.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) < rank(b) ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'provider' ? -1 : 1;
    return a.ref.localeCompare(b.ref);
  });
}

/**
 * Persist the tenant's precedence from an ordered ref list (most-preferred first).
 *
 * Every rankable row the tenant owns is stamped: those named in `order` get their index, those
 * absent are explicitly reset to `null` (unset → catalog-tier fallback). That total assignment
 * is what makes the submitted list the single source of truth, and it is why this must write
 * both tables in one call — a partial write leaves the two halves ranking against different
 * integer spaces.
 *
 * Refs naming something the tenant doesn't own are ignored rather than rejected: a stale UI
 * that still lists a just-disconnected provider should reorder the rest, not fail.
 */
export async function setByoPrecedence(
  env: Env,
  tenantId: number,
  order: readonly PrecedenceRef[],
): Promise<void> {
  const [providers, connections] = await Promise.all([
    listTenantProviderKeys(env, tenantId).catch(() => []),
    listOpenRouterConnections(env, tenantId).catch(() => []),
  ]);
  const ownedProviders = new Set(providers.map((p) => p.provider));
  const ownedConnections = new Set(connections.map((c) => c.id));

  const providerRanks = new Map<LlmProvider, number | null>(providers.map((p) => [p.provider, null]));
  const connectionRanks = new Map<number, number | null>(connections.map((c) => [c.id, null]));

  let rank = 0;
  for (const ref of order) {
    if (ref.kind === 'provider') {
      if (!ownedProviders.has(ref.provider)) continue;
      // A duplicate ref must not consume a rank slot twice — keep the first occurrence.
      if (providerRanks.get(ref.provider) !== null) continue;
      providerRanks.set(ref.provider, rank++);
    } else {
      if (!ownedConnections.has(ref.connectionId)) continue;
      if (connectionRanks.get(ref.connectionId) !== null) continue;
      connectionRanks.set(ref.connectionId, rank++);
    }
  }

  await Promise.all([
    setTenantProviderPriorityRanks(env, tenantId, providerRanks),
    setOpenRouterConnectionPriority(env, tenantId, connectionRanks),
  ]);
}

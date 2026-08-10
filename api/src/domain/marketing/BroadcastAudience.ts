/**
 * Who a platform broadcast is for — the targeting rule, as a domain value.
 *
 * A superadmin writing a message to visitors is choosing an audience, and that
 * choice has to survive a round trip through `announcement_banners.audience`
 * (jsonb, therefore `unknown`) and then be applied to a visitor the server
 * looked up. Both halves live here so the rule that is WRITTEN and the rule that
 * is ENFORCED are the same function.
 *
 * The one non-negotiable: a visitor's standing is read from their
 * `marketing_sessions` row, never asserted by the client. "I am a paying
 * customer" is not something a browser gets to claim, and the moment targeting
 * trusts a request body, a broadcast aimed at one visitor is readable by all of
 * them.
 */

/**
 * How far down the funnel a visitor is. Ordered, and that ordering is the whole
 * model: every visitor is at exactly one of these, and each is a superset of the
 * ones after it.
 */
export const BROADCAST_SCOPES = ['all', 'guest', 'registered', 'paid'] as const;

export type BroadcastScope = (typeof BROADCAST_SCOPES)[number];

/** The stored targeting rule. Every field optional — `{}` means everyone. */
export interface BroadcastAudience {
  scope: BroadcastScope;
  /**
   * Exact targeting: the "message this visitor" action on a session in the
   * console. Capped, because this is an `IN (…)` list on a hot delivery query.
   */
  visitorIds: string[];
  /** Only visitors who have submitted at least this many prompts — engagement, not identity. */
  minPrompts: number;
}

/** How many visitors one broadcast may name explicitly. */
export const BROADCAST_MAX_VISITOR_IDS = 200;

export const EVERYONE: BroadcastAudience = { scope: 'all', visitorIds: [], minPrompts: 0 };

/**
 * What the server knows about a visitor at delivery time. Assembled from their
 * lead row and their prompt count — deliberately the smallest thing that can
 * answer every rule above, so a new rule has to widen this type and be seen.
 */
export interface VisitorStanding {
  visitorId: string;
  /** They created an account (`marketing_sessions.converted`). */
  registered: boolean;
  /** That account sits in a workspace on an active paid plan. */
  paid: boolean;
  promptCount: number;
}

/** Read a stored `audience` blob back into a rule. Anything unrecognised → everyone,
 *  because a broadcast that fails OPEN is a message shown too widely, while one that
 *  fails closed is silently shown to nobody and looks like a bug in the send. */
export function parseBroadcastAudience(value: unknown): BroadcastAudience {
  if (!value || typeof value !== 'object') return EVERYONE;
  const raw = value as Record<string, unknown>;

  const scope = BROADCAST_SCOPES.includes(raw.scope as BroadcastScope)
    ? (raw.scope as BroadcastScope)
    : 'all';

  const visitorIds = Array.isArray(raw.visitorIds)
    ? raw.visitorIds
        .filter((v): v is string => typeof v === 'string' && !!v.trim())
        .map((v) => v.trim())
        .slice(0, BROADCAST_MAX_VISITOR_IDS)
    : [];

  const minPrompts = typeof raw.minPrompts === 'number' && Number.isFinite(raw.minPrompts)
    ? Math.max(0, Math.floor(raw.minPrompts))
    : 0;

  return { scope, visitorIds, minPrompts };
}

/** Does this broadcast reach this visitor? The single predicate — the delivery
 *  query narrows in SQL for speed, and then this decides, so a SQL change can
 *  never quietly widen an audience past what the rule says. */
export function audienceMatches(audience: BroadcastAudience, visitor: VisitorStanding): boolean {
  if (audience.visitorIds.length && !audience.visitorIds.includes(visitor.visitorId)) return false;
  if (visitor.promptCount < audience.minPrompts) return false;

  switch (audience.scope) {
    case 'guest':      return !visitor.registered;
    case 'registered': return visitor.registered;
    case 'paid':       return visitor.paid;
    case 'all':
    default:           return true;
  }
}

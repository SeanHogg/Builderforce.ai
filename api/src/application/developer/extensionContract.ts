/**
 * The EXTENSION CONTRACT — what a published package may be, and what it may ask
 * for. Pure data and pure functions; no database, no HTTP.
 *
 * This module is the open/closed seam for PRD 24. Adding `canvas_kind` to the
 * platform means adding a row to `EXTENSION_KINDS` and a branch to the ONE spec
 * validator — not a table, not a service, not a route. That is the same argument
 * `discipline` makes on `field_jobs` and `builtin_kind` makes on `ide_agents`,
 * applied to the marketplace.
 *
 * ── SCOPES ARE THE SECURITY BOUNDARY ────────────────────────────────────────
 * An install grants exactly the scopes an admin approved, and `requireScope` (the
 * strict form) decides every call — an empty grant grants nothing here, unlike
 * the legacy tenant-key path where an empty list means "minted before scopes
 * existed". A new credential has no legacy to accommodate, so it gets the strict
 * rule from day one.
 */

import { requireScope, widenedScopes } from '../shared/scopeList';

// ─────────────────────────────────────────────────────────────────────────────
// Kinds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a package IS. A column value on `extension_packages`, never a table.
 *
 * Ordered by what ships when: the first four are Phase 1 and 2 (PRD 24 §7), and
 * `seat_pack` is declared here rather than added later because the validator
 * below must fail closed on a kind it does not know how to check — a kind that
 * exists in the enum but has no spec validator is refused, which is the safe
 * direction.
 */
export const EXTENSION_KINDS = [
  'connector',
  'mcp_server',
  'canvas_kind',
  'agent',
  'skill',
  'template',
  'seat_pack',
] as const;
export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

export function isExtensionKind(v: unknown): v is ExtensionKind {
  return typeof v === 'string' && (EXTENSION_KINDS as readonly string[]).includes(v);
}

/** Kinds a publisher may actually submit today. The rest are declared, not open. */
export const SUBMITTABLE_KINDS: readonly ExtensionKind[] = ['connector', 'mcp_server'];

// ─────────────────────────────────────────────────────────────────────────────
// Listing / review / verification vocabularies
// ─────────────────────────────────────────────────────────────────────────────

export const LISTING_STATES = ['draft', 'listed', 'delisted'] as const;
export type ListingState = (typeof LISTING_STATES)[number];

export const REVIEW_STATES = ['pending', 'approved', 'rejected'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/**
 * A publisher's trust tier, in ascending order.
 *
 * `identity_verified` is what gates charging money (PRD 24 §9). The ORDER matters
 * and is expressed by the array index, so a caller asks "at least this tier?"
 * rather than enumerating states — one comparison that cannot drift from the list.
 */
export const DEVELOPER_VERIFICATION_STATES = ['unverified', 'domain_verified', 'identity_verified'] as const;
export type DeveloperVerificationState = (typeof DEVELOPER_VERIFICATION_STATES)[number];

export function isVerificationState(v: unknown): v is DeveloperVerificationState {
  return typeof v === 'string' && (DEVELOPER_VERIFICATION_STATES as readonly string[]).includes(v);
}

/** True when `state` is at or above `minimum` in the trust order. */
export function meetsVerification(
  state: string,
  minimum: DeveloperVerificationState,
): boolean {
  const have = DEVELOPER_VERIFICATION_STATES.indexOf(state as DeveloperVerificationState);
  const need = DEVELOPER_VERIFICATION_STATES.indexOf(minimum);
  return have >= 0 && have >= need;
}

export const DEVELOPER_ROLES = ['owner', 'admin', 'publisher'] as const;
export type DeveloperRole = (typeof DEVELOPER_ROLES)[number];

/** Role order, so "may this member do X?" is one comparison rather than a switch. */
const ROLE_RANK: Record<DeveloperRole, number> = { publisher: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: string, minimum: DeveloperRole): boolean {
  const have = ROLE_RANK[role as DeveloperRole];
  return have !== undefined && have >= ROLE_RANK[minimum];
}

// ─────────────────────────────────────────────────────────────────────────────
// Scopes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What an extension may ask a tenant for.
 *
 * Deliberately COARSE and deliberately short. A scope list a human cannot read at
 * install time is a consent screen nobody reads, and the whole point of showing
 * the diff on a version bump is that the reader can tell what changed. Each entry
 * names a capability the runtime actually gates, not a table.
 */
export const EXTENSION_SCOPES = [
  'tools:call',        // its actions are advertised to agents and may be invoked
  'read:projects',     // read project + ticket metadata
  'write:tickets',     // create and update tickets
  'read:canvas',       // read boards and their objects
  'write:canvas',      // add or update canvas objects
  'read:insights',     // read aggregate metrics (never per-person rows)
  'notify:members',    // send a notification to workspace members
] as const;
export type ExtensionScope = (typeof EXTENSION_SCOPES)[number];

export function isExtensionScope(v: unknown): v is ExtensionScope {
  return typeof v === 'string' && (EXTENSION_SCOPES as readonly string[]).includes(v);
}

/**
 * Scopes that need a named human decision, not just an admin click.
 *
 * A write scope changes the customer's data; a read scope does not. The install
 * UI separates them for that reason, and the review pipeline treats a version
 * that adds one as never auto-updatable.
 */
export const SENSITIVE_SCOPES: readonly ExtensionScope[] = [
  'write:tickets',
  'write:canvas',
  'notify:members',
];

/** Does an install's grant permit `required`? Strict: an empty grant permits nothing. */
export function installGrants(granted: readonly string[] | null, required: ExtensionScope): boolean {
  return requireScope(granted, required);
}

/**
 * May a tenant's install move to `nextScopes` without re-prompting its admin?
 *
 * Only when nothing widened. Returning the widened list rather than a boolean is
 * what lets the caller SHOW the diff — a consent screen that says "this update
 * wants: write:canvas" is the one a person can actually answer.
 */
export function scopeUpgrade(
  granted: readonly string[] | null,
  nextScopes: readonly string[] | null,
): { auto: boolean; added: string[] } {
  const added = widenedScopes(granted, nextScopes);
  return { auto: added.length === 0, added };
}

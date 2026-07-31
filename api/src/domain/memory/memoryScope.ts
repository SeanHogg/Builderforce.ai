/**
 * Memory domain — the PURE rules that govern a remembered fact: how wide it is, where
 * it came from, and when it stops being true. No IO. `application/memory/memoryService`
 * is the only thing that turns these rules into queries.
 *
 * The rules exist because memory had none. A fact written by a run with no project went
 * tenant-wide and was recalled by every later run on every project; nothing recorded
 * who formed a belief; nothing ever lapsed. Three invariants, defined here once:
 *
 *   ISOLATION — recall walks the scope chain OUTWARD from the run's own position
 *   (ticket → project → tenant) and never sideways. Project B cannot see project A's
 *   beliefs because {@link visibleScopeChain} never emits a sibling, not because every
 *   caller remembers to add a predicate.
 *
 *   SPECIFICITY — when the same key exists at several scopes, the NARROWEST wins.
 *   A ticket-local override must beat the workspace default, or scoping is decoration.
 *
 *   EXPIRY — a fact with a lapsed `expiresAt` is already gone as far as recall is
 *   concerned, whether or not the sweep has deleted the row yet. The read is the
 *   authority; the sweep is only housekeeping.
 */

import type { MemoryScopeKind } from '@builderforce/agent-tools';

export const MEMORY_SCOPES: readonly MemoryScopeKind[] = ['tenant', 'project', 'ticket'];

export function isMemoryScope(v: unknown): v is MemoryScopeKind {
  return typeof v === 'string' && (MEMORY_SCOPES as readonly string[]).includes(v);
}

/** Provenance markers. Free-form at the column, enumerated here so the UI can label
 *  them and so a writer picks from a known set instead of inventing a synonym. */
export const MEMORY_ORIGINS = ['agent', 'cloud-run', 'on-prem', 'ide', 'brain', 'user', 'ingestion'] as const;
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

export function isMemoryOrigin(v: unknown): v is MemoryOrigin {
  return typeof v === 'string' && (MEMORY_ORIGINS as readonly string[]).includes(v);
}

/** Where a run sits in the scope tree. `projectId`/`ticketId` are absent when the run
 *  has no such context — an un-scoped run is simply tenant-only. */
export interface MemoryScopeContext {
  tenantId: number;
  projectId?: number | null;
  ticketId?: number | null;
}

/** One resolved position in the chain: a kind plus its concrete owner (0 = tenant). */
export interface ResolvedScope {
  kind: MemoryScopeKind;
  id: number;
}

/**
 * The scopes a run may READ, narrowest first. A run on ticket 9 of project 3 sees
 * [ticket:9, project:3, tenant:0]; a project run sees [project:3, tenant:0]; an
 * un-scoped run sees [tenant:0] only.
 *
 * Narrowest-first ordering is load-bearing — {@link dedupeBySpecificity} relies on it
 * to resolve a key collision in favour of the more specific fact.
 */
export function visibleScopeChain(ctx: MemoryScopeContext): ResolvedScope[] {
  const chain: ResolvedScope[] = [];
  if (ctx.ticketId != null && ctx.ticketId > 0) chain.push({ kind: 'ticket', id: ctx.ticketId });
  if (ctx.projectId != null && ctx.projectId > 0) chain.push({ kind: 'project', id: ctx.projectId });
  chain.push({ kind: 'tenant', id: 0 });
  return chain;
}

/**
 * Resolve the scope a WRITE lands in. `requested` is what the model asked for; the
 * concrete owner always comes from the run, never from the model — which is what makes
 * it impossible for an agent to aim a write at another project.
 *
 * A request the run cannot satisfy DEGRADES OUTWARD to the narrowest scope it does
 * have (asking for `ticket` on a run with no ticket writes at project scope) rather
 * than failing, because the alternative is an agent losing a fact over a technicality.
 */
export function resolveWriteScope(ctx: MemoryScopeContext, requested?: MemoryScopeKind): ResolvedScope {
  const chain = visibleScopeChain(ctx);
  if (requested) {
    const exact = chain.find((s) => s.kind === requested);
    if (exact) return exact;
    // Requested a scope this run doesn't occupy — degrade to the narrowest it has.
    const requestedRank = MEMORY_SCOPES.indexOf(requested);
    const narrower = chain.find((s) => MEMORY_SCOPES.indexOf(s.kind) <= requestedRank);
    if (narrower) return narrower;
  }
  // Default: the narrowest scope the run occupies. A ticket run's belief is a ticket
  // belief until it explicitly claims to be wider — contamination is opt-in, not free.
  // `visibleScopeChain` always ends with tenant, so the chain is never empty; the
  // fallback exists only to keep the return type total.
  return chain[0] ?? { kind: 'tenant', id: 0 };
}

/** True when a fact has lapsed as of `now`. A null expiry is durable. */
export function isExpired(expiresAt: Date | string | null | undefined, now: Date): boolean {
  if (expiresAt == null) return false;
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return Number.isFinite(at.getTime()) && at.getTime() <= now.getTime();
}

/** Turn a TTL in days into an absolute expiry, or null for a durable fact. Clamped to
 *  a sane band so a model cannot store `ttl_days: 1e9` (never expires, defeats the
 *  point) or `0.0001` (expires before the next run reads it). */
export function expiryFromTtlDays(ttlDays: number | null | undefined, now: Date): Date | null {
  if (ttlDays == null || !Number.isFinite(ttlDays) || ttlDays <= 0) return null;
  const clamped = Math.min(Math.max(ttlDays, MIN_TTL_DAYS), MAX_TTL_DAYS);
  return new Date(now.getTime() + clamped * 86_400_000);
}

export const MIN_TTL_DAYS = 1;
export const MAX_TTL_DAYS = 365;

/** The minimum a recalled row needs for the specificity rule to apply to it. `scope` is
 *  optional so this matches the wire `MemoryEntry` (whose scope is optional for
 *  backwards compatibility with surfaces that do not report one). */
export interface ScopedEntryLike {
  key: string;
  scope?: MemoryScopeKind;
}

/**
 * Collapse a recall result so each key appears once, keeping the NARROWEST scope.
 * Input must already be narrowest-scope-first (as {@link visibleScopeChain} produces),
 * so this is a stable first-wins pass — order within a scope is preserved, which keeps
 * the caller's importance ranking intact.
 */
export function dedupeBySpecificity<T extends ScopedEntryLike>(entries: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of entries) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    out.push(e);
  }
  return out;
}

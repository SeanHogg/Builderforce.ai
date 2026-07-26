/**
 * Coordination domain — the PURE rules of multi-agent mutual exclusion. No IO, no Db,
 * no Env: this module decides *what a resource is* and *whether a claim wins*, and
 * `application/coordination` is the only thing that talks to Postgres about it.
 *
 * Two ideas, and both have to be here rather than in the service, because both are
 * invariants rather than queries:
 *
 *   1. CANONICALISATION. A lease is only mutual exclusion if two agents naming the
 *      same thing produce the same key. A model will say `src/app.ts`, `./src/app.ts`,
 *      `/src/app.ts` and `src//app.ts` for one file. {@link resourceKeyFor} folds all
 *      of those into one string, so the partial unique index in migration 0370 is a
 *      real lock rather than a lock on the model's phrasing.
 *
 *   2. CONTAINMENT. Locks nest. Holding the whole repo must block a claim on a file
 *      inside it, and holding `src/api/` must block `src/api/routes.ts` — otherwise a
 *      "claim the repo" lease means nothing. {@link conflictKeysFor} enumerates the
 *      ancestor keys a claim must ALSO be clear of, which is what lets the service
 *      answer containment with one indexed `IN (...)` read instead of a prefix scan.
 */

import type { LeaseMode } from '@builderforce/agent-tools';

/** How long a lease lives before another run may steal it. Deliberately longer than a
 *  DO tick and shorter than a run: a live run renews on every write, a dead one lapses. */
export const LEASE_TTL_SECONDS = 15 * 60;

/** Sentinel path meaning "the whole repository" — the root of the containment tree. */
export const REPO_ROOT = '*';

/** The coordination scope a lease/note is visible in. One ticket = one blackboard. */
export function coordinationScopeKey(taskId: number): string {
  return `ticket:${taskId}`;
}

/**
 * Normalise a model-supplied path into a canonical repo-relative form.
 * `./src//app.ts` → `src/app.ts`; `/src/app.ts` → `src/app.ts`; `src/api/` → `src/api`.
 * `repo`, `.`, `/`, and '' all mean the whole tree → {@link REPO_ROOT}.
 * Traversal segments are dropped rather than resolved: a lease key is an identity, not
 * a filesystem read, so `../x` must not be able to name a resource outside the repo.
 */
export function normalizeResourcePath(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return REPO_ROOT;
  const lower = trimmed.toLowerCase();
  if (lower === 'repo' || lower === REPO_ROOT || trimmed === '.' || trimmed === '/') return REPO_ROOT;
  const segments = trimmed
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');
  return segments.length === 0 ? REPO_ROOT : segments.join('/');
}

/**
 * The canonical lease key: repo, BRANCH, path.
 *
 * The branch is not decoration — it is what makes the lock the right SIZE. Every
 * ticket works its own branch, so two agents on two different tickets editing the same
 * file are not in conflict at all: they commit to different refs and reconcile through
 * their pull requests. A key of (repo, path) would serialize them, producing refusals
 * for work that never collided and getting worse the busier the repo is. Contention is
 * real only WITHIN a branch — which is exactly the case a swimlane stage creates when
 * it staffs several agents onto one ticket.
 *
 * Including the repo slug additionally gives per-repo locks for free when multi-repo
 * spanning lands. `repoSlug` is lowercased (git hosts treat owner/name
 * case-insensitively, so two spellings must not be two locks); the branch is NOT, since
 * git refs are case-sensitive. `:` is a safe separator because a git ref cannot contain
 * one.
 */
export function resourceKeyFor(repoSlug: string, branch: string, path: string): string {
  const slug = (repoSlug || 'unbound').trim().toLowerCase();
  const ref = (branch || 'unbound').trim();
  return `repo:${slug}:${ref}:${normalizeResourcePath(path)}`;
}

/** The human-facing path inside a lease key — everything after `repo:<slug>:<branch>:`.
 *  The ONE place the key is taken apart, so a key-format change cannot leave a display
 *  showing `main:src/app.ts` (or, worse, silently truncating a path). */
export function resourcePathFromKey(key: string): string {
  return key.split(':').slice(3).join(':');
}

/**
 * Every key that must ALSO be free for a claim on `path` to be safe: the key itself
 * plus each ancestor directory up to the repo root. Ordered most-specific-first so a
 * refusal message names the closest blocking lease.
 *
 * `src/api/routes.ts` → [`…:src/api/routes.ts`, `…:src/api`, `…:src`, `…:*`]
 *
 * All within ONE branch — see {@link resourceKeyFor} for why the branch is part of the
 * identity rather than a filter applied afterwards.
 */
export function conflictKeysFor(repoSlug: string, branch: string, path: string): string[] {
  const normalized = normalizeResourcePath(path);
  if (normalized === REPO_ROOT) return [resourceKeyFor(repoSlug, branch, REPO_ROOT)];
  const segments = normalized.split('/');
  const keys: string[] = [];
  for (let i = segments.length; i > 0; i--) keys.push(resourceKeyFor(repoSlug, branch, segments.slice(0, i).join('/')));
  keys.push(resourceKeyFor(repoSlug, branch, REPO_ROOT));
  return keys;
}

/** A lease as the conflict rules see it — the minimum the pure layer needs. */
export interface LeaseLike {
  resourceKey: string;
  mode: LeaseMode;
  executionId: number | null;
  expiresAt: Date;
  releasedAt: Date | null;
}

/** A lease still binds only while unreleased AND unexpired. */
export function isLeaseLive(lease: LeaseLike, now: Date): boolean {
  return lease.releasedAt === null && lease.expiresAt.getTime() > now.getTime();
}

/**
 * The lease that BLOCKS `claimant` from taking `mode` over the conflict set, or null
 * when the claim is clear. The rules, in the order they apply:
 *
 *   • a run never blocks itself (re-claiming what you hold is a renewal, not a clash);
 *   • an expired or released lease blocks nothing;
 *   • `shared` + `shared` coexist (two agents reading the same subtree is fine);
 *   • every other pairing conflicts.
 */
export function findBlockingLease(
  existing: readonly LeaseLike[],
  claimantExecutionId: number | null,
  mode: LeaseMode,
  now: Date,
): LeaseLike | null {
  for (const lease of existing) {
    if (!isLeaseLive(lease, now)) continue;
    if (claimantExecutionId !== null && lease.executionId === claimantExecutionId) continue;
    if (mode === 'shared' && lease.mode === 'shared') continue;
    return lease;
  }
  return null;
}

'use client';

import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { getStoredTenant } from '@/lib/auth';
import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';
import {
  creationGraphFromSnapshot,
  listLocalCreationSessions,
  readLocalCreationSession,
  removeLocalCreationSession,
  type LocalCreationEntry,
} from '@/lib/creationSessions';

/**
 * "What was I working on?" — the ONE answer, for every surface that asks.
 *
 * Two things live here because they are the same question at two moments:
 *
 *   1. **Claiming.** An account-less canvas is real work held in this browser.
 *      Signing in is the moment it can become durable, and that hand-off used to
 *      live in exactly one `useEffect` on `/create/[sessionId]` — so it only ran
 *      if the browser happened to land back on that one route. Every hop that
 *      dropped `?next=` (an OAuth round trip, the workspace picker, verifying
 *      email in a second tab) sent the user to `/dashboard` instead and the work
 *      was unreachable. Claiming is now driven by the local-draft INDEX, not by
 *      the URL, so losing the URL stops being data loss.
 *
 *   2. **Resuming.** The most recent canvas, so the switcher and the shell can
 *      offer a way back without the person remembering a name or an id.
 *
 * Both the route and the shell-level bridge call in here, and per-session
 * in-flight coalescing means whichever arrives second joins the first request
 * rather than double-claiming the same board.
 */

/**
 * Both the last-canvas pointer and the recent-canvas cache are keyed by TENANT.
 *
 * Switching workspace is an identity change, not a filter: a canvas belongs to
 * exactly one tenant, so an unscoped pointer would offer the previous
 * workspace's board — a dead link at best, and one workspace's canvas title
 * shown inside another at worst. Account-less drafts are deliberately NOT scoped;
 * they predate any tenant and are claimed into whichever one signs in.
 */
const LAST_CANVAS_PREFIX = 'builderforce:create:last:';

/** The tenant these per-workspace reads and writes belong to. */
function scopeKey(): string {
  return getStoredTenant()?.id ?? 'none';
}
/** Server sessions change on the user's own edits, so this is a short read-through
 *  window that collapses the switcher + library + bridge mounting together into
 *  one request — not a durable cache. */
const RECENT_TTL_MS = 30_000;

export interface ClaimedDraft {
  /** The local id the board had before it was claimed. */
  localSessionId: string;
  /** The durable, tenant-scoped id it now has. */
  sessionId: string;
  title: string;
}

/** One claim per local session id, however many callers ask for it. */
const claiming = new Map<string, Promise<ClaimedDraft | null>>();

/**
 * Turn one account-less board into a durable, tenant-scoped session.
 *
 * Resolves `null` when there is nothing to claim (already claimed, or the board
 * is gone). Rejects only on a real API failure, so a caller can surface it.
 */
export function claimLocalDraft(localSessionId: string): Promise<ClaimedDraft | null> {
  const existing = claiming.get(localSessionId);
  if (existing) return existing;

  const attempt = (async (): Promise<ClaimedDraft | null> => {
    const snapshot = readLocalCreationSession(localSessionId);
    if (!snapshot) return null;
    const created = await creationSessionsApi.claim({
      clientSessionId: localSessionId,
      title: snapshot.title,
      initialPrompt: snapshot.initialPrompt,
      timeline: snapshot.timeline,
      ...creationGraphFromSnapshot(snapshot),
    });
    removeLocalCreationSession(localSessionId);
    invalidateRecentCanvases();
    const claimed: ClaimedDraft = {
      localSessionId,
      sessionId: created.session.id,
      title: created.session.title ?? snapshot.title,
    };
    rememberLastCanvas(claimed.sessionId, claimed.title);
    return claimed;
  })();

  claiming.set(localSessionId, attempt);
  // A failure must not pin the id as "in flight" forever — the next mount retries.
  void attempt.catch(() => undefined).finally(() => { claiming.delete(localSessionId); });
  return attempt;
}

/**
 * Claim every account-less board this browser holds, newest first.
 *
 * Sequential on purpose: claims are the user's own work arriving at a
 * freshly-provisioned workspace, and a burst of parallel writes against a
 * session quota is how the last one gets rejected. Individual failures are
 * counted, never thrown — one bad board must not strand the others.
 */
export async function claimPendingDrafts(): Promise<{ claimed: ClaimedDraft[]; failed: number }> {
  const pending = listLocalCreationSessions();
  const claimed: ClaimedDraft[] = [];
  let failed = 0;
  for (const entry of pending) {
    try {
      const result = await claimLocalDraft(entry.sessionId);
      if (result) claimed.push(result);
    } catch {
      failed += 1;
    }
  }
  return { claimed, failed };
}

/** Account-less boards still waiting to be claimed. */
export function listPendingDrafts(): LocalCreationEntry[] {
  return listLocalCreationSessions();
}

// ---------------------------------------------------------------------------
// Resuming
// ---------------------------------------------------------------------------

export interface LastCanvas {
  sessionId: string;
  title: string;
}

export function rememberLastCanvas(sessionId: string, title: string): void {
  try {
    localStorage.setItem(`${LAST_CANVAS_PREFIX}${scopeKey()}`, JSON.stringify({ sessionId, title } satisfies LastCanvas));
  } catch {
    // Private mode / quota — the switcher still lists server sessions.
  }
}

export function readLastCanvas(): LastCanvas | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${LAST_CANVAS_PREFIX}${scopeKey()}`) ?? 'null') as Partial<LastCanvas> | null;
    if (!parsed || typeof parsed.sessionId !== 'string' || typeof parsed.title !== 'string') return null;
    return { sessionId: parsed.sessionId, title: parsed.title };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Recent server canvases (shared read-through, so the switcher, the library and
// the resume bridge mounting together cost ONE request)
// ---------------------------------------------------------------------------

const RECENT_CACHE_PREFIX = 'canvas:recent:';

export function invalidateRecentCanvases(): void {
  invalidateClientCache(RECENT_CACHE_PREFIX);
}

export function fetchRecentCanvases(): Promise<CreationSessionSummary[]> {
  const tenant = scopeKey();
  return getOrSetClientCached(`${RECENT_CACHE_PREFIX}${tenant}`, () => creationSessionsApi.list('active')
    .then((result) => {
      const sessions = [...result.sessions].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
      return sessions;
    })
    // A failed read must not pin an empty list for the whole window.
    .catch(() => [] as CreationSessionSummary[]), { ttlMs: RECENT_TTL_MS });
}

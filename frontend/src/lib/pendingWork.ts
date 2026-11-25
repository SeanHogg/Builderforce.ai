import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { UNBOUND_DESTINATION, type EntityDestination } from '@builderforce/local-first';
import { getStoredTenant, getStoredTenantToken } from '@/lib/auth';
import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';
import { clearGuestSession } from '@/domains/guest/infrastructure/guestSessionStore';
import type { ChatMode } from '@/lib/brain';
import type { LocalCreationSnapshot } from '@/domains/canvas/domain/boardSnapshot';
import type { LocalCreationEntry, writeLocalCreationSession as WriteContent } from '@/domains/canvas/infrastructure/localFirst/studioBoards';

export type { LocalCreationEntry };
import { readLocalJson, writeLocalJson } from './storage';

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
  /** The id the board had before it was bound (the same id: a board is never re-keyed). */
  localSessionId: string;
  /** The board's id on the server, once accepted. */
  sessionId: string;
  title: string;
}

/**
 * The workspace's destination when someone is IN one; unbound otherwise (a guest, or no workspace yet).
 *
 * "In a workspace" is the one answer the rest of the app gives: `hasTenant` is "there is a tenant
 * token" (`AuthContext`), so this reads the same fact — a stale tenant row left behind by a sign-out
 * must not bind a guest's board to the last account.
 */
export function studioDestination(): EntityDestination {
  const tenant = getStoredTenant();
  return tenant && getStoredTenantToken() ? { kind: 'bound', tenantId: String(tenant.id) } : UNBOUND_DESTINATION;
}

/** One bind per board id, however many callers ask for it. */
const binding = new Map<string, Promise<ClaimedDraft | null>>();

/**
 * Bind one account-less board to the workspace the person is in (design §7).
 *
 * Not an HTTP claim: `bindBoardToAccount` re-snapshots the board and every child from unbound to the
 * workspace's destination and enqueues the whole board as journal events — board first, children
 * depending on it — in ONE transaction, and the sync driver sends them. The pointer to "what I was
 * working on" is set when the server ACCEPTS the board (`useBoardSyncOutcome`), not here.
 *
 * Resolves `null` when there is nothing to bind: no workspace yet, no such board, or it is already
 * bound (a second bind is a no-op, so a retry after a crash cannot enqueue it twice). A plan refusal
 * is not a rejection here — it comes back as a receipt and the board keeps its place on the device.
 */
export function bindLocalBoard(boardId: string): Promise<ClaimedDraft | null> {
  const existing = binding.get(boardId);
  if (existing) return existing;

  const attempt = (async (): Promise<ClaimedDraft | null> => {
    const destination = studioDestination();
    if (destination.kind !== 'bound') return null;
    await awaitBoardCreated(boardId);
    // The board library loads here, on use: the shell reaches this module on every route.
    const [{ getStudioRuntime }, { readBoard }, { bindBoardToAccount, BoardCommitError }] = await Promise.all([
      import('@/lib/localFirst/studioRuntime'),
      import('@/domains/canvas/infrastructure/localFirst/boardReplica'),
      import('@/domains/canvas/infrastructure/localFirst/boardBind').then(async (bind) => ({ ...bind, ...(await import('@/domains/canvas/infrastructure/localFirst/boardCommit')) })),
    ]);
    const runtime = await getStudioRuntime();
    if (!runtime) return null;
    const replica = await readBoard(runtime.store, boardId);
    if (!replica) return null;
    let outcome;
    try {
      outcome = await bindBoardToAccount(runtime.ctx, boardId, destination);
    } catch (error) {
      // A board that belongs to ANOTHER account is not this person's to bind: quiet, never a failure notice.
      if (error instanceof BoardCommitError && error.code === 'cross_destination') return null;
      throw error;
    }
    if (outcome.status !== 'bound') return null;
    invalidateRecentCanvases();
    runtime.driver.trigger();
    return { localSessionId: boardId, sessionId: boardId, title: replica.header.payload.title };
  })();

  binding.set(boardId, attempt);
  // A failure must not pin the id as "in flight" forever — the next mount retries.
  void attempt.catch(() => undefined).finally(() => { binding.delete(boardId); });
  return attempt;
}

/**
 * Resolves true once the server has ACCEPTED the board (the store holds its mapping), false when the
 * workspace, the store or the wait (default 20 s) runs out. A board is only shareable, invitable and
 * linkable on the server after this: the caller shows a pending state meanwhile.
 */
export async function whenBoardAccepted(boardId: string, timeoutMs = 20_000): Promise<boolean> {
  const destination = studioDestination();
  if (destination.kind !== 'bound') return false;
  const [{ getStudioRuntime }, { isBoardAccepted }] = await Promise.all([
    import('@/lib/localFirst/studioRuntime'),
    import('@/domains/canvas/infrastructure/localFirst/boardSyncOutcome'),
  ]);
  const runtime = await getStudioRuntime();
  if (!runtime) return false;
  if (await isBoardAccepted(runtime.store, boardId, destination)) return true;
  runtime.driver.trigger();
  return new Promise<boolean>((resolve) => {
    let unsubscribe: (() => void) | undefined;
    const settle = (accepted: boolean): void => { clearTimeout(timer); unsubscribe?.(); resolve(accepted); };
    const timer = setTimeout(() => settle(false), timeoutMs);
    unsubscribe = runtime.driver.subscribe(() => {
      void isBoardAccepted(runtime.store, boardId, destination).then((accepted) => { if (accepted) settle(true); })
        .catch((error: unknown) => void reportStudioFailure('pendingWork.accepted', error));
    });
  });
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
  const pending = await listLocalCreationSessions();
  const claimed: ClaimedDraft[] = [];
  let failed = 0;
  for (const entry of pending) {
    try {
      const result = await bindLocalBoard(entry.sessionId);
      if (result) claimed.push(result);
    } catch (error) {
      // Counted for the caller AND reported: one bad board must not strand the others, nor vanish.
      void reportStudioFailure('pendingWork.bind', error);
      failed += 1;
    }
  }
  // The SAMPLE workspace is deliberately not claimed, and this line is where
  // that decision is enforced rather than assumed.
  //
  // A guest can edit the sample data — that is the point of it; a number you
  // can drag is the demo. But those rows describe an invented business, and a
  // visitor who signs up and finds Nova Commerce's tickets sitting in their
  // brand-new workspace has been misled by the product at the exact moment they
  // decided to trust it. Boards are different: a board a person BUILT is their
  // own work and is claimed above. So: author's work follows them in, the
  // fixture does not, and the guest session is dropped so no shadow copy of it
  // survives the signup.
  clearGuestSession();
  return { claimed, failed };
}

/** Account-less boards still waiting to be bound. */
export function listPendingDrafts(): Promise<LocalCreationEntry[]> {
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
  // Private mode / quota / the server — the switcher still lists server sessions.
  writeLocalJson(`${LAST_CANVAS_PREFIX}${scopeKey()}`, { sessionId, title } satisfies LastCanvas);
}

export function readLastCanvas(): LastCanvas | null {
  const parsed = readLocalJson<Partial<LastCanvas>>(`${LAST_CANVAS_PREFIX}${scopeKey()}`);
  if (!parsed || typeof parsed.sessionId !== 'string' || typeof parsed.title !== 'string') return null;
  return { sessionId: parsed.sessionId, title: parsed.title };
}

// ---------------------------------------------------------------------------
// Recent server canvases (shared read-through, so the switcher, the library and
// the resume bridge mounting together cost ONE request)
// ---------------------------------------------------------------------------

const RECENT_CACHE_PREFIX = 'canvas:recent:';

export function invalidateRecentCanvases(): void {
  invalidateClientCache(RECENT_CACHE_PREFIX);
}

/** `projectId` scopes the read (tied sessions + unfiled, per GET /creation-sessions);
 *  omit or pass `null` for the tenant-wide, unfiltered list. */
export function fetchRecentCanvases(projectId?: number | null): Promise<CreationSessionSummary[]> {
  const tenant = scopeKey();
  return getOrSetClientCached(`${RECENT_CACHE_PREFIX}${tenant}:${projectId ?? 'all'}`, () => creationSessionsApi.list('active', projectId)
    .then((result) => {
      const sessions = [...result.sessions].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
      return sessions;
    })
    // A failed read must not pin an empty list for the whole window.
    .catch(() => [] as CreationSessionSummary[]), { ttlMs: RECENT_TTL_MS });
}

// ---------------------------------------------------------------------------
// The device's boards, loaded on use
// ---------------------------------------------------------------------------
//
// The replica (`studioBoards` and the board library behind it) is large, and the app layout reaches
// this module on every route: a static import would put the library in the first paint of EVERY route
// (`check:root-closure`). So each verb below loads it the first time it is called, and hands it its
// ports (`bindStudioBoardPorts`) — the composition lives here, not inside the domain.
//
// `createLocalCreationSession` keeps its old shape — an id AT ONCE, the write tracked — so the creation
// is registered here, statically, and every verb (and the canvas's open) waits on `awaitBoardCreated`.

async function loadBoards() {
  const [boards, runtime, checkpoints] = await Promise.all([
    import('@/domains/canvas/infrastructure/localFirst/studioBoards'),
    import('@/lib/localFirst/studioRuntime'),
    import('@/lib/creationCheckpoints'),
  ]);
  boards.bindStudioBoardPorts({
    runtime: runtime.getStudioRuntime,
    destination: studioDestination,
    afterRemove: checkpoints.clearLocalCheckpoints,
  });
  return boards;
}

/** Writes in flight. Nothing is keyed by board: a verb that must see a new board waits for all of them. */
const inFlight = new Set<Promise<void>>();

/** Settles when every board being created has been written (immediately when none is). */
export async function awaitBoardCreated(_boardId?: string): Promise<void> {
  await Promise.all([...inFlight]);
}

/** Report a failure through the local-first sink, loaded on use. */
export async function reportStudioFailure(where: string, error: unknown): Promise<void> {
  const { reportLocalFirstFailure } = await import('@/lib/localFirst/reportLocalFirstFailure');
  reportLocalFirstFailure(where, error);
}

/** Creations run one after another: two writers opening the one store at once would contend for it. */
let creations: Promise<void> = Promise.resolve();

function track(write: () => Promise<void>): void {
  // A board that could not be written is reported here AND on its first commit (the canvas creates the
  // board then, and tells the person when that fails too) — a failed create is never only a log line.
  const settled: Promise<void> = creations
    .then(write)
    .catch((error: unknown) => reportStudioFailure('studioBoards.create', error))
    .finally(() => { inFlight.delete(settled); });
  creations = settled;
  inFlight.add(settled);
}

/** A new board from a prompt; the id at once, the write tracked. */
export function createLocalCreationSession(prompt: string, mode?: ChatMode): string {
  const boardId = crypto.randomUUID();
  // The destination is the person's AT CREATION: a sign-in between this call and the write must not rebind it.
  const destination = studioDestination();
  track(async () => (await loadBoards()).writeSessionBoard(boardId, prompt, mode, destination));
  return boardId;
}

/** A board seeded with notes — the Brain's `show_canvas` landing. */
export function createLocalCreationBoard(input: { title?: string; text?: string; stickies: readonly string[] }): string {
  const boardId = crypto.randomUUID();
  const destination = studioDestination();
  track(async () => (await loadBoards()).writeNotesBoard(boardId, input, destination));
  return boardId;
}

/** Load the verbs once every pending creation has landed. */
async function ready() {
  await awaitBoardCreated();
  return loadBoards();
}

export const listLocalCreationSessions = async (): Promise<LocalCreationEntry[]> => (await ready()).listLocalCreationSessions();
export const listWorkspaceBoards = async (): Promise<LocalCreationEntry[]> => (await ready()).listWorkspaceBoards();
export const readLocalCreationSession = async (boardId: string): Promise<LocalCreationSnapshot | null> => (await ready()).readLocalCreationSession(boardId);
export const writeLocalCreationSession = async (boardId: string, snapshot: Parameters<typeof WriteContent>[1]): Promise<void> => (await ready()).writeLocalCreationSession(boardId, snapshot);
export const updateLocalCreationSession = async (boardId: string, patch: { title?: string; folder?: string | null; mode?: ChatMode; role?: 'viewer' | 'commenter' | 'editor' | 'runner' | 'owner' }): Promise<void> => (await ready()).updateLocalCreationSession(boardId, patch);
export const removeLocalCreationSession = async (boardId: string): Promise<void> => (await ready()).removeLocalCreationSession(boardId);
export const mergeLocalCreationSessions = async (target: string, sources: string[]): Promise<LocalCreationSnapshot | null> => (await ready()).mergeLocalCreationSessions(target, sources);

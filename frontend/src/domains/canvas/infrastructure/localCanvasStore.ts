/**
 * THE LOCAL CANVAS STORE — a board on THIS DEVICE, for somebody with no account.
 *
 * ── WHY IT IS INFRASTRUCTURE, AND WHY IT MOVED ───────────────────────────────
 * This is `localStorage` with a schema on top: read, write, index, list, remove,
 * merge. PRD 22 §3.4 lists it (as `canvasPersistence`) among the canvas slices
 * still sitting outside the context that owns them, and it was in `lib/` under a
 * name — `creationSessions.ts` — that read like the API client for server
 * sessions, which is a different thing in a different bounded context. Two
 * modules whose names differ by nothing and whose storage differs by everything
 * is how a call site ends up writing a guest board where an account board goes.
 *
 * Its NAME now says which of the two it is, and its FOLDER says the canvas
 * context owns it. Nothing about the stored shape changed, so no board written
 * by an earlier build has to be migrated.
 *
 * The board↔persistence TRANSLATION does not live here: that is the domain's
 * anti-corruption boundary, `persistedGraphFromBoard` / `boardFromPersistedGraph`
 * in `../domain/canvasBoard.ts`. This file moves bytes.
 */

import { NEW_CHAT_MODE, type ChatMode } from '@/lib/brain';
import {
  LOCAL_CREATION_PREFIX,
  isLocalCreationSession,
  localCreationSnapshotFrom,
  mergedLocalCreationSnapshot,
  newLocalCreationBoardSnapshot,
  newLocalCreationSessionSnapshot,
  parseLocalCreationSnapshot,
  type LocalCreationSnapshot,
} from '../domain/boardSnapshot';

// The pure shaping lives in `../domain/boardSnapshot` (one implementation); re-exported so
// every existing importer of this module keeps working until the store is retired.
export { LOCAL_CREATION_PREFIX, isLocalCreationSession, parseLocalCreationSnapshot };
export type { LocalCreationSnapshot };

const LOCAL_TOOL_CREATION_PREFIX = `${LOCAL_CREATION_PREFIX}tool-`;
const STORAGE_PREFIX = 'builderforce:create:';
/**
 * Index of every account-less canvas this browser holds.
 *
 * Without it a draft was reachable ONLY by already knowing its uuid: the board
 * was written to `builderforce:create:local-<uuid>` and registered nowhere, so
 * any hop that dropped `?next=` (an OAuth round trip, the workspace picker,
 * verifying email in a second tab) left real work in localStorage with no path
 * back to it. The index is what makes "what was I working on" answerable.
 */
const INDEX_KEY = `${STORAGE_PREFIX}index`;

export function creationStorageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

/** One row of the local-draft index: enough to list and open a draft without
 *  parsing every stored board. */
export interface LocalCreationEntry {
  sessionId: string;
  title: string;
  folder?: string;
  updatedAt: string;
}

function readIndex(): LocalCreationEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is LocalCreationEntry =>
      !!entry && typeof entry === 'object'
      && typeof (entry as LocalCreationEntry).sessionId === 'string'
      && typeof (entry as LocalCreationEntry).title === 'string'
      && ((entry as LocalCreationEntry).folder === undefined || typeof (entry as LocalCreationEntry).folder === 'string')
      && typeof (entry as LocalCreationEntry).updatedAt === 'string');
  } catch {
    return [];
  }
}

function writeIndex(entries: LocalCreationEntry[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    // Private mode / quota. The board itself is the durable copy; the index is a
    // convenience that {@link listLocalCreationSessions} can rebuild by scanning.
  }
}

/** Upsert one draft into the index, newest first. */
function indexLocalCreationSession(sessionId: string, title: string, updatedAt: string, folder?: string): void {
  const rest = readIndex().filter((entry) => entry.sessionId !== sessionId);
  writeIndex([{ sessionId, title, ...(folder ? { folder } : {}), updatedAt }, ...rest]);
}

/**
 * Every account-less canvas this browser holds, newest first.
 *
 * Self-healing on BOTH sides, because it has to work for drafts that already
 * exist in a real user's browser from before the index did:
 *   - any `builderforce:create:local-*` board with no index row is adopted;
 *   - any index row whose board is gone is dropped;
 *   - any `local-tool-*` board LEFT BEHIND by the build in which `/tools/<id>`
 *     mounted a whole canvas per diagnostic is deleted (see below).
 */
export function listLocalCreationSessions(): LocalCreationEntry[] {
  if (typeof localStorage === 'undefined') return [];
  const indexed = new Map(readIndex().map((entry) => [entry.sessionId, entry]));
  const legacyToolBoards: string[] = [];

  try {
    for (let position = 0; position < localStorage.length; position += 1) {
      const key = localStorage.key(position);
      if (!key?.startsWith(`${STORAGE_PREFIX}${LOCAL_CREATION_PREFIX}`)) continue;
      const sessionId = key.slice(STORAGE_PREFIX.length);
      if (sessionId.startsWith(LOCAL_TOOL_CREATION_PREFIX)) { legacyToolBoards.push(key); continue; }
      if (indexed.has(sessionId)) continue;
      const snapshot = readLocalCreationSession(sessionId);
      if (snapshot) indexed.set(sessionId, { sessionId, title: snapshot.title, ...(snapshot.folder ? { folder: snapshot.folder } : {}), updatedAt: snapshot.updatedAt });
    }
  } catch {
    // Enumeration blocked (rare privacy modes) — the stored index still stands.
  }

  // A one-time cleanup, not a permanent guard. `/tools/<id>` is a reference page
  // now (PRD 21 §11.4.5) and nothing writes these any more — but a browser that
  // visited a tool URL under the old build still holds one board per diagnostic,
  // and left in place they would surface in the canvas switcher as boards the
  // person never created and be claimed into the tenant on the next sign-in.
  for (const key of legacyToolBoards) {
    try { localStorage.removeItem(key); } catch { /* private mode — nothing to purge */ }
  }

  const live = [...indexed.values()]
    .filter((entry) => !entry.sessionId.startsWith(LOCAL_TOOL_CREATION_PREFIX))
    .filter((entry) => localStorage.getItem(creationStorageKey(entry.sessionId)) != null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  writeIndex(live);
  return live;
}

/**
 * A local board seeded with NOTES — the Brain's `show_canvas` landing.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `show_canvas` used to build a board for the second canvas implementation
 * (`components/canvas/canvasModel.ts`) and show it in a slide-out drawer, with a "save
 * to Knowledge" button that wrote it into a document's `content` string. That board has
 * folded into the Creation Canvas, so the tool now opens a REAL session: the same
 * stickies, on the canvas that is the front door, with every affordance that board never
 * had — connections, an object registry, history, sharing, and Brain itself.
 *
 * Local rather than server-side, deliberately: `show_canvas` is reachable by a signed-out
 * visitor from the Brain drawer, and a tool that required an account would answer with a
 * gate where it used to answer with a board.
 *
 * The reasoning in `createLocalCreationSession` about NOT guessing objects from a prompt
 * does not apply here and is worth saying so: these notes are not a guess, they are the
 * content the model was asked to produce and is handing over.
 */
export function createLocalCreationBoard(input: { title?: string; text?: string; stickies: readonly string[] }): string {
  const { sessionId, snapshot } = newLocalCreationBoardSnapshot(input);
  writeLocalCreationSession(sessionId, snapshot);
  return sessionId;
}

export function createLocalCreationSession(prompt: string, mode: ChatMode = NEW_CHAT_MODE): string {
  const { sessionId, snapshot } = newLocalCreationSessionSnapshot(prompt, mode);
  writeLocalCreationSession(sessionId, snapshot);
  return sessionId;
}

/**
 * Persist a local (account-less) canvas. The ONE write — the canvas had this
 * `localStorage.setItem(storageKey, JSON.stringify(snapshot))` inlined at three
 * call sites, which is three chances for the stored shape to drift from what
 * {@link readLocalCreationSession} validates on the way back in.
 */
export function writeLocalCreationSession(sessionId: string, snapshot: LocalCreationSnapshot): void {
  try {
    localStorage.setItem(creationStorageKey(sessionId), JSON.stringify(snapshot));
  } catch {
    // Private mode / quota — the board stays live in memory for this page, and a
    // shared session still has the room as its durable copy.
    return;
  }
  // The index rides the ONE write, so a board can never exist unlisted.
  indexLocalCreationSession(sessionId, snapshot.title, snapshot.updatedAt, snapshot.folder);
}

export function readLocalCreationSession(sessionId: string): LocalCreationSnapshot | null {
  try {
    const raw = localStorage.getItem(creationStorageKey(sessionId));
    return raw ? parseLocalCreationSnapshot(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Build the snapshot to write for a local canvas, carrying over what the board does
 * not hold (prompt, mode, folder) from the stored one. The shaping is
 * `localCreationSnapshotFrom` in the domain.
 */
export function localCreationSnapshot(
  sessionId: string,
  board: Pick<LocalCreationSnapshot, 'title' | 'timeline' | 'nodes' | 'edges' | 'viewport'>,
): LocalCreationSnapshot {
  return localCreationSnapshotFrom(readLocalCreationSession(sessionId), board);
}

export function removeLocalCreationSession(sessionId: string): void {
  const key = creationStorageKey(sessionId);
  localStorage.removeItem(key);
  /**
   * Every SIDECAR keyed off this board goes with it — the checkpoint stack today
   * (`creationCheckpoints.ts`), whatever is stored beside a board next.
   *
   * Swept by prefix rather than by an explicit list of stores, for two reasons. A
   * sidecar that outlives its board is a permanent leak against the same tiny quota the
   * checkpoint store already has to shed against, and it would resurface attached to a
   * board it is not about if an id were ever reused. The alternative — importing each
   * store here to call its own clear — is also a cycle, since a store keyed off a board
   * has to import `creationStorageKey` from this module.
   */
  const prefix = `${key}:`;
  for (const stored of Object.keys(localStorage)) {
    if (stored.startsWith(prefix)) localStorage.removeItem(stored);
  }
  writeIndex(readIndex().filter((entry) => entry.sessionId !== sessionId));
}

/** Rename or file a browser-local session without duplicating snapshot logic in UI. */
export function updateLocalCreationSession(
  sessionId: string,
  patch: { title?: string; folder?: string | null },
): LocalCreationSnapshot | null {
  const current = readLocalCreationSession(sessionId);
  if (!current) return null;
  const title = patch.title === undefined ? current.title : patch.title.trim().slice(0, 80) || current.title;
  const folder = patch.folder === undefined ? current.folder : patch.folder?.trim().slice(0, 120) || undefined;
  const next = { ...current, title, folder, updatedAt: new Date().toISOString() };
  writeLocalCreationSession(sessionId, next);
  return next;
}

/** Fold source drafts into the target and remove the now-redundant sources. */
export function mergeLocalCreationSessions(targetSessionId: string, sourceSessionIds: string[]): LocalCreationSnapshot | null {
  const target = readLocalCreationSession(targetSessionId);
  if (!target) return null;
  const sources = sourceSessionIds
    .filter((id) => id !== targetSessionId)
    .map((id) => ({ id, snapshot: readLocalCreationSession(id) }))
    .filter((item): item is { id: string; snapshot: LocalCreationSnapshot } => item.snapshot !== null);
  if (!sources.length) return target;

  const merged = mergedLocalCreationSnapshot(target, sources.map((item) => item.snapshot));
  writeLocalCreationSession(targetSessionId, merged);
  sources.forEach(({ id }) => removeLocalCreationSession(id));
  return merged;
}

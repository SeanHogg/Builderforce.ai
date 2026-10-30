/**
 * The words a person said that are not SAVED yet - kept on the device so a reload before the save lands (a slow
 * network, a closed tab, a timeout) does not lose them. Written when the words are first queued for a run
 * (`runSteering.ts`, AFTER they are in the inbox - a storage failure never costs a steer), cleared the moment they are
 * saved (the run's `persistSteer`, a continuation's save) or ended (every Stop), and replayed when the chat is next
 * opened (`useChatTranscript`) or the app starts (`BrainProvider`): saved under the key they were queued with, so a
 * save that did land is the same row, never a second.
 *
 * WHOSE words. The journal belongs to one signed-in person in one workspace: its key carries both
 * (`bf:pendingWords:<tenant>:<user>:<chatId>`), a host names them (`setPendingWordsOwner`), and signing out removes
 * the lot (`clearPendingWords`). With no owner there is no journal - the words are still kept in memory for the
 * session. An entry also expires (`TTL_MS`) and a chat holds at most `PER_CHAT_CAP`: a device is not an archive.
 *
 * WHICH SESSION. A second tab of the same person must not answer the first tab's words: an entry is replayed only
 * when the page load that wrote it is provably gone. Every page load holds a Web Lock named for itself for as long
 * as it lives (`navigator.locks`); another load replays an entry only if no one holds that lock. Where Web Locks
 * do not exist the load writes a heartbeat instead, and an entry whose heartbeat has gone quiet is dead.
 *
 * READ OR NOT. Words the model has already drained (`markPendingWordsRead`, by the run) were read by the run that
 * lost the page: replayed, they are saved as the mid-turn rows they were (`steerMetadata`) and do not prompt a second
 * answer. Words never drained replay as an ordinary pending user turn.
 *
 * Text only: a file the words carried was uploaded under its own key already. Every storage access is guarded - a
 * private window or a blocked profile simply has no journal - and nothing here throws.
 */

import { bounded } from './runStore/deadline';
import type { BrainRunPersistence } from './runStore/runTypes';
import { reportPendingWordsFailure } from './pendingWordsFailure';
import { steerMetadata } from './steerMetadata';

interface Pending {
  eventKey: string;
  text: string;
  /** The page load that queued it: only an EARLIER, dead one's words are replayed (this one's are still in its inbox). */
  session: string;
  /** When it was journaled (ms): expiry, and the grace a freshly started load gets to take its lock. */
  at: number;
  /** The model already drained it: replayed, it is a mid-turn row, not a turn awaiting an answer. */
  read?: true;
  /**
   * The chat its words are SAVED to - the run's own, or its owner's (`lineage.rootChatId`) for a sub-agent - where a replay
   * sends them. The journal is keyed by the RUN (a Stop and the run's drain find it there); an entry from before this field
   * replays to its key's chat.
   */
  chatId?: number;
}

/** How long an unsaved word is kept: a week. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** The most a chat's journal holds; past it the OLDEST goes. */
const PER_CHAT_CAP = 50;
/** A new page load takes its lock a moment after it starts: entries younger than this are never called dead. */
const START_GRACE_MS = 5_000;
/** Heartbeat fallback (no Web Locks): beat this often, call a load dead after this long without one. */
const BEAT_MS = 4_000;
const BEAT_DEAD_MS = 15_000;
/** One replay's whole allowance, and one save's. A slow network cannot hold a chat's load or the app's start. */
const REPLAY_BUDGET_MS = 20_000;
const SAVE_MS = 8_000;

const SESSION = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
const PREFIX = 'bf:pendingWords:';
const BEAT_PREFIX = 'bf:pendingBeat:';
const lockName = (session: string): string => `${PREFIX}session:${session}`;

let owner: string | null = null;

/** Where the app-start replay saves to: the mounted `BrainProvider`'s persistence. */
let startupPersistence: Pick<BrainRunPersistence, 'sendMessages'> | null = null;

/**
 * Name whose words these are (null: signed out, no journal). Hosts call it as the signed-in identity changes. The moment
 * a person is known the app has started for them: every chat they left words in is replayed, not only the one opened.
 */
export function setPendingWordsOwner(who: { tenant: string | number; user: string | number } | null): void {
  const next = who ? `${who.tenant}:${who.user}` : null;
  const changed = next !== owner;
  owner = next;
  if (!owner) stopBeating(); // nobody to keep words for: nothing may go on writing the heartbeat key
  if (changed && owner && startupPersistence) void replayAllPendingWords(startupPersistence);
}

/** The persistence the app-start replay saves through (null: the provider unmounted). Replays at once if the owner is known. */
export function registerPendingWordsReplay(persistence: Pick<BrainRunPersistence, 'sendMessages'> | null): void {
  startupPersistence = persistence;
  if (persistence && owner) void replayAllPendingWords(persistence);
}

const keyOf = (chatId: number): string | null => (owner ? `${PREFIX}${owner}:${chatId}` : null);

/** Run `use` against the device's storage; `fallback` when there is none or it refuses (a blocked profile, a full disk). */
function onStorage<T>(use: (store: Storage) => T, fallback: T): T {
  try {
    return typeof localStorage === 'undefined' ? fallback : use(localStorage);
  } catch {
    // Storage can throw on any access (blocked profile, quota): there is no journal then - by design, not a failure.
    return fallback;
  }
}

const keysStarting = (prefix: string): string[] => onStorage((store) => {
  const found: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key?.startsWith(prefix)) found.push(key);
  }
  return found;
}, []);

function parse(raw: string): Pending[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return (parsed as Pending[]).filter((p) => typeof p?.eventKey === 'string' && typeof p?.text === 'string');
  } catch {
    // A journal this build cannot read is dropped rather than replayed blind.
    return null;
  }
}

/**
 * The chat's live entries (expired ones dropped and forgotten). NULL: the device's storage cannot be read at all - not
 * the same as an empty journal, because a writer that treated it as empty would overwrite entries it could not see.
 */
function read(key: string): Pending[] | null {
  const got = onStorage((store) => ({ raw: store.getItem(key) }), null);
  if (!got) return null;
  const raw = got.raw;
  if (!raw) return [];
  const list = parse(raw);
  if (!list) {
    onStorage((store) => store.removeItem(key), undefined);
    return [];
  }
  const now = Date.now();
  const live = list.filter((p) => typeof p.at !== 'number' || now - p.at < TTL_MS);
  if (live.length !== list.length) write(key, live);
  return live;
}

/** True when the journal now holds `list`. False: no storage, or a refused write - the words are in memory only. */
function write(key: string, list: Pending[]): boolean {
  return onStorage((store) => {
    if (list.length === 0) store.removeItem(key);
    else store.setItem(key, JSON.stringify(list));
    return true;
  }, false);
}

// --- Is the page load that wrote an entry still alive? -------------------------------------------------------

let holding = false;
/** The heartbeat's timer while this load is findable by it (the no-Web-Locks way). */
let beatTimer: ReturnType<typeof setInterval> | null = null;

/** Make this page load findable as alive: hold its lock, or - without Web Locks - beat. Idempotent. */
function holdSession(): void {
  if (holding) return;
  holding = true;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks?.request) {
    // Granted and never released: the browser frees it when the page goes away, however it goes. A lock manager that
    // refuses is said once, and the heartbeat stands in - this load is still findable as alive.
    void locks.request(lockName(SESSION), () => new Promise<never>(() => undefined)).catch((e: unknown) => {
      reportPendingWordsFailure('hold_session', e);
      // Signed out meanwhile: nobody to keep words for and no heartbeat key to write back - the next journal write holds again.
      if (owner) beatWhileAlive();
      else holding = false;
    });
    return;
  }
  beatWhileAlive();
}

/** The no-Web-Locks way to be findable as alive: write a heartbeat now and every `BEAT_MS`. */
function beatWhileAlive(): void {
  const beat = (): void => onStorage((store) => store.setItem(`${BEAT_PREFIX}${SESSION}`, String(Date.now())), undefined);
  beat();
  beatTimer = setInterval(beat, BEAT_MS);
  (beatTimer as unknown as { unref?: () => void }).unref?.();
}

/**
 * Stop the heartbeat (sign-out, owner cleared): a timer left running would write `bf:pendingBeat:<session>` back right after
 * sign-out removed it. The next journal write makes this load findable again (`holdSession`).
 */
function stopBeating(): void {
  if (beatTimer === null) return;
  clearInterval(beatTimer);
  beatTimer = null;
  holding = false;
}

async function sessionAlive(session: string): Promise<boolean> {
  if (session === SESSION) return true;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks?.query) {
    // A lock manager that refuses is no verdict: fall through to the heartbeat rather than guess.
    const held = await locks.query().then((state) => state.held ?? [], () => null);
    if (held) return held.some((lock) => lock.name === lockName(session));
  }
  const beat = Number(onStorage((store) => store.getItem(`${BEAT_PREFIX}${session}`), null));
  return Number.isFinite(beat) && beat > 0 && Date.now() - beat < BEAT_DEAD_MS;
}

// --- Writing ------------------------------------------------------------------------------------------------

/** Journal the words. Returns whether they are on the device: false means a reload before the save lands loses them. */
export function rememberPendingWords(chatId: number, eventKey: string, text: string, savedTo: number = chatId): boolean {
  const key = keyOf(chatId);
  const body = text.trim();
  if (!key || !body) return false;
  holdSession();
  const list = read(key);
  // A device whose journal cannot be read keeps none: writing blind would overwrite entries this could not see.
  if (!list) return false;
  if (list.some((p) => p.eventKey === eventKey)) return true;
  return write(key, [...list, { eventKey, text: body, session: SESSION, at: Date.now(), chatId: savedTo }].slice(-PER_CHAT_CAP));
}

/** The words with these keys were saved, or ended (a Stop): they are no longer the device's to keep. */
export function forgetPendingWords(chatId: number, eventKeys: ReadonlyArray<string | undefined>): void {
  const key = keyOf(chatId);
  const gone = new Set(eventKeys.filter((k): k is string => !!k));
  if (!key || gone.size === 0) return;
  const list = read(key);
  if (!list) return;
  const rest = list.filter((p) => !gone.has(p.eventKey));
  if (rest.length !== list.length) write(key, rest);
}

/** The model drained these (it has read them): if the page is lost now, they replay as what they became. */
export function markPendingWordsRead(chatId: number, eventKeys: ReadonlyArray<string | undefined>): void {
  const key = keyOf(chatId);
  const drained = new Set(eventKeys.filter((k): k is string => !!k));
  if (!key || drained.size === 0) return;
  const list = read(key);
  if (!list || !list.some((p) => drained.has(p.eventKey) && !p.read)) return;
  write(key, list.map((p) => (drained.has(p.eventKey) ? { ...p, read: true as const } : p)));
}

/** Sign-out: nothing a person said stays on a device they have left (every owner's journal, and the heartbeats). */
export function clearPendingWords(): void {
  stopBeating();
  onStorage((store) => {
    for (const key of [...keysStarting(PREFIX), ...keysStarting(BEAT_PREFIX)]) store.removeItem(key);
  }, undefined);
  owner = null;
}

// --- Replaying ----------------------------------------------------------------------------------------------

/** A refusal that retrying cannot change: the chat is gone, the row is malformed. Not a lapsed login, a limit, a timeout. */
function permanentRefusal(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

async function replayOne(chatId: number, key: string, persistence: Pick<BrainRunPersistence, 'sendMessages'>): Promise<number> {
  const end = Date.now() + REPLAY_BUDGET_MS;
  let saved = 0;
  const dead: Pending[] = [];
  for (const word of read(key) ?? []) {
    // This load's own words are still in its inbox; a young entry's load may not have taken its lock yet.
    if (word.session === SESSION || Date.now() - word.at < START_GRACE_MS) continue;
    if (await sessionAlive(word.session)) continue;
    dead.push(word);
  }
  for (const word of dead) {
    const left = end - Date.now();
    if (left <= 0) break; // the allowance is spent: what is left waits for the next open
    try {
      const row = { role: 'user', content: word.text, ...(word.read ? { metadata: steerMetadata({}) } : {}), eventKey: word.eventKey };
      await bounded(Math.min(SAVE_MS, left), persistence.sendMessages(word.chatId ?? chatId, [row]));
      forgetPendingWords(chatId, [word.eventKey]);
      saved += 1;
    } catch (e) {
      // A refusal retrying cannot change ends the entry; anything else leaves it for the next open (the save is
      // idempotent on its key). Either way the NEXT entry is still tried.
      if (permanentRefusal(e)) forgetPendingWords(chatId, [word.eventKey]);
    }
  }
  return saved;
}

const replaying = new Map<string, Promise<number>>();

/**
 * Save the words a DEAD page load left unsaved, under the keys they were queued with (idempotent), then forget them.
 * Bounded; never rejects. One replay per chat at a time (a second asker shares it). Returns how many were saved.
 */
export function replayPendingWords(chatId: number, persistence: Pick<BrainRunPersistence, 'sendMessages'>): Promise<number> {
  const key = keyOf(chatId);
  if (!key) return Promise.resolve(0);
  const running = replaying.get(key);
  if (running) return running;
  const replay = replayOne(chatId, key, persistence)
    .catch((e: unknown) => {
      reportPendingWordsFailure('replay', e);
      return 0;
    })
    .finally(() => replaying.delete(key));
  replaying.set(key, replay);
  return replay;
}

/** The app started: replay every chat this person left words in, not only the one that happens to be opened. */
export async function replayAllPendingWords(persistence: Pick<BrainRunPersistence, 'sendMessages'>): Promise<number> {
  if (!owner) return 0;
  const prefix = `${PREFIX}${owner}:`;
  let saved = 0;
  for (const key of keysStarting(prefix)) {
    const chatId = Number(key.slice(prefix.length));
    if (Number.isInteger(chatId)) saved += await replayPendingWords(chatId, persistence);
  }
  return saved;
}

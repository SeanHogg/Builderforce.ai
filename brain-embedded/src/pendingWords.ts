/**
 * The words a person said that are not SAVED yet - kept on the device so a reload before the save lands (a slow
 * network, a closed tab, a timeout) does not lose them. Written when the words are first queued for a run
 * (`runSteering.ts`), cleared the moment they are saved (the run's `persistSteer`, a continuation's save, a Stop that
 * dropped them), and replayed when the chat is next opened by a LATER page load (`replayPendingWords`): saved under
 * the key they were queued with, so a save that did land is the same row, never a second.
 *
 * Text only: a file the words carried was uploaded under its own key already. A browser without storage (a private
 * window, a blocked profile) simply has no journal - the words are still kept in memory for the session.
 */

import type { BrainRunPersistence } from './runStore/runTypes';

interface Pending {
  eventKey: string;
  text: string;
  /** The page load that queued it: only an EARLIER one's words are replayed (this one's are still in its inbox). */
  session: string;
}

const SESSION = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
const keyOf = (chatId: number): string => `bf:pendingWords:${chatId}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Reading `localStorage` can throw (a blocked profile): there is no journal then - by design, not a failure.
    return null;
  }
}

function read(chatId: number): Pending[] {
  const raw = storage()?.getItem(keyOf(chatId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Pending[]).filter((p) => typeof p?.eventKey === 'string' && typeof p?.text === 'string') : [];
  } catch {
    // A journal this build cannot read is dropped rather than replayed blind.
    storage()?.removeItem(keyOf(chatId));
    return [];
  }
}

function write(chatId: number, list: Pending[]): void {
  const store = storage();
  if (!store) return;
  try {
    if (list.length === 0) store.removeItem(keyOf(chatId));
    else store.setItem(keyOf(chatId), JSON.stringify(list));
  } catch {
    // Quota or a blocked write: no journal for these words; they are still in memory.
  }
}

export function rememberPendingWords(chatId: number, eventKey: string, text: string): void {
  const list = read(chatId);
  if (list.some((p) => p.eventKey === eventKey)) return;
  write(chatId, [...list, { eventKey, text, session: SESSION }]);
}

export function forgetPendingWords(chatId: number, eventKeys: ReadonlyArray<string | undefined>): void {
  const gone = new Set(eventKeys.filter((k): k is string => !!k));
  if (gone.size === 0) return;
  const list = read(chatId);
  const rest = list.filter((p) => !gone.has(p.eventKey));
  if (rest.length !== list.length) write(chatId, rest);
}

export function pendingWordsOf(chatId: number): ReadonlyArray<{ eventKey: string; text: string }> {
  return read(chatId).map(({ eventKey, text }) => ({ eventKey, text }));
}

/**
 * Save the words an EARLIER page load left unsaved, under the keys they were queued with (idempotent), then forget
 * them. A save that fails leaves them for the next open. Never rejects. Returns how many were saved.
 */
export async function replayPendingWords(chatId: number, persistence: Pick<BrainRunPersistence, 'sendMessages'>): Promise<number> {
  const old = read(chatId).filter((p) => p.session !== SESSION);
  let saved = 0;
  for (const word of old) {
    try {
      await persistence.sendMessages(chatId, [{ role: 'user', content: word.text, eventKey: word.eventKey }]);
      forgetPendingWords(chatId, [word.eventKey]);
      saved += 1;
    } catch {
      // Left in the journal: the next open tries again (the save is idempotent on its key).
      break;
    }
  }
  return saved;
}

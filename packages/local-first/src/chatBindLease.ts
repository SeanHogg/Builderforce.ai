/**
 * The CHAT BIND LEASE — one server chat per local chat, whichever of the two ways the server
 * hears of it first (chat local #165961, 2026-11-21).
 *
 * A local chat reaches the server two ways that used to race:
 *   1. the BIND (`brain-embedded` `chatIdentity.ts`): `POST /api/brain/chats` on a run's start,
 *      then a bind-only mapping (`BOUND_ONLY_VERSION`) so the chat's import names that chat;
 *   2. the chat's sync IMPORT, materialized right before the push (`syncRound.ts`).
 * An import materialized while the POST was still in flight carried no `serverId` hint (no
 * mapping yet), so the server minted a SECOND chat and its receipt remapped the device onto it,
 * leaving the bound chat an empty orphan.
 *
 * The lease orders them through the store's own transactions:
 *   - the bind CLAIMS the lease before its POST, and only while no import of the chat has been
 *     materialized (a materialized import may already be on the server; its receipt binds the
 *     chat, a POST would only orphan one);
 *   - the sync round does not pick or materialize a chat import while its chat's lease is live,
 *     so the import goes up AFTER the bind mapping exists and carries the hint;
 *   - the bind RELEASES the lease in the transaction that writes its mapping (or on failure).
 * A lease expires after {@link CHAT_BIND_LEASE_MS}: a window that died mid-POST never parks the
 * import for good.
 *
 * The lease is a named instant in the store's persisted state (`setReadMark`), so every window
 * sharing the journal sees it.
 */

import type { LocalFirstTransaction } from './storeContract.js';
import type { JournalEvent } from './records.js';
import { selectPendingOf } from './pendingQueries.js';
import { isRecordPayloadMarker } from './recordPayloadMarker.js';

/** How long a claimed bind keeps its chat's import back. Longer than any bind POST. */
export const CHAT_BIND_LEASE_MS = 120_000;

const leaseKey = (clientId: string): string => `chatBind:${clientId}`;

/** The holder `createChat({ bindPending })` stamps; `adopt` of that chat takes the lease over as the same holder. */
export const BIND_PENDING_HOLDER = 'bind-pending';

const HOLDER_SEPARATOR = '#';

/** A lease mark: the claim instant (ISO), then `#holder`. A legacy mark is the instant alone (no holder). */
function parseLease(mark: string | undefined): { since: number; holder?: string } | undefined {
  if (mark === undefined) return undefined;
  const cut = mark.indexOf(HOLDER_SEPARATOR);
  const since = Date.parse(cut === -1 ? mark : mark.slice(0, cut));
  if (!Number.isFinite(since)) return undefined;
  return cut === -1 ? { since } : { since, holder: mark.slice(cut + 1) };
}

// Either side of now: a lease stamped by a clock that later stepped back still expires.
const isLive = (since: number, at: number): boolean => Math.abs(at - since) < CHAT_BIND_LEASE_MS;

const isChatImport = (event: Pick<JournalEvent, 'entityType' | 'operation'>): boolean =>
  event.entityType === 'chat' && event.operation === 'import';

/** The holder of chat `clientId`'s LIVE lease at `now`, or undefined (no lease, expired, or a legacy holderless one). */
export async function liveChatBindHolder(tx: LocalFirstTransaction, clientId: string, now: Date): Promise<string | undefined> {
  const lease = parseLease(await tx.readMark(leaseKey(clientId)));
  return lease && isLive(lease.since, now.getTime()) ? lease.holder : undefined;
}

/**
 * Claim the bind of chat `clientId` for `holder`: false when one of its imports is already
 * materialized (it may be on the server; the bind must not mint another chat) OR when ANOTHER
 * holder's lease is live (two windows sharing the journal must not both POST a bind: the caller
 * waits for the holder's binding). True once the lease is written. A claim without a holder, or
 * over a holderless (legacy) lease, takes it as before.
 */
export async function claimChatBind(tx: LocalFirstTransaction, clientId: string, now: Date, holder?: string): Promise<boolean> {
  const sent = await selectPendingOf(tx, 'chat', clientId, (event) => isChatImport(event) && !isRecordPayloadMarker(event));
  if (sent.length > 0) return false;
  const current = await liveChatBindHolder(tx, clientId, now);
  if (current !== undefined && holder !== undefined && current !== holder) return false;
  await tx.setReadMark(leaseKey(clientId), holder === undefined ? now.toISOString() : `${now.toISOString()}${HOLDER_SEPARATOR}${holder}`);
  return true;
}

/**
 * Release the lease of chat `clientId` (its mapping is written, or the bind failed). With `holders`,
 * only a lease held by one of them (or a holderless one) is released: a lease another window took
 * after ours expired is not ours to drop.
 */
export async function releaseChatBind(tx: LocalFirstTransaction, clientId: string, holders?: string | readonly string[]): Promise<void> {
  const mark = await tx.readMark(leaseKey(clientId));
  if (!mark) return;
  if (holders !== undefined) {
    const held = parseLease(mark)?.holder;
    const mine = typeof holders === 'string' ? [holders] : holders;
    if (held !== undefined && !mine.includes(held)) return;
  }
  await tx.setReadMark(leaseKey(clientId), undefined);
}

/** Whether `event` is a chat import whose chat has a live bind lease: not sendable now. */
export async function awaitsChatBind(tx: LocalFirstTransaction, event: Pick<JournalEvent, 'entityType' | 'operation' | 'clientEntityId'>, at: number): Promise<boolean> {
  if (!isChatImport(event)) return false;
  const lease = parseLease(await tx.readMark(leaseKey(event.clientEntityId)));
  return lease !== undefined && isLive(lease.since, at);
}

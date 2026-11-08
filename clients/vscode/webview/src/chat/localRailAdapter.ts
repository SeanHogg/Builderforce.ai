/**
 * The chat rail's adapter in the editor webview (G21): the rail's reads and link writes go to the
 * HOST'S LOCAL COPY (`local.chatRail`), not to the platform from this realm.
 *
 *   - `listTickets` / `listRuns` answer from the host's local store (so they work with the platform
 *     denied). When the platform is connected, a read also asks the host to refresh that copy in the
 *     background, at most once per `REFRESH_EVERY_MS` per chat and never for a read that a host push
 *     caused (a push is the store already changing; refreshing on it would loop).
 *   - `linkTicket` / `unlinkTicket` write local link records through the host.
 *   - Merge, invite, run and the rest stay with the platform adapter (`remote`), gated as before.
 *
 * The bearer-fetch path for the four calls above is not in this webview any more: `remote` is typed
 * without them.
 */

import type { ChatRunHistoryVM, ChatTicketsAdapter, TicketKind, TicketLinkVM } from '@seanhogg/builderforce-brain-ui';
import type {
  ChatRailMutationOutcome, ChatRailRefreshOutcome, ChatRailRequest, ChatRef, RailSnapshot, RailTicket,
} from '../../../src/chatRail/railProtocol';

/** The platform adapter, without the calls the local copy answers. */
export type RemoteChatTicketsAdapter = Omit<ChatTicketsAdapter, 'listTickets' | 'listRuns' | 'linkTicket' | 'unlinkTicket'>;

export interface LocalRailHost {
  call<T>(body: ChatRailRequest): Promise<T>;
  /** Whether the platform may be read now. */
  connected(): boolean;
  now?: () => number;
}

const REFRESH_EVERY_MS = 30_000;

/** The latest snapshot per chat, and which chats' next read follows a host push. */
export interface RailStore {
  get(chatId: ChatRef): RailSnapshot | undefined;
  set(rail: RailSnapshot): void;
  /** A host push: store it, and mark the next read as push-caused. */
  push(rail: RailSnapshot): void;
  /** True once after a push for this chat. */
  takePushed(chatId: ChatRef): boolean;
  subscribe(listener: () => void): () => void;
}

const keyOf = (chatId: ChatRef): string => `${typeof chatId}:${chatId}`;

export function createRailStore(): RailStore {
  const snapshots = new Map<string, RailSnapshot>();
  const pushed = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  return {
    get: (chatId) => snapshots.get(keyOf(chatId)),
    set(rail) { snapshots.set(keyOf(rail.chatId), rail); notify(); },
    push(rail) { pushed.add(keyOf(rail.chatId)); snapshots.set(keyOf(rail.chatId), rail); notify(); },
    takePushed: (chatId) => pushed.delete(keyOf(chatId)),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

export function ticketVm(ticket: RailTicket): TicketLinkVM {
  return {
    linkId: ticket.linkId,
    kind: ticket.kind as TicketKind,
    ref: ticket.ref,
    label: ticket.label,
    status: ticket.status,
    progressPct: ticket.progressPct,
    done: ticket.done,
    total: ticket.total,
    exists: ticket.exists,
    linkType: ticket.linkType,
    ...(ticket.parent ? { parent: { ...ticket.parent, kind: ticket.parent.kind as TicketKind } } : {}),
  };
}

function mutation(outcome: ChatRailMutationOutcome): void {
  if (!outcome.ok) throw new Error(outcome.error);
}

export function createLocalRailAdapter(remote: RemoteChatTicketsAdapter, host: LocalRailHost, store: RailStore): ChatTicketsAdapter {
  const now = host.now ?? Date.now;
  const lastRefresh = new Map<string, number>();

  const read = async (chatId: ChatRef): Promise<RailSnapshot> => {
    const rail = await host.call<RailSnapshot>({ action: 'read', chatId });
    store.set(rail);
    return rail;
  };

  /** Ask the host to take the platform's copy, in the background; the answer lands in the store. */
  const refreshSoon = (chatId: ChatRef): void => {
    if (store.takePushed(chatId) || !host.connected()) return;
    const key = keyOf(chatId);
    const at = now();
    if (at - (lastRefresh.get(key) ?? -Infinity) < REFRESH_EVERY_MS) return;
    lastRefresh.set(key, at);
    host.call<{ outcome: ChatRailRefreshOutcome; rail: RailSnapshot }>({ action: 'refresh', chatId })
      .then((answer) => store.set(answer.rail))
      .catch(() => { /* the local copy stands; the next read tries again */ });
  };

  return {
    ...remote,
    async listTickets(chatId) {
      const rail = await read(chatId);
      refreshSoon(chatId);
      return rail.tickets.map(ticketVm);
    },
    async listRuns(chatId): Promise<ChatRunHistoryVM> {
      return (await read(chatId)).runHistory;
    },
    async linkTicket(chatId, input) {
      mutation(await host.call<ChatRailMutationOutcome>({ action: 'link', chatId, kind: input.kind, ref: input.ref, linkType: input.linkType }));
    },
    async unlinkTicket(chatId, kind, ref) {
      mutation(await host.call<ChatRailMutationOutcome>({ action: 'unlink', chatId, kind, ref }));
    },
  };
}

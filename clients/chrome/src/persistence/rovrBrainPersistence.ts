/**
 * Rovr's device record as THE shared conversation's persistence port
 * (`BrainPersistenceAdapter`, read by `useBrainConversation` through `BrainProvider`) —
 * so the side panel's chat runs the SAME hook as the web Brain and the VS Code webview.
 *
 * What the conversation reads and writes is real and local first: a chat's transcript is
 * the device record (`records.listMessages`), and every turn and step row goes through
 * the local-first port (`localFirstPersistence.ts` — the device record, then the sync
 * outbox), never the network directly.
 *
 * LIVE, like the web's: every row written through this port — the run's turns, the step
 * rows the durable step outbox drains on open, a write from another panel window — is
 * announced on `subscribeMessages`, so the hook re-reads the device record and the row
 * appears without waiting for a run to settle. Writes in THIS context notify directly;
 * other extension contexts (a side panel in another window shares the IndexedDB) hear
 * them through the optional `channel` (`broadcastMessageChanges`).
 *
 * What the conversation never asks of it is REFUSED with a reason, not faked: Rovr's
 * chats are its device record, created, titled and listed by the panel (`App.tsx`,
 * `useChatCreation` in `ChatView.tsx`) — never through this adapter — and Rovr offers no
 * attachments or thumbs. A call that reaches one of those is a wiring bug, said as one.
 */
import type { BrainPersistenceAdapter, BrainRunPersistence } from '@seanhogg/builderforce-brain-embedded';
import type { RovrRecords } from '../store/records';

/** "Chat N's messages changed" between extension contexts. */
export interface MessageChangeChannel {
  post(chatId: number): void;
  listen(onChange: (chatId: number) => void): () => void;
}

/** The cross-context channel over `BroadcastChannel` (every extension page has one), or
 *  undefined where there is none — then only this context's own writes notify. */
export function broadcastMessageChanges(name = 'rovr.messages'): MessageChangeChannel | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  const channel = new BroadcastChannel(name);
  return {
    post: (chatId) => channel.postMessage({ chatId }),
    listen(onChange) {
      const handle = (event: MessageEvent) => {
        const chatId = (event.data as { chatId?: unknown } | null)?.chatId;
        if (typeof chatId === 'number') onChange(chatId);
      };
      channel.addEventListener('message', handle);
      return () => channel.removeEventListener('message', handle);
    },
  };
}

function notInRovr(what: string): () => Promise<never> {
  return () => Promise.reject(new Error(`${what} is not part of Rovr's conversation: its chats are the device record the panel manages.`));
}

export function createRovrBrainPersistence(
  records: RovrRecords,
  run: BrainRunPersistence,
  channel?: MessageChangeChannel,
): BrainPersistenceAdapter {
  const listeners = new Map<number, Set<() => void>>();
  const notify = (chatId: number) => {
    for (const listener of [...(listeners.get(chatId) ?? [])]) listener();
  };
  channel?.listen(notify);
  return {
    getMessages: (chatId) => records.listMessages(chatId),
    async sendMessages(chatId, messages) {
      const saved = await run.sendMessages(chatId, messages);
      notify(chatId);
      channel?.post(chatId);
      return saved;
    },
    subscribeMessages(chatId, onChanged) {
      const set = listeners.get(chatId) ?? new Set<() => void>();
      set.add(onChanged);
      listeners.set(chatId, set);
      return () => {
        set.delete(onChanged);
        if (set.size === 0) listeners.delete(chatId);
      };
    },
    listChats: notInRovr('Listing chats'),
    getChat: notInRovr('Reading a chat'),
    createChat: notInRovr('Creating a chat'),
    updateChat: notInRovr('Updating a chat'),
    deleteChat: notInRovr('Deleting a chat'),
    archiveChat: notInRovr('Archiving a chat'),
    summarizeChat: notInRovr('Summarizing a chat'),
    setMessageFeedback: notInRovr('Rating a reply'),
    upload: notInRovr('Attaching a file'),
    uploadUrl: (key) => key,
  };
}

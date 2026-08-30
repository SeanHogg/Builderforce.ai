import type { BrainChat, BrainMessage, BrainPersistenceAdapter } from '@seanhogg/builderforce-brain-embedded';

/**
 * The chat store for a conversation that has no account behind it.
 *
 * Picking a model on this machine deliberately does not require signing in — the
 * hardware is yours. But the run loop persists BEFORE it streams: `sendMessages` for the
 * user turn is awaited, and only then does `startRun` call the model. With the gateway
 * adapter and no token that first write throws on a 401, so the turn ended at the
 * transport-independent step and the model was never reached at all. The panel rendered,
 * the send failed, and nothing explained why.
 *
 * So a signed-out local chat gets a store that lives in this webview and nowhere else.
 * It is not a cache or an offline queue: nothing here is ever replayed to the server.
 * The conversation exists for as long as the panel is open, which is the honest bargain
 * for a chat that was never sent anywhere.
 *
 * The optional members of the adapter are OMITTED rather than stubbed, because each one
 * means something this store genuinely cannot do:
 *   - `subscribeMessages` — nothing else can change these messages;
 *   - `markChatRead` — there is no second surface to carry an unread badge (the
 *     interface anticipates exactly this: "a guest/offline backend that has no unread
 *     concept simply omits it");
 *   - `requestAgentReply` — an agent participant is a server-side run;
 *   - `signedUploadUrl` — there is no signer, and no upstream provider to fetch it.
 * Omitting them lets the loop take its documented fallbacks instead of discovering the
 * limitation as a rejected promise mid-turn.
 */
export function createInMemoryPersistence(labels: { summarizeUnavailable: string }): BrainPersistenceAdapter {
  const chats = new Map<number, BrainChat>();
  const messages = new Map<number, BrainMessage[]>();
  const blobs = new Map<string, string>();
  let nextId = 1;

  const now = (): string => new Date().toISOString();
  const require_ = (id: number): BrainChat => {
    const chat = chats.get(id);
    // The loop treats a missing chat as a bug, not a state to recover from — say which.
    if (!chat) throw new Error(`No such chat in this session: ${id}`);
    return chat;
  };

  return {
    listChats: async (p) => {
      const all = [...chats.values()].filter((c) => (p?.projectId == null ? true : String(c.projectId) === p.projectId));
      // Newest first, the order the gateway returns and the chat list assumes.
      const sorted = all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
      const offset = p?.offset ?? 0;
      return p?.limit != null ? sorted.slice(offset, offset + p.limit) : sorted.slice(offset);
    },

    getChat: async (id) => require_(id),

    createChat: async (body) => {
      const stamp = now();
      const chat: BrainChat = {
        id: nextId++,
        title: body.title ?? 'New chat',
        projectId: body.projectId ?? null,
        origin: 'ide',
        capability: body.capability ?? null,
        mode: body.mode ?? null,
        createdAt: stamp,
        updatedAt: stamp,
      };
      chats.set(chat.id, chat);
      messages.set(chat.id, []);
      return chat;
    },

    updateChat: async (id, body) => {
      const next: BrainChat = { ...require_(id), ...body, updatedAt: now() };
      chats.set(id, next);
      return next;
    },

    deleteChat: async (id) => {
      chats.delete(id);
      messages.delete(id);
      return {};
    },

    // A summary is a server-side model run against the stored transcript. Say so plainly
    // through the interface's own error channel rather than inventing an empty summary.
    summarizeChat: async () => ({ error: labels.summarizeUnavailable }),

    getMessages: async (chatId, limit) => {
      const all = messages.get(chatId) ?? [];
      // `limit` means the most recent N, and they stay in chronological order.
      return limit != null ? all.slice(-limit) : [...all];
    },

    sendMessages: async (chatId, msgs) => {
      require_(chatId);
      const list = messages.get(chatId) ?? [];
      const stamp = now();
      const added = msgs.map((m, i): BrainMessage => ({
        id: nextId++,
        role: m.role,
        content: m.content,
        metadata: m.metadata ?? null,
        seq: list.length + i + 1,
        createdAt: stamp,
      }));
      messages.set(chatId, [...list, ...added]);
      // Touch the chat so the list re-sorts the way the gateway's would.
      const chat = chats.get(chatId);
      if (chat) chats.set(chatId, { ...chat, updatedAt: stamp });
      // No `evermindLearn`: the learn gate is the server's, and it did not run. The loop
      // renders no learn step when the outcome is absent, which is the truthful result.
      return added;
    },

    // Nothing reads a thumb back, but the press must not throw mid-transcript.
    setMessageFeedback: async () => ({}),

    upload: async (file) => {
      const key = `session-${nextId++}`;
      blobs.set(key, URL.createObjectURL(file));
      return { key, name: file.name, type: file.type };
    },

    uploadUrl: (key) => blobs.get(key) ?? '',
  };
}

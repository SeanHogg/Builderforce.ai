import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useChatMemorySwitch } from '@seanhogg/builderforce-brain-ui';
import type { useBrainChats } from '@/lib/brain';
import { brain } from '@/lib/builderforceApi';
import { projectBrainMemoryHooks } from '@/lib/brainMemoryHooks';

/**
 * Project-Evermind memory for the active chat: the recall/learn hooks, the
 * self-healing learning scope, and the per-chat memory switch that gates them.
 */
export function useBrainChatMemory({ chats, pinnedProjectId, viewingProjectId }: {
  chats: ReturnType<typeof useBrainChats>;
  pinnedProjectId: number | null;
  viewingProjectId: number | null;
}) {
  const { activeChatId, activeChat, reload, setMemoryEnabled, chats: chatList } = chats;
  // Project-Evermind memory hooks: recall the active chat's project learnings
  // before answering (grounding the reply + surfacing recall/learn/reconcile
  // steps). Bound to the chat's project (falling back to the pinned/viewing one a
  // new chat will be created under, so learning + recall stay on the same model).
  const evermindProjectId = activeChat?.projectId ?? pinnedProjectId ?? viewingProjectId ?? null;
  // Chat-tiered recall: this conversation's own memories first, the project's after.
  const evermind = useMemo(
    () => projectBrainMemoryHooks(evermindProjectId, activeChatId),
    [evermindProjectId, activeChatId],
  );

  // Self-heal Evermind learning scope (web parity with the VS Code webview). The server's
  // chat→Evermind learn gate keys on `brain_chats.projectId`: a project-less chat NEVER
  // contributes even while the composer badge/panel shows the page's project as connected
  // (they resolve via the pinned/viewing FALLBACK). So a chat created before a project was
  // scoped (or any older/global chat) silently never trains the model. When the page has a
  // resolved project and the open chat is project-less, adopt it onto the chat so its turns
  // actually train that project's Evermind. One-shot per chat (guarded), best-effort.
  const adoptedProjectRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const pid = pinnedProjectId ?? viewingProjectId ?? null;
    const chatId = activeChatId;
    const active = activeChat;
    if (chatId == null || pid == null || active == null || active.projectId != null) return;
    if (adoptedProjectRef.current.has(chatId)) return;
    adoptedProjectRef.current.add(chatId);
    brain.updateChat(chatId, { projectId: pid })
      .then(() => reload())
      .catch(() => { adoptedProjectRef.current.delete(chatId); });
  }, [activeChatId, activeChat, reload, pinnedProjectId, viewingProjectId]);

  // Per-chat memory switch: whether THIS chat passes the project-Evermind hooks
  // (recall + learn). A property of the CONVERSATION (`brain_chats.memory_enabled`),
  // so the same chat says the same thing here, in the editor and in Rovr, and the
  // server's own memory paths see it. It used to live in this browser's localStorage.
  const { enabled: memoryEnabled, setEnabled } = useChatMemorySwitch({
    chatId: activeChatId,
    serverValue: activeChat?.memoryEnabled,
    persist: setMemoryEnabled,
  });
  // A choice made before the chat exists (the empty state) seeds the chat the first
  // send creates — the switch holds it locally until there is a row to write it to.
  // It holds the chat ids that already existed at the toggle, so opening an EXISTING
  // chat from the empty state never rewrites that conversation's own switch.
  const pendingOffRef = useRef<ReadonlySet<number> | null>(null);
  const toggleMemory = useCallback((on: boolean) => {
    if (activeChatId == null) pendingOffRef.current = on ? null : new Set(chatList.map((c) => c.id));
    setEnabled(on);
  }, [activeChatId, chatList, setEnabled]);
  useEffect(() => {
    const existedBefore = pendingOffRef.current;
    if (activeChatId == null || existedBefore == null) return;
    pendingOffRef.current = null;
    if (existedBefore.has(activeChatId) || activeChat?.memoryEnabled === false) return;
    // Through the switch, now that the chat exists: it saves, and a refused save
    // reverts it to the server's value.
    setEnabled(false);
  }, [activeChatId, activeChat?.memoryEnabled, setEnabled]);
  // Gate the Evermind hooks on the per-chat switch — off ⇒ no recall/learn this chat.
  const gatedEvermind = memoryEnabled ? evermind : undefined;

  return { evermindProjectId, memoryEnabled, toggleMemory, gatedEvermind };
}

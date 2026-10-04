import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { useBrainChats } from '@/lib/brain';
import { brain } from '@/lib/builderforceApi';
import { projectBrainMemoryHooks } from '@/lib/brainMemoryHooks';
import { MEMORY_KEY } from '../panel/brainPanelUtils';

/**
 * Project-Evermind memory for the active chat: the recall/learn hooks, the
 * self-healing learning scope, and the per-chat memory switch that gates them.
 */
export function useBrainChatMemory({ chats, pinnedProjectId, viewingProjectId }: {
  chats: ReturnType<typeof useBrainChats>;
  pinnedProjectId: number | null;
  viewingProjectId: number | null;
}) {
  // Project-Evermind memory hooks: recall the active chat's project learnings
  // before answering (grounding the reply + surfacing recall/learn/reconcile
  // steps). Bound to the chat's project (falling back to the pinned/viewing one a
  // new chat will be created under, so learning + recall stay on the same model).
  const evermindProjectId = chats.activeChat?.projectId ?? pinnedProjectId ?? viewingProjectId ?? null;
  // Chat-tiered recall: this conversation's own memories first, the project's after.
  const evermind = useMemo(
    () => projectBrainMemoryHooks(evermindProjectId, chats.activeChatId),
    [evermindProjectId, chats.activeChatId],
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
    const chatId = chats.activeChatId;
    const active = chats.activeChat;
    if (chatId == null || pid == null || active == null || active.projectId != null) return;
    if (adoptedProjectRef.current.has(chatId)) return;
    adoptedProjectRef.current.add(chatId);
    brain.updateChat(chatId, { projectId: pid })
      .then(() => chats.reload())
      .catch(() => { adoptedProjectRef.current.delete(chatId); });
  }, [chats.activeChatId, chats.activeChat, chats.reload, pinnedProjectId, viewingProjectId]);

  // Per-chat memory switch: whether THIS chat passes the project-Evermind hooks
  // (recall + learn). Default ON; persisted per-chat in localStorage so it sticks
  // across reloads. Turning it off makes the chat a scratch space that neither
  // recalls nor writes back to the project's learned memory.
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  useEffect(() => {
    const cid = chats.activeChatId;
    if (cid == null) { setMemoryEnabled(true); return; }
    try {
      const v = window.localStorage.getItem(MEMORY_KEY(cid));
      setMemoryEnabled(v == null ? true : v !== '0');
    } catch { setMemoryEnabled(true); }
  }, [chats.activeChatId]);
  const toggleMemory = useCallback((on: boolean) => {
    setMemoryEnabled(on);
    const cid = chats.activeChatId;
    if (cid == null) return;
    try { window.localStorage.setItem(MEMORY_KEY(cid), on ? '1' : '0'); } catch { /* storage blocked */ }
  }, [chats.activeChatId]);
  // Gate the Evermind hooks on the per-chat switch — off ⇒ no recall/learn this chat.
  const gatedEvermind = memoryEnabled ? evermind : undefined;

  return { evermindProjectId, memoryEnabled, toggleMemory, gatedEvermind };
}

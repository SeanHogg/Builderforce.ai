/**
 * The open chat's project memory — the Evermind hooks the run recalls from and learns
 * into, the chat's own Memory switch that gates them, and the one-shot self-heal that
 * files a project-less chat under the IDE's project so its turns actually train it.
 * Lifted out of the chat surface; it hands back only what `useBrainConversation` and
 * the composer's Memory row read.
 */

import { useEffect, useMemo, useRef } from 'react';
import { type BrainChat, type BrainPersistenceAdapter } from '@seanhogg/builderforce-brain-embedded';
import { useChatMemorySwitch } from '@seanhogg/builderforce-brain-ui';
import { authedFetch } from '../authedFetch';
import { adoptChatProject } from '../adoptChatProject';
import { getToken, refreshToken, type InitData } from '../vscodeBridge';
import { vsixWebviewMemoryHooks } from './vsixWebviewMemoryHooks';

export function useChatMemory({ init, chatId, activeChat, projectId, persistence, reloadChats, persistMemory, armMemory }: {
  init: InitData;
  chatId: number | null;
  activeChat: BrainChat | null;
  /** The chat's project, chat-first (falls back to the IDE's open project). */
  projectId: number | null;
  persistence: BrainPersistenceAdapter;
  reloadChats: () => void;
  persistMemory: (id: number, on: boolean) => Promise<void>;
  armMemory: (on: boolean) => void;
}) {
  // Self-heal Evermind learning scope. The server's chat→Evermind learn gate keys on
  // brain_chats.projectId (evaluateBrainLearnGate): a project-less chat NEVER
  // contributes — even though the Evermind panel shows the IDE project's model as
  // connected, because it resolves the project via the init.project FALLBACK. When the
  // IDE has a resolved project and the open chat is project-less, adopt it onto the chat
  // so its turns actually train the project's Evermind. One-shot per chat (guarded),
  // best-effort — a failure just leaves it unscoped.
  //
  // The chat's project is read with `getChat`, NOT looked up in `chats`: that list is
  // fetched with `?projectId=<active>` and the server EXCLUDES a project-less chat, so
  // the self-heal could never fire for exactly the chats it exists to heal (chat #85).
  const adoptedProjectRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const pid = init.project?.id;
    if (chatId == null || pid == null || adoptedProjectRef.current.has(chatId)) return;
    adoptedProjectRef.current.add(chatId);
    // The decision lives in `adoptChatProject` (unit-tested); this effect only supplies
    // the ids and reacts to the outcome.
    void adoptChatProject(persistence, chatId, pid).then((outcome) => {
      if (outcome === 'adopted') reloadChats();
      // Let a transient read/write failure be retried the next time it is opened.
      else if (outcome === 'failed') adoptedProjectRef.current.delete(chatId);
    });
  }, [chatId, init.project?.id, persistence, reloadChats]);

  // On-device first, then the project's server memory — the same order the web and Rovr
  // use. This chat runs in the Chromium webview, so the on-device tier is real here
  // (null without WebGPU, partitioned by project). The extension-host run is a different
  // path and stays server-only: Node has no WebGPU, and a loader there would always be
  // null. `chatId` makes recall CHAT-TIERED: this conversation's own memories first.
  const evermind = useMemo(() => {
    if (projectId == null) return undefined;
    const req = authedFetch(init.baseUrl, getToken, () => void refreshToken());
    return vsixWebviewMemoryHooks(projectId, req, chatId);
  }, [projectId, init.baseUrl, chatId]);

  // Per-chat memory switch: a property of the CONVERSATION (`brain_chats.memory_enabled`)
  // — the same chat reads the same switch on the web — and the host's run reads it too:
  // the run spec's `evermind` flag also drops the memory tools. Off makes the chat a
  // scratch space (no recall, no learning).
  const { enabled: memoryEnabled, setEnabled: setMemoryEnabled } = useChatMemorySwitch({
    chatId,
    serverValue: activeChat?.memoryEnabled,
    persist: persistMemory,
  });
  armMemory(memoryEnabled);

  return { memoryEnabled, setMemoryEnabled, evermind: memoryEnabled ? evermind : undefined };
}

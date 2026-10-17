'use client';

import { useCallback, useRef, useState } from 'react';
import { NEW_CHAT_MODE, normalizeChatMode, type ChatMode } from './chatMode';
import type { UseBrainChats } from './useBrainChats';

/**
 * The choices a person makes BEFORE a conversation exists — its Chat|Work mode and its
 * Memory switch — and the ONE creation path that carries them. Moved from the web
 * Brain panel (`useBrainChatStart`) and the editor's chat list (`useVsCodeChats`),
 * which each kept a copy.
 *
 * Every creation path has to carry the armed mode: a person who picks Work in the
 * empty state and then types must get a WORK conversation, not a chat one that
 * silently declines to do the thing they asked for. The choices live in refs as well
 * as state so `createArmed` reads the current value without being re-created — it is
 * a dependency of the `ensureChatId` captured into every run.
 *
 * Once a chat exists, mode and memory are properties of the CONVERSATION (they follow
 * it to every surface), so `selectMode` writes through to it.
 */
export interface ArmedNewChat {
  /** The open chat's mode, or the armed one before a chat exists. */
  chatMode: ChatMode;
  selectMode: (mode: ChatMode) => Promise<void>;
  /** Arm the Memory switch for the chat the first send creates. */
  armMemory: (on: boolean) => void;
  /** Create (and select) a chat carrying the armed mode and memory. */
  createArmed: (opts?: Parameters<UseBrainChats['create']>[0]) => ReturnType<UseBrainChats['create']>;
}

export function useArmedNewChat(
  chats: Pick<UseBrainChats, 'activeChatId' | 'activeChat' | 'create' | 'setMode' | 'setMemoryEnabled'>,
): ArmedNewChat {
  const { activeChatId, activeChat, create, setMode, setMemoryEnabled } = chats;
  const [pendingMode, setPendingMode] = useState<ChatMode>(NEW_CHAT_MODE);
  const pendingModeRef = useRef<ChatMode>(NEW_CHAT_MODE);
  const pendingMemoryRef = useRef(true);

  const selectMode = useCallback(async (mode: ChatMode) => {
    pendingModeRef.current = mode;
    setPendingMode(mode);
    if (activeChatId != null) await setMode(activeChatId, mode);
  }, [activeChatId, setMode]);

  const armMemory = useCallback((on: boolean) => { pendingMemoryRef.current = on; }, []);

  const createArmed = useCallback(async (opts?: Parameters<UseBrainChats['create']>[0]) => {
    const created = await create({ ...opts, mode: opts?.mode ?? pendingModeRef.current });
    if (created && !pendingMemoryRef.current) await setMemoryEnabled(created.id, false).catch(() => undefined);
    return created;
  }, [create, setMemoryEnabled]);

  const chatMode: ChatMode = activeChat ? normalizeChatMode(activeChat.mode) : pendingMode;
  return { chatMode, selectMode, armMemory, createArmed };
}

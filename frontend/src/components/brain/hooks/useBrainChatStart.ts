import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import {
  getBrainCapability,
  normalizeChatMode,
  NEW_CHAT_MODE,
  type useBrainChats,
  type ChatMode,
  type WorkOptionId,
  type BrainCapabilityId,
} from '@/lib/brain';
import type { BrainDockedTab } from '../BrainDockedHeader';

/**
 * How a conversation starts and what it is FOR: the composer draft and its focus
 * token, the ONE new-chat path, and the chat's capability ("what are we making?")
 * and mode ("am I asking, or delegating?") — each of which can seed the composer.
 */
export function useBrainChatStart({ chats, isPage, setDockedTab }: {
  chats: ReturnType<typeof useBrainChats>;
  isPage: boolean;
  setDockedTab: Dispatch<SetStateAction<BrainDockedTab>>;
}) {
  const tBrain = useTranslations('brain');
  const [input, setInput] = useState('');
  /** Bumped to pull focus into the composer after something seeds it. */
  const [composerFocusToken, setComposerFocusToken] = useState(0);
  /**
   * The mode a NOT-YET-CREATED chat will be born in (migration 0409). Declared here,
   * above `startNewChat`, because every creation path has to carry it: a user who
   * picks Work in the empty state and then types must get a WORK conversation, not a
   * chat one that silently declines to do the thing they asked for. Mirrored into a
   * ref so `startNewChat` reads the current value without being re-created (it is a
   * dependency of `ensureChatId`, which is captured into every run). The ref is
   * written where the mode is chosen (`selectMode`), never during render.
   */
  const [pendingMode, setPendingMode] = useState<ChatMode>(NEW_CHAT_MODE);
  const pendingModeRef = useRef<ChatMode>(NEW_CHAT_MODE);

  /**
   * Start a chat and land the user in it. The ONE "new chat" path for every
   * surface control (header button, empty-state buttons, capability tiles,
   * composer-driven creation) — docked, that also has to leave the history tab,
   * otherwise pressing "+ New" from history silently created a chat the user
   * never saw.
   */
  const startNewChat = useCallback(async (opts?: { title?: string; projectId?: number | null; capability?: string | null; mode?: ChatMode }) => {
    // The mode chosen in the empty state rides EVERY creation path — including the one
    // that fires implicitly when the user just types and hits send (`ensureChatId`).
    const created = await chats.create({ ...opts, mode: opts?.mode ?? pendingModeRef.current });
    if (!isPage) setDockedTab('chat');
    return created;
  }, [chats, isPage, setDockedTab]);

  const ensureChatId = useCallback(async () => {
    const c = await startNewChat();
    return c?.id ?? null;
  }, [startNewChat]);

  // ---- Capability ("what are we making?") ----------------------------------
  // A property of the CHAT (migration 0345), so the choice follows the
  // conversation to every surface instead of living in this browser. Picking one
  // folds a capability block into the system prompt so the model shapes its
  // output as that artifact, and seeds the composer with a starting line.
  const capabilityId = (getBrainCapability(chats.activeChat?.capability)?.id ?? null) as BrainCapabilityId | null;
  const selectCapability = useCallback(async (id: BrainCapabilityId | null) => {
    // From the empty state there is no chat yet — start one carrying the choice
    // (same path the "Start new chat" button takes, plus the capability).
    if (chats.activeChatId == null) {
      if (id == null) return;
      await startNewChat({ capability: id });
    } else {
      await chats.setCapability(chats.activeChatId, id);
    }
    if (id) {
      setInput((prev) => (prev.trim() ? prev : tBrain(`capabilities.${id}.starter`)));
      // Focus with the caret at the end: the starter is an editable opening line,
      // not a finished message. (Sending the raw seed produced stub replies.)
      setComposerFocusToken((n) => n + 1);
    }
  }, [chats, startNewChat, tBrain]);
  const capabilityPrompt = getBrainCapability(capabilityId)?.systemPrompt;

  // ---- Mode ("am I asking, or delegating?") --------------------------------
  // A property of the CHAT (migration 0409), like `capability`, so the choice follows
  // the conversation rather than the browser. `pendingMode` (declared above, beside the
  // composer state, because `startNewChat` reads it) covers the pre-chat empty state:
  // without it, picking Work and then typing would silently mint a `chat`-mode chat.
  const chatMode: ChatMode = chats.activeChat
    ? normalizeChatMode(chats.activeChat.mode)
    : pendingMode;
  const selectMode = useCallback(async (mode: ChatMode) => {
    pendingModeRef.current = mode;
    setPendingMode(mode);
    const id = chats.activeChatId;
    if (id != null) await chats.setMode(id, mode);
  }, [chats]);
  // A work option is a STARTING POINT, not a message: seed the composer and drop the
  // caret at the end so the user finishes the brief instead of sending the template.
  const pickWorkOption = useCallback((_id: WorkOptionId, brief: string) => {
    setInput((prev) => (prev.trim() ? prev : brief));
    setComposerFocusToken((n) => n + 1);
  }, []);
  /** The empty state's "Onboard me": a fresh chat, seeded with the onboarding brief. */
  const onboard = useCallback(() => {
    void startNewChat();
    setInput(tBrain('onboardMePrompt'));
    setComposerFocusToken((n) => n + 1);
  }, [startNewChat, tBrain]);

  return {
    input,
    setInput,
    composerFocusToken,
    startNewChat,
    ensureChatId,
    capabilityId,
    capabilityPrompt,
    selectCapability,
    chatMode,
    selectMode,
    pickWorkOption,
    onboard,
  };
}

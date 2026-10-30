import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import {
  getBrainCapability,
  useArmedNewChat,
  useChatCreation,
  type useBrainChats,
  type ChatMode,
  type WorkOptionId,
  type BrainCapabilityId,
} from '@/lib/brain';
import type { BrainDockedTab } from './useBrainPanelController';

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
  // The chat hook's methods are individually stable; its result object is not.
  const { setCapability, activeChatId, activeChat, autoTitle, captureOriginalRequest } = chats;
  const [input, setInput] = useState('');
  /** Bumped to pull focus into the composer after something seeds it. */
  const [composerFocusToken, setComposerFocusToken] = useState(0);
  // The mode a NOT-YET-CREATED chat will be born in, and the ONE creation path that
  // carries it — the shared pre-chat arming every surface uses (brain-embedded).
  const { chatMode, selectMode, createArmed } = useArmedNewChat(chats);

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
    const created = await createArmed(opts);
    if (!isPage) setDockedTab('chat');
    return created;
  }, [createArmed, isPage, setDockedTab]);

  // "The first message creates the chat" — the shared single-flight creation (a fast
  // second send joins the first's create) through THIS surface's new-chat path, and the
  // first user turn names the chat. Both are `useBrainConversation` options. The same
  // turn also records the prompt itself (migration 1245) — passed as a sibling port so
  // the two can never drift; the chat's original request outlives the ~60-char title.
  const { ensureChatId, onFirstUserTurn, drafts } = useChatCreation({
    chatId: activeChatId,
    create: async () => (await startNewChat())?.id ?? null,
    autoTitle,
    onCaptureOriginalRequest: captureOriginalRequest,
  });

  // ---- Capability ("what are we making?") ----------------------------------
  // A property of the CHAT (migration 0345), so the choice follows the
  // conversation to every surface instead of living in this browser. Picking one
  // folds a capability block into the system prompt so the model shapes its
  // output as that artifact, and seeds the composer with a starting line.
  const capabilityId = (getBrainCapability(activeChat?.capability)?.id ?? null) as BrainCapabilityId | null;
  const selectCapability = useCallback(async (id: BrainCapabilityId | null) => {
    // From the empty state there is no chat yet — start one carrying the choice
    // (same path the "Start new chat" button takes, plus the capability).
    if (activeChatId == null) {
      if (id == null) return;
      await startNewChat({ capability: id });
    } else {
      await setCapability(activeChatId, id);
    }
    if (id) {
      setInput((prev) => (prev.trim() ? prev : tBrain(`capabilities.${id}.starter`)));
      // Focus with the caret at the end: the starter is an editable opening line,
      // not a finished message. (Sending the raw seed produced stub replies.)
      setComposerFocusToken((n) => n + 1);
    }
  }, [activeChatId, setCapability, startNewChat, tBrain]);
  const capabilityPrompt = getBrainCapability(capabilityId)?.systemPrompt;

  // ---- Mode ("am I asking, or delegating?") --------------------------------
  // A property of the CHAT (migration 0409), like `capability`; before a chat exists,
  // the armed mode (`useArmedNewChat`) — so picking Work then typing mints a Work chat.
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
    onFirstUserTurn,
    drafts,
    capabilityId,
    capabilityPrompt,
    selectCapability,
    chatMode,
    selectMode,
    pickWorkOption,
    onboard,
  };
}

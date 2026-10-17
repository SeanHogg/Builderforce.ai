/** The canvas composer's Memory switch — the conversation's own value when it has one. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useChatMemorySwitch } from '@seanhogg/builderforce-brain-ui';
import { brain } from '@/lib/builderforceApi';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';

const persistChatMemory = (chatId: number, on: boolean) => brain.updateChat(chatId, { memoryEnabled: on });

/** Only this hook writes the local key — nothing to subscribe to. */
function subscribeNever() {
  return () => {};
}
const localServerSnapshot = () => true;
/** Default ON; a stored '0' is the only OFF. Unreadable storage ⇒ ON. */
function readLocal(key: string): boolean {
  try { return localStorage.getItem(key) !== '0'; } catch { return true; }
}

/**
 * Whether this canvas's Brain turns recall from and contribute to the project memory.
 *
 * A canvas whose Brain is a canonical chat (`chat:<id>` on its chat object, signed-in
 * boards only) reads and writes THAT chat's `memory_enabled` — the same switch the
 * Brain panel, the editor and Rovr show for the same conversation, which is why it is
 * no longer a browser key.
 *
 * A canvas with no chat behind it (a guest's local board, or a board whose first turn
 * has not run yet) has no row to hold the choice, so it keeps a LOCAL value in this
 * browser, keyed by the session — otherwise the switch would reset on every reload of
 * a guest canvas, the same degradation the rest of the local canvas accepts.
 */
export function useCanvasMemorySwitch({ nodes, sessionId, persistence }: {
  nodes: readonly CanvasObject[];
  sessionId: string;
  persistence: 'local' | 'server';
}): { memoryEnabled: boolean; setMemoryMode: (on: boolean) => void } {
  const chatId = useMemo(() => {
    if (persistence !== 'server') return null;
    const ref = nodes.find((node) => node.data.kind === 'chat')?.data.resourceId?.match(/^chat:(\d+)$/)?.[1];
    return ref ? Number(ref) : null;
  }, [nodes, persistence]);

  // The chat's own value, tagged with the chat it was read for so a stale read never
  // stands in for the next chat's.
  const [fetched, setFetched] = useState<{ chatId: number; value: boolean } | null>(null);
  useEffect(() => {
    if (chatId == null) return;
    let live = true;
    brain.getChat(chatId)
      .then((chat) => { if (live) setFetched({ chatId, value: chat.memoryEnabled ?? true }); })
      .catch(() => { if (live) setFetched(null); });
    return () => { live = false; };
  }, [chatId]);
  const serverValue = fetched && fetched.chatId === chatId ? fetched.value : null;

  // The local value is READ (SSR renders the default, the client the stored choice); a
  // toggle this session wins, even where storage is blocked and the write fails.
  const localKey = `brain.memoryEnabled:canvas:${sessionId}`;
  const stored = useSyncExternalStore(subscribeNever, () => readLocal(localKey), localServerSnapshot);
  const [override, setOverride] = useState<{ key: string; on: boolean } | null>(null);
  const localValue = override && override.key === localKey ? override.on : stored;

  const { enabled, setEnabled } = useChatMemorySwitch({
    chatId,
    serverValue: chatId != null ? serverValue : localValue,
    persist: persistChatMemory,
  });
  const setMemoryMode = useCallback((on: boolean) => {
    setEnabled(on);
    if (chatId != null) return;
    setOverride({ key: localKey, on });
    try { localStorage.setItem(localKey, on ? '1' : '0'); } catch { /* storage may be unavailable */ }
  }, [chatId, localKey, setEnabled]);

  return { memoryEnabled: enabled, setMemoryMode };
}

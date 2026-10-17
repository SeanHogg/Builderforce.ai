import { useCallback, useEffect, useState } from 'react';

/**
 * The per-chat Memory switch, as a property of the CONVERSATION (`brain_chats.
 * memory_enabled`) rather than of a browser. It lived in localStorage under a different
 * key on each surface, so the same chat was "on" in the editor and "off" on the web, and
 * the server — and the editor's own memory tools — never knew.
 *
 * Optimistic: the switch moves on the click; a failed save puts it back.
 *
 * `serverValue` is what the host's chat record says (absent ⇒ on, the column default);
 * `persist` writes it the host's way (a PATCH on the web and in the editor, the device
 * record in Rovr). A chat that does not exist yet keeps the choice locally and the host
 * seeds the chat it creates with it.
 */
export function useChatMemorySwitch(opts: {
  chatId: number | null;
  serverValue: boolean | null | undefined;
  persist: (chatId: number, on: boolean) => Promise<unknown>;
}): { enabled: boolean; setEnabled: (on: boolean) => void } {
  const { chatId, serverValue, persist } = opts;
  const [enabled, setLocal] = useState<boolean>(serverValue ?? true);
  useEffect(() => { setLocal(serverValue ?? true); }, [chatId, serverValue]);
  const setEnabled = useCallback((on: boolean) => {
    setLocal(on);
    if (chatId == null) return;
    persist(chatId, on).catch(() => setLocal(!on));
  }, [chatId, persist]);
  return { enabled, setEnabled };
}

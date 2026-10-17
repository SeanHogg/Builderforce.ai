/**
 * Where the editor chat's own switches are remembered.
 *
 * Effort and thinking are a property of the PERSON (global, like a keyboard layout).
 * The Memory switch is NOT here: it is a property of the CONVERSATION and lives on the
 * chat's server row (`brain_chats.memory_enabled`, see `useChatMemorySwitch`), so the
 * same chat means the same thing on the web, in the editor and to the host's memory
 * tools.
 */

/**
 * Composer run-shaping switches, persisted GLOBALLY (not per chat — they are a
 * working preference, like a keyboard layout, not a property of a conversation)
 * so they survive a webview reload.
 */
export const EFFORT_KEY = 'bf_brain_effort';
export const THINKING_KEY = 'bf_brain_thinking';

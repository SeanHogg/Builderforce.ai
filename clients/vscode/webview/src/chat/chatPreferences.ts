/**
 * Where the editor chat's own switches are remembered.
 *
 * The keys are policy, so they live together: the memory switch is a property of a
 * CONVERSATION (keyed by chat id), while effort and thinking are a property of the
 * PERSON (global, like a keyboard layout). Getting that split wrong is how a
 * preference either follows you into a chat where it makes no sense or is forgotten
 * every time you switch conversations.
 */

/**
 * Per-chat memory switch storage key (parity with the web Brain's `MEMORY_KEY`).
 * '0' = off; anything else (or absent) = on. Keyed by chat id so the choice sticks
 * per chat across reloads.
 */
export const MEMORY_KEY = (chatId: number) => `bf_brain_memory:${chatId}`;

/**
 * Composer run-shaping switches, persisted GLOBALLY (not per chat — they are a
 * working preference, like a keyboard layout, not a property of a conversation)
 * so they survive a webview reload.
 */
export const EFFORT_KEY = 'bf_brain_effort';
export const THINKING_KEY = 'bf_brain_thinking';

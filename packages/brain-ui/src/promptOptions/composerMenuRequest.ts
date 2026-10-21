import { useCallback, useSyncExternalStore } from 'react';
import type { PromptOptionsOpenRequest, PromptOptionsTab } from './PromptOptionsMenu';

/**
 * Open ONE composer's `/` menu on a tab — the remedy a chat banner offers when the fix
 * lives in the menu ("Download a local model", "Pick a model" → the Model tab, where
 * on-device models are listed and downloaded and a model is picked).
 *
 * Keyed by COMPOSER ID: the banner that raised the remedy names the composer it sits
 * beside (the surface owns both and hands each the same id), so a page with two chats
 * mounted opens exactly one menu. Moved here from the web app (`openComposerModelTab`)
 * so every host — the web app and the VS Code webview — asks through the same store.
 *
 * Through brain-ui's own contract: each request bumps a token the composer hands the
 * menu as `ComposerOptions.openMenu` (`PromptOptionsMenu`'s `openOn`), and the menu opens
 * on that tab once per new token.
 */
const requests = new Map<string, PromptOptionsOpenRequest>();
const listeners = new Set<() => void>();
let lastToken = 0;

export function requestComposerMenu(composerId: string, tab: PromptOptionsTab = 'model'): void {
  lastToken += 1;
  requests.set(composerId, { tab, token: lastToken });
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The latest open request for THIS composer, for `ComposerOptions.openMenu`. */
export function useComposerMenuRequest(composerId: string | undefined): PromptOptionsOpenRequest | undefined {
  const current = useCallback(() => (composerId ? requests.get(composerId) : undefined), [composerId]);
  return useSyncExternalStore(subscribe, current, () => undefined);
}

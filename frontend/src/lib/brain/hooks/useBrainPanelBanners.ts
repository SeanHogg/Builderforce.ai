import { useCallback } from 'react';
import { useDismissibleNotice } from '@seanhogg/builderforce-brain-ui';
import type { useBrainChats, useBrainConversation } from '@/lib/brain';

/** The conversation's dismissible banners: the error banner and the provider usage-cap notice. */
export function useBrainPanelBanners({ chats, conv }: {
  chats: ReturnType<typeof useBrainChats>;
  conv: ReturnType<typeof useBrainConversation>;
}) {
  const { setError } = chats;
  const { clearError, providerCap } = conv;

  const error = chats.error || conv.error;
  // The banner surfaces either source; dismissing must clear whichever is set.
  const dismissError = useCallback(() => { setError(''); clearError(); }, [setError, clearError]);

  // Provider usage-cap banner — shown when a BYO provider's key hit its billing
  // limit this run. Keyed on the provider set so a new provider re-shows it (the
  // shared rule the editor's run notices use too).
  const { show: showProviderCapBanner, dismiss: dismissProviderCap } = useDismissibleNotice(providerCap);

  return { error, dismissError, showProviderCapBanner, dismissProviderCap };
}

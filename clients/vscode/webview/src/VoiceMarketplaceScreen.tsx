/**
 * VoiceMarketplaceScreen — the VS Code sidebar host of the shared <VoiceMarketplace>
 * (the SAME component the web mounts at `/marketplace/voices`: one browse-and-add
 * surface, two hosts). The component talks to the API through the web app's client,
 * which reads its bearer from `setEmbedAuth()`; this screen only hands it the
 * host-minted tenant token (again on every re-mint) and the editor's language
 * catalog. Theme tokens come from the shared stylesheet's `--vscode-*` mapping.
 */
import { useEffect, useState } from 'react';
import { IntlProvider } from 'use-intl';
import { VoiceMarketplace } from '@/components/voice/VoiceMarketplace';
import { setEmbedAuth } from '@/lib/auth';
import { canvasMessages } from './canvas/CanvasScreenProviders';
import { installCanvasHost } from './canvas/hostActions';
import { getToken, onRefresh, onTokenChange, type InitData } from './vscodeBridge';

export function VoiceMarketplaceScreen({ init }: { init: InitData }) {
  const { locale, messages } = canvasMessages(init);
  // The token must be in place before the component's first fetch (it fires on mount).
  useState(() => { setEmbedAuth(getToken()); });
  // Bumped by the view's title-bar refresh action; remounting reloads the listing.
  const [refreshSignal, setRefreshSignal] = useState(0);

  // The host port: "Buy" hands the web checkout to the editor (external browser) and
  // the return link is built against the public web origin, not `vscode-webview://`.
  useEffect(() => {
    installCanvasHost(init.labels, init.webOrigin ?? 'https://builderforce.ai', init.extensionVersion ?? null);
  }, [init.labels, init.webOrigin, init.extensionVersion]);
  useEffect(() => onTokenChange(() => setEmbedAuth(getToken())), []);
  useEffect(() => onRefresh(() => setRefreshSignal((n) => n + 1)), []);

  return (
    <IntlProvider locale={locale} messages={messages} getMessageFallback={({ key }) => key}>
      <div className="bf-scroll-screen">
        <VoiceMarketplace key={refreshSignal} />
      </div>
    </IntlProvider>
  );
}

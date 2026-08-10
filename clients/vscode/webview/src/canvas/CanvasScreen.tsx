import { useEffect, useState } from 'react';
import { IntlProvider } from 'use-intl';
import catalogs from 'virtual:bf-canvas-messages';
import { CreationCanvas } from '@/components/creation-canvas/CreationCanvas';
import { ToastProvider } from '@/components/ToastProvider';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { setEmbedAuth } from '@/lib/auth';
import { getToken, onInit, onTokenChange, post, type InitData } from '../vscodeBridge';
import { installCanvasHost } from './hostActions';

/**
 * The Creation Canvas screen — the thin transport wrapper around the SHARED
 * `<CreationCanvas>`, exactly as `<Project360Screen>` wraps `<Project360View>`.
 *
 * It does four things and then gets out of the way:
 *
 *   1. hands the host-minted tenant JWT to `setEmbedAuth()`, the override
 *      `auth.ts` already exposes for embedded surfaces, so the ~250 modules that
 *      call the API client authenticate with no change;
 *   2. installs the editor host port, which is what makes the capture actions
 *      appear and routes navigation through VS Code;
 *   3. mirrors the editor's colour theme onto `<html data-theme>`, the switch the
 *      canvas stylesheet already uses to pick its light palette;
 *   4. mounts the providers the canvas expects at the app root on the web
 *      (`useConfirm` throws without one) and the locale catalogs.
 *
 * Everything visible after that — the board, the palette, the inspector, the
 * Brain dock, the 3D view, the workflow editor, the adapter studio — is the web
 * component, unmodified.
 */
export function CanvasScreen({ init }: { init: InitData }) {
  const session = init.session;
  const locale = pickLocale(init.labels['canvas.locale']);
  const messages = catalogs[locale] ?? catalogs.en;

  // Before first paint: the API client reads the token synchronously at call
  // time, and the canvas fires its first fetch on mount.
  const [tokenReady, setTokenReady] = useState(() => {
    setEmbedAuth(getToken());
    return getToken() != null;
  });

  useEffect(() => onTokenChange(() => {
    setEmbedAuth(getToken());
    setTokenReady(getToken() != null);
  }), []);

  useEffect(() => {
    installCanvasHost(init.labels, session?.webOrigin ?? 'https://builderforce.ai');
  }, [init.labels, session?.webOrigin]);

  // The canvas declares BOTH themes and treats dark as the default, opting into
  // light via `html[data-theme='light']` — so this is the whole theme bridge.
  useEffect(() => {
    document.documentElement.dataset.theme = init.colorTheme === 'light' ? 'light' : 'dark';
  }, [init.colorTheme]);

  useEffect(() => {
    if (session?.title) document.title = session.title;
  }, [session?.title]);

  if (!session) {
    return <div className="bf-center">{init.labels['canvas.noSession'] ?? 'No Creation Session is open.'}</div>;
  }
  if (!tokenReady) {
    return <div className="bf-center">{init.labels['canvas.connecting'] ?? 'Connecting…'}</div>;
  }

  return (
    <IntlProvider
      locale={locale}
      messages={messages}
      // A missing key must not blank the board: `use-intl` throws on lookup
      // failure by default, and one stale key would take the whole canvas down
      // inside an editor panel where there is no reload button.
      onError={(error) => post('canvas.i18nError', { message: String(error) })}
      getMessageFallback={({ key }) => key}
    >
      <ToastProvider>
        <ConfirmProvider>
          <CreationCanvas sessionId={session.id} persistence="server" />
        </ConfirmProvider>
      </ToastProvider>
    </IntlProvider>
  );
}

const LOCALES = ['en', 'zh', 'es', 'fr', 'de'] as const;
type CanvasLocale = (typeof LOCALES)[number];

/** Map VS Code's display language (`zh-cn`, `pt-br`, …) onto a shipped catalog. */
function pickLocale(value: string | undefined): CanvasLocale {
  const base = (value ?? 'en').toLowerCase().split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(base) ? (base as CanvasLocale) : 'en';
}

/** Root: wait for the host's init frame, then mount the canvas. */
export function CanvasApp() {
  const [init, setInit] = useState<InitData | null>(null);
  useEffect(() => onInit(setInit), []);

  if (!init) return <div className="bf-center">Connecting…</div>;
  if (!init.signedIn) {
    return (
      <div className="bf-center">
        <p>{init.labels['app.signInPrompt'] ?? 'Sign in to BuilderForce to start.'}</p>
        <button className="bf-btn bf-btn--primary" onClick={() => post('signin')}>
          {init.labels['app.signIn'] ?? 'Sign in'}
        </button>
      </div>
    );
  }
  return <CanvasScreen init={init} />;
}

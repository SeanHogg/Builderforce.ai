/**
 * EVERYTHING A BOARD NEEDS AROUND IT — one stack, for every screen that draws one.
 *
 * `CreationCanvas` reads translations (`useTranslations`), the Brain runtime (its
 * composer, run activity and object bodies), toasts, confirms, the editor's host
 * actions and the theme. The workspace screen provided all of that; the visualization
 * screen mounted the SAME canvas with none of it, and the first `useTranslations`
 * threw "No intl context" — "The board could not be drawn." on every open. Two mount
 * sites with two hand-built stacks is how that happens, so there is now one.
 *
 * The Brain provider wraps the WHOLE screen rather than the chat surface alone: the
 * run store it configures is global (a run started here keeps going while you work on
 * the board, and the cross-chat indicator reads every one of them), so scoping it to a
 * surface would tear the runtime down every time somebody looked at their board.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import catalogs from 'virtual:bf-canvas-messages';
import { BrainProvider, localTransport, type BrainConfig, type BrainTransport } from '@seanhogg/builderforce-brain-embedded';
import { ToastProvider } from '@/components/ToastProvider';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { getToken, hostFetch, onHostMessage, post, refreshToken, type InitData } from '../vscodeBridge';
import { installCanvasHost } from './hostActions';
import { createHostPersistence } from '../hostPersistence';
import { installHostRunDriver } from '../hostRunDriver';
import { buildIdeSystemPrompt } from '../systemPrompt';
import { webviewLocalFetch } from '../pageEngines';

const LOCALES = ['en', 'zh', 'es', 'fr', 'de'] as const;
type CanvasLocale = (typeof LOCALES)[number];

/** Map VS Code's display language (`zh-cn`, `pt-br`, …) onto a shipped catalog. */
function pickLocale(value: string | undefined): CanvasLocale {
  const base = (value ?? 'en').toLowerCase().split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(base) ? (base as CanvasLocale) : 'en';
}

/** The canvas's message catalog for this editor's language. */
export function canvasMessages(init: InitData) {
  const locale = pickLocale(init.labels['canvas.locale']);
  return { locale, messages: catalogs[locale] ?? catalogs.en };
}

export function CanvasScreenProviders({ init, children }: { init: InitData; children: ReactNode }) {
  const session = init.session;
  const { locale, messages } = canvasMessages(init);

  useEffect(() => {
    installCanvasHost(
      init.labels,
      session?.webOrigin ?? 'https://builderforce.ai',
      init.extensionVersion ?? null,
    );
  }, [init.labels, session?.webOrigin, init.extensionVersion]);

  // The canvas declares BOTH themes and treats dark as the default, opting into light
  // via `html[data-theme='light']` — so this is the whole theme bridge.
  useEffect(() => {
    document.documentElement.dataset.theme = init.colorTheme === 'light' ? 'light' : 'dark';
  }, [init.colorTheme]);

  useEffect(() => {
    if (session?.title) document.title = session.title;
  }, [session?.title]);

  return (
    <IntlProvider
      locale={locale}
      messages={messages}
      // A missing key must not blank the board: `use-intl` throws on lookup failure by
      // default, and one stale key would take the whole canvas down inside an editor
      // panel where there is no reload button.
      onError={(error) => post('canvas.i18nError', { message: String(error) })}
      getMessageFallback={({ key }) => key}
    >
      <ChatRuntimeProvider init={init}>
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </ChatRuntimeProvider>
    </IntlProvider>
  );
}

/**
 * The Brain RUNTIME: the transport that streams a turn, the store the transcript is
 * kept in, and the driver that hands the agent loop to the extension host.
 *
 * It is a provider around the whole screen rather than state inside the chat surface
 * because a run outlives the surface being looked at — that is the property the
 * editor exists for.
 */
function ChatRuntimeProvider({ init, children }: { init: InitData; children: ReactNode }) {
  // The extension host owns the durable local application store; panel visibility never
  // decides whether history survives. ONE adapter for the life of the panel: it holds the
  // attachment preview URLs, so rebuilding it on a token re-mint or grounding refresh
  // would blank every image already in the conversation.
  const [persistence] = useState(createHostPersistence);

  // The gateway, as a transport. It funds two DIFFERENT jobs: streaming a turn when no
  // on-device model is pinned, and serving the platform tool catalogue always. Built
  // once so those two uses cannot drift to different URLs or auth.
  const gatewayTransport = useMemo<BrainTransport>(
    () => ({
      baseUrl: init.baseUrl,
      getToken,
      onUnauthorized: () => void refreshToken(),
      defaultModel: init.model,
    }),
    [init.baseUrl, init.model],
  );

  const config = useMemo<BrainConfig>(
    () => ({
      // Two transports, one streamer. An on-device route points at the runtime on this
      // machine, sends no bearer token (it has no account), and performs its request
      // through the HOST — the webview cannot open a plain-HTTP localhost connection
      // itself. Everything else is unchanged, so the agent loop and tool-call protocol
      // are identical either way.
      //
      // All chat history is host-local first; account synchronization is a separate
      // permissioned batch job, not a different persistence implementation.
      transport: init.localRoute
        ? { ...localTransport({ baseUrl: init.localRoute.baseUrl }, webviewLocalFetch(hostFetch)), defaultModel: init.localRoute.model }
        : gatewayTransport,
      persistence,
      resolveSystemPrompt: () => buildIdeSystemPrompt({ hasWorkspace: init.hasWorkspace, grounding: init.grounding }),
      // `builderforce.images.*` — how an attached picture is scaled and re-encoded.
      ...(init.images ? { imagePrep: init.images } : {}),
    }),
    [init.baseUrl, init.model, init.hasWorkspace, init.grounding, init.localRoute, init.images, gatewayTransport, persistence],
  );

  return (
    <BrainProvider config={config}>
      <HostRunBridge />
      {children}
    </BrainProvider>
  );
}

/**
 * Runs execute in the EXTENSION HOST, not in this webview (see `hostRunDriver.ts`):
 * closing or switching away from the tab no longer ends the agent's work. The host
 * owns the tools — the local file tools AND the shared gateway platform catalog, the
 * same list the native chat participant uses — so this panel registers none. What it
 * still does is refresh in-webview views (the chat↔ticket panel) after a platform
 * write, off the host's `run.tool` announcement, mirroring the web app's event bus.
 */
function HostRunBridge() {
  useEffect(() => {
    const uninstall = installHostRunDriver();
    const offTool = onHostMessage<{ name: string; mutating: boolean; remote: boolean; ok: boolean }>('run.tool', (m) => {
      if (m.remote && m.mutating && m.ok) {
        window.dispatchEvent(new CustomEvent('bf:mcp-write', { detail: { name: m.name } }));
      }
    });
    return () => {
      offTool();
      uninstall();
    };
  }, []);
  return null;
}

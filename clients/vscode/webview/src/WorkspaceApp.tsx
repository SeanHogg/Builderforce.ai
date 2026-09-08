/**
 * THE BUILDERFORCE WEBVIEW — one screen, whichever surface you are on.
 *
 * ── WHAT THIS REPLACES ───────────────────────────────────────────────────────────
 * There used to be two roots, in two bundles, behind two panels and two commands: a
 * hand-rolled chat app and a Creation Canvas. Opening one meant leaving the other,
 * and the editor was asserting a distinction the product does not make — chat is the
 * canvas's zero-object SURFACE (`frontend/src/lib/canvasSurfaces.ts`), not a separate
 * kind of place. `builderforce.openChat` and `builderforce.openCreateCanvas` now
 * reveal the SAME panel and differ only in which surface it opens at.
 *
 * ── THE ONE THING THE EDITOR IMPLEMENTS ITSELF ───────────────────────────────────
 * `hostSurfaces={{ chat: … }}`. Everything else on screen — the board, the surface
 * switcher, the session, the palette, the 3D view, the inspector — is the web
 * canvas, unmodified, exactly as it was before. Chat is the editor's own because its
 * runs execute in the EXTENSION HOST (`src/brainRunHost.ts`) so they survive the tab
 * closing and their tools reach the real workspace; see `chat/VsCodeChatSurface.tsx`.
 *
 * ── WHAT STAYED A SCREEN ─────────────────────────────────────────────────────────
 * Project 360, the list-shaped project pages and Evermind are not surfaces of a
 * board — they are separate destinations the host opens in a panel of their own, and
 * they read their data directly with no Brain providers. They keep their `init.view`
 * routing unchanged.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { IntlProvider } from 'use-intl';
import catalogs from 'virtual:bf-canvas-messages';
import { BrainProvider, type BrainConfig, type BrainPersistenceAdapter, type BrainTransport } from '@seanhogg/builderforce-brain-embedded';
import { CreationCanvas } from '@/components/creation-canvas/CreationCanvas';
import { ToastProvider } from '@/components/ToastProvider';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { setEmbedAuth } from '@/lib/auth';
import { sanitizeCanvasSurface } from '@/lib/canvasSurfaces';
import { getToken, hostFetch, onInit, onTokenChange, post, refreshToken, type InitData } from './vscodeBridge';
import { installCanvasHost } from './canvas/hostActions';
import { invalidateModelSurface } from './modelOptions';
import { createPersistence } from './persistence';
import { createInMemoryPersistence } from './localPersistence';
import { installHostRunDriver } from './hostRunDriver';
import { buildIdeSystemPrompt } from './systemPrompt';
import { rewriteToLocalUrl } from '../../src/localModels';
import { onHostMessage } from './vscodeBridge';
import { makeT } from './chat/chatLabels';
import { VsCodeChatSurface } from './chat/VsCodeChatSurface';
import { Project360Screen } from './Project360Screen';
import { ProjectPageScreen } from './ProjectPageScreen';
import { EvermindScreen } from './EvermindScreen';

const LOCALES = ['en', 'zh', 'es', 'fr', 'de'] as const;
type CanvasLocale = (typeof LOCALES)[number];

/** Map VS Code's display language (`zh-cn`, `pt-br`, …) onto a shipped catalog. */
function pickLocale(value: string | undefined): CanvasLocale {
  const base = (value ?? 'en').toLowerCase().split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(base) ? (base as CanvasLocale) : 'en';
}

/** Root: wait for the host's init frame, then mount the screen it asked for. */
export function WorkspaceApp() {
  const [init, setInit] = useState<InitData | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const offInit = onInit(setInit);
    // A re-mint can be a different tenant (sign-out/in, workspace switch), and model
    // entitlements are per tenant — drop the cached surface so the `/` menu never
    // offers the previous tenant's models.
    const offToken = onTokenChange(() => { invalidateModelSurface(); force((n) => n + 1); });
    return () => { offInit(); offToken(); };
  }, []);

  if (!init) return <div className="bf-center">Connecting…</div>;

  const t = makeT(init.labels);
  // An on-device route needs no account — refusing to render would be gating the user
  // out of their own hardware. The chat then runs on a session-local store (see
  // `createInMemoryPersistence`), because the run loop persists the user turn BEFORE
  // it streams: left on the gateway adapter, that write 401s and the model is never
  // reached. Other gateway-backed extras degrade on their own.
  if ((!init.signedIn || !getToken()) && !init.localRoute) {
    return (
      <div className="bf-center">
        <p>{t('app.signInPrompt', 'Sign in to BuilderForce to start.')}</p>
        <button className="bf-btn bf-btn--primary" onClick={() => post('signin')}>
          {t('app.signIn', 'Sign in')}
        </button>
      </div>
    );
  }

  // The destinations that are not a board. Same bundle, same transport, no Brain
  // providers — they fetch their own data, exactly as they did before the merge.
  if (init.view === 'project360') return <Project360Screen init={init} />;
  if (init.view === 'evermind') return <EvermindScreen init={init} />;
  if (init.view === 'backlog' || init.view === 'prd' || init.view === 'roadmap' || init.view === 'retros' || init.view === 'poker') {
    return <ProjectPageScreen init={init} view={init.view} />;
  }
  return <WorkspaceScreen init={init} />;
}

/**
 * The canvas, with the editor's chat as one of its surfaces.
 *
 * The Brain providers wrap the WHOLE screen rather than the chat surface alone: the
 * run store they configure is global (a run started here keeps going while you work
 * on the board, and the cross-chat indicator reads every one of them), so scoping
 * them to the surface would tear the runtime down every time somebody looked at their
 * board.
 */
function WorkspaceScreen({ init }: { init: InitData }) {
  const session = init.session;
  const locale = pickLocale(init.labels['canvas.locale']);
  const messages = catalogs[locale] ?? catalogs.en;

  // Before first paint: the API client reads the token synchronously at call time,
  // and the canvas fires its first fetch on mount.
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

  // The canvas declares BOTH themes and treats dark as the default, opting into light
  // via `html[data-theme='light']` — so this is the whole theme bridge.
  useEffect(() => {
    document.documentElement.dataset.theme = init.colorTheme === 'light' ? 'light' : 'dark';
  }, [init.colorTheme]);

  useEffect(() => {
    if (session?.title) document.title = session.title;
  }, [session?.title]);

  if (!session) {
    return <div className="bf-center">{init.labels['canvas.noSession'] ?? 'No Creation Session is open.'}</div>;
  }
  // A local route runs on this machine with no account, so it has no tenant token to
  // wait for — holding the whole screen on one would gate the user out of their own
  // hardware, which is the case the sign-in gate above deliberately lets through.
  if (!tokenReady && !init.localRoute) {
    return <div className="bf-center">{init.labels['canvas.connecting'] ?? 'Connecting…'}</div>;
  }

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
          <ConfirmProvider>
            <CreationCanvas
              sessionId={session.id}
              // A board with no account behind it cannot be written to the gateway —
              // every read would 401 — so it persists in this panel, exactly as the
              // signed-out chat transcript already did.
              persistence={session.durable === false ? 'local' : 'server'}
              initialSurface={sanitizeCanvasSurface(init.surface)}
              hostSurfaces={{ chat: <VsCodeChatSurface init={init} /> }}
            />
          </ConfirmProvider>
        </ToastProvider>
      </ChatRuntimeProvider>
    </IntlProvider>
  );
}

/**
 * The chat surface's RUNTIME: the transport that streams a turn, the store the
 * transcript is kept in, and the driver that hands the agent loop to the extension
 * host.
 *
 * It is a provider around the whole screen rather than state inside the chat surface
 * because a run outlives the surface being looked at — that is the property the
 * editor exists for.
 */
function ChatRuntimeProvider({ init, children }: { init: InitData; children: React.ReactNode }) {
  // The panel only renders signed out on an on-device route, and that conversation has
  // nowhere durable to go. Hold ONE session store for the life of the panel so
  // re-rendering — a token re-mint, a grounding refresh — does not silently start a
  // new empty chat under the user.
  const signedOut = !init.signedIn || !getToken();
  const memoryRef = useRef<BrainPersistenceAdapter | null>(null);
  const memoryStore = (t: (key: string, fallback: string) => string): BrainPersistenceAdapter => {
    memoryRef.current ??= createInMemoryPersistence({
      summarizeUnavailable: t(
        'app.summarizeNeedsAccount',
        'Summarizing a chat needs a BuilderForce account. This conversation is only on this machine.',
      ),
    });
    return memoryRef.current;
  };

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
      // Persistence stays on the gateway for a SIGNED-IN local turn: the transcript,
      // its project links and the audit trail are platform records, and the model that
      // produced the text has no bearing on where the text is kept. Signed out there is
      // no account to keep it in, so the conversation lives in this panel and nowhere
      // else — and is gone when it closes.
      transport: init.localRoute
        ? {
            baseUrl: init.localRoute.baseUrl,
            getToken: () => null,
            defaultModel: init.localRoute.model,
            fetch: (input: string, requestInit: RequestInit) => hostFetch(rewriteToLocalUrl(input), requestInit),
          }
        : gatewayTransport,
      persistence: signedOut
        ? memoryStore(makeT(init.labels))
        : createPersistence(init.baseUrl, getToken, () => void refreshToken()),
      resolveSystemPrompt: () => buildIdeSystemPrompt({ hasWorkspace: init.hasWorkspace, grounding: init.grounding }),
    }),
    [init.baseUrl, init.model, init.hasWorkspace, init.grounding, init.localRoute, signedOut, gatewayTransport],
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

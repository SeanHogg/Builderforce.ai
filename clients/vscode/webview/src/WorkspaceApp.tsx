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

import { useCallback, useEffect, useState } from 'react';
import { IntlProvider } from 'use-intl';
import { CreationCanvas } from '@/components/creation-canvas/CreationCanvas';
import { sanitizeCanvasSurface } from '@/lib/canvasSurfaces';
import { getToken, onInit, onTokenChange, post, refreshToken, type InitData } from './vscodeBridge';
import { useBoardAuth } from './canvas/useBoardAuth';
import { BoardAuthNotice } from './canvas/BoardAuthNotice';
import { invalidateGatewayModelOptions } from '@seanhogg/builderforce-brain-embedded';
import { CanvasBoundary } from './CanvasBoundary';
import { HostScopeProviders } from './canvas/HostScopeProviders';
import { CanvasScreenProviders, canvasMessages } from './canvas/CanvasScreenProviders';
import { makeT } from './chat/chatLabels';
import { VsCodeChatSurface } from './chat/VsCodeChatSurface';
import { Project360Screen } from './Project360Screen';
import { ProjectPageScreen } from './ProjectPageScreen';
import { EvermindScreen } from './EvermindScreen';
import { VisualizationPanel } from './visualization/VisualizationPanel';
import { usePendingDiff } from './visualization/usePendingDiff';
import { CodeAuditVisualizer } from '@/components/tools/CodeAuditVisualizer';

/** Root: wait for the host's init frame, then mount the screen it asked for. */
export function WorkspaceApp() {
  const [init, setInit] = useState<InitData | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const offInit = onInit(setInit);
    // A re-mint can be a different tenant (sign-out/in, workspace switch), and model
    // entitlements are per tenant — drop the cached surface so the `/` menu never
    // offers the previous tenant's models.
    const offToken = onTokenChange(() => { invalidateGatewayModelOptions(); force((n) => n + 1); });
    return () => { offInit(); offToken(); };
  }, []);

  // Host said we are signed in but the tenant JWT has not landed yet (post-login
  // init race, or a refresh mid-flight). Ask for a mint instead of showing the
  // sign-in wall — that wall contradicted the host's "BuilderForce: signed in."
  // toast and left Evermind looking logged out until a manual reload. A mint that
  // comes back empty is a gateway we cannot reach (a REFUSED key signs the host out,
  // which arrives as a new init) — say so and offer Retry, never spin forever.
  const [tokenFailed, setTokenFailed] = useState(false);
  const mintToken = useCallback(async () => {
    setTokenFailed(false);
    await refreshToken();
    if (!getToken()) setTokenFailed(true);
  }, []);
  // A pinned on-device model skips this gate's mint; a board that needs the gateway
  // mints for itself (`useBoardAuth`).
  useEffect(() => {
    if (!init?.signedIn || init.localRoute) return;
    if (init.token || getToken()) {
      setTokenFailed(false);
      return;
    }
    void mintToken();
  }, [init, mintToken]);

  // No label bundle before the first init frame: the host stamps this one line on the
  // root element (`renderBundleShell`'s `bootLabel`) so even the boot screen is localized.
  if (!init) return <div className="bf-center">{document.getElementById('root')?.dataset.bootLabel || 'Connecting…'}</div>;

  const t = makeT(init.labels);
  // Token presence: prefer the init frame (React state) and fall back to the live
  // module token (updated by `token` / `token.refresh` without a new init).
  const hasToken = !!(init.token || getToken());
  // An on-device route needs no account — refusing to render would be gating the user
  // out of their own hardware. Chat history is written to the extension host's local
  // store (`createHostPersistence`) signed in or out, so the run loop's write of the user
  // turn BEFORE it streams never needs an account. Other gateway-backed extras degrade
  // on their own.
  //
  // Only `!signedIn` is the sign-in wall. `signedIn && !hasToken` is a transient
  // (Connecting… + refreshToken above), NOT another prompt to sign in — conflating
  // them was the Evermind "Sign in" / status "signed in" mismatch.
  if (!init.signedIn && !init.localRoute) {
    return (
      <div className="bf-center">
        <p>{t('app.signInPrompt', 'Sign in to BuilderForce to start.')}</p>
        <button className="bf-btn bf-btn--primary" onClick={() => post('signin')}>
          {t('app.signIn', 'Sign in')}
        </button>
      </div>
    );
  }
  if (init.signedIn && !hasToken && !init.localRoute) {
    if (!tokenFailed) return <div className="bf-center">{t('app.connecting', 'Connecting…')}</div>;
    return (
      <div className="bf-center">
        <p>{t('app.connectFailed', "Couldn't reach BuilderForce. Check your connection and try again.")}</p>
        <button className="bf-btn bf-btn--primary" onClick={() => void mintToken()}>
          {t('app.retry', 'Retry')}
        </button>
      </div>
    );
  }

  // The destinations that are not a board. Same bundle, same transport, no Brain
  // providers — they fetch their own data, exactly as they did before the merge.
  if (init.view === 'audit-result' && init.auditResult?.codeAnalysis) {
    const { locale, messages } = canvasMessages(init);
    return <IntlProvider locale={locale} messages={messages}>
      <main style={{ padding: 20 }}><CodeAuditVisualizer analysis={init.auditResult.codeAnalysis} openSource={(location, commit) => post('audit.source', { location, commit })} /></main>
    </IntlProvider>;
  }
  if (init.view === 'visualization') return <VisualizationScreen init={init} />;
  if (init.view === 'project360') return <Project360Screen init={init} />;
  if (init.view === 'evermind') return <EvermindScreen init={init} />;
  if (init.view === 'backlog' || init.view === 'prd' || init.view === 'roadmap' || init.view === 'retros' || init.view === 'poker') {
    return <ProjectPageScreen init={init} view={init.view} />;
  }
  return <WorkspaceScreen init={init} />;
}

/** The canvas, with the editor's chat as one of its surfaces. */
function WorkspaceScreen({ init }: { init: InitData }) {
  return (
    <CanvasScreenProviders init={init}>
      {/* The sidebar chat view holds the conversation only — its board opens in the
          visualization panel beside it, so nothing is drawn above the chat. */}
      {init.boardBeside ? <VsCodeChatSurface init={init} /> : <BoardWithChat init={init} />}
    </CanvasScreenProviders>
  );
}

/** The editor tab: the board, with the conversation as one of its surfaces. */
function BoardWithChat({ init }: { init: InitData }) {
  const session = init.session;
  const board = useBoardAuth(session, init.signedIn);

  /**
   * THE CHAT IS THE FLOOR — everything below decides whether a BOARD can also be
   * drawn, and none of it may take the conversation down.
   *
   * The board needs a resolved creation session and a tenant token; the conversation
   * needs neither (it runs against the extension host, and on a local route against a
   * model on this machine). These used to be early returns that replaced the whole
   * screen with a one-line message, which meant a gateway blip or an unresolved
   * session left someone staring at "No Creation Session is open." with a working
   * agent sitting behind it, unreachable.
   */
  const chat = <VsCodeChatSurface init={init} />;

  return board.state === 'ready' ? (
    <CanvasBoundary
      fallback={chat}
      notice={init.labels['canvas.degraded'] ?? 'The board could not be drawn. The conversation is still here.'}
      retryLabel={init.labels['canvas.retry'] ?? 'Try again'}
      resetKey={session!.id}
    >
      {/* Inside the boundary and the token gate: the scope providers read the
          workspace token on mount, and a failure in one still leaves the chat. */}
      <HostScopeProviders projectId={init.project?.id ?? null}>
        <CreationCanvas
          sessionId={session!.id}
          // A board with no account behind it cannot be written to the
          // gateway — every read would 401 — so it persists in this panel,
          // exactly as the signed-out chat transcript already did.
          persistence={session!.durable === false ? 'local' : 'server'}
          initialSurface={sanitizeCanvasSurface(init.surface)}
          // WRAPPED, because where the conversation sits is the canvas's
          // business and not the chat's: the same component also renders
          // standalone when no board could be drawn, and it must not carry a
          // box positioned against a board that is not there.
          hostSurfaces={{ chat: <div className="bf-canvas-chat-surface">{chat}</div> }}
        />
      </HostScopeProviders>
    </CanvasBoundary>
  ) : board.state === 'none' ? chat : (
    <div className="bf-degraded-shell">
      <BoardAuthNotice auth={board} labels={init.labels} />
      {chat}
    </div>
  );
}

/**
 * The VISUALIZATION panel — the right-hand half of the chat split (AC3/AC4/AC5).
 *
 * Same bundle, same transport, same init frame as the chat panel (the host hosts the
 * same `WorkspaceSurface`; only `init.view` differs), and the SAME provider stack
 * (`CanvasScreenProviders`) — the board mounted outside it is what failed to draw.
 * Nothing here re-implements the canvas: the SAME `CreationCanvas` is mounted with the
 * SAME props `WorkspaceScreen` gives it, and the panel receives it as `children` so
 * there is exactly one canvas on screen and no second copy to drift.
 *
 * The difference is what surrounds it. `WorkspaceScreen` passes the conversation
 * as a canvas `hostSurface` — the chat behind the board. This panel passes none:
 * the conversation stays in the LEFT panel (AC2), and this one is the board plus
 * the run's changes. That is the whole split.
 *
 * The panel itself owns the canvas⇄changes toggle and the run-frame subscription
 * (`VisualizationPanel` subscribes to `run.tool` / `run.sync` / `run.settled`
 * itself and reads the pending working tree off the shared bridge), so this
 * screen has no run state to thread.
 */
function VisualizationScreen({ init }: { init: InitData }) {
  const session = init.session;
  const board = useBoardAuth(session, init.signedIn);
  const diff = usePendingDiff();

  // The boundary wraps the CANVAS, not the panel: a board that fails to draw leaves
  // the toggle and the change tree working, which is exactly what the tree is for.
  // The boundary prints the notice and Try again itself, so its fallback is empty
  // rather than a second copy of the same sentence.
  const canvas = session && board.state === 'ready' ? (
    <CanvasBoundary
      fallback={null}
      notice={init.labels['canvas.degraded'] ?? 'The board could not be drawn.'}
      retryLabel={init.labels['canvas.retry'] ?? 'Try again'}
      resetKey={session.id}
    >
      <HostScopeProviders projectId={init.project?.id ?? null}>
        <CreationCanvas
          sessionId={session.id}
          // A board with no account behind it cannot be written to the gateway —
          // every read would 401 — so it persists in this panel.
          persistence={session.durable === false ? 'local' : 'server'}
          initialSurface={sanitizeCanvasSurface(init.surface)}
          // NO hostSurfaces: the chat is not drawn here. The panel owns the frame.
          hostSurfaces={{}}
        />
      </HostScopeProviders>
    </CanvasBoundary>
  ) : <BoardAuthNotice auth={board} labels={init.labels} />;

  return (
    <CanvasScreenProviders init={init}>
      {/* No `chatId`: the visualization frame names no chat, so every run drives the
          canvas/changes swap. */}
      <VisualizationPanel labels={init.labels} diffText={diff}>
        {canvas}
      </VisualizationPanel>
    </CanvasScreenProviders>
  );
}

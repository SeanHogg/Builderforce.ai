/**
 * The global Brain: a floating icon (bottom-right) that opens a docked
 * slide-out drawer hosting the shared <BrainPanel>. Mounted once, app-wide, by
 * ConditionalAppShell. Hidden where Brain is already the primary surface.
 *
 * It reads ambient page context (active project, modality, open-file system
 * context) from BrainContext, so the IDE (and any page) can steer the Brain
 * without prop-drilling.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BrainPanel } from './BrainPanel';
import { GuestBrainPanel } from './GuestBrainPanel';
import { MigrationPanelHost } from '@/components/integrations/MigrationPanelHost';
import { useBrainContext, takePendingPrompt } from '@/lib/brain';
import { useInlineBrainMounted } from '@/lib/brain/inlineBrainHost';
import { pendingPromptsApi } from '@/lib/builderforceApi';
import { useAttention } from '@/lib/useAttention';
import { useAuth } from '@/lib/AuthContext';
import { useModalDismiss } from '@/hooks/useModalDismiss';
import { lensForRoute } from '@/lib/canvasLens';
import { SurfaceLauncher } from '@seanhogg/builderforce-brain-ui';

export function FloatingBrain() {
  const pathname = usePathname();
  const tAttn = useTranslations('attention');
  const tLauncher = useTranslations('brainLauncher');
  const { hasTenant } = useAuth();
  const { open, setOpen, projectId, viewingProjectId, modality, extraSystem, initialChatId, initialPrompt: ctxInitialPrompt, initialTicket } = useBrainContext();
  // Tenant-wide "needs you" signal for the launcher badge — only while the drawer
  // is closed (when open, BrainPanel's own useAttention drives the chat-row dots,
  // so we never run two pollers at once).
  const { counts } = useAttention(undefined, hasTenant && !open);
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>(undefined);
  // A page that docks the Brain in its own layout (Studio / IDE column, project details)
  // already shows this conversation; a corner button opening a second copy of it beside
  // the first is noise. The drawer still opens when something asks for it (a seeded
  // prompt, a deep link) — only the launcher stands down.
  const inlineBrainMounted = useInlineBrainMounted();
  // A page-published seed (e.g. the IDE `?prompt=`) wins over the sign-in handoff.
  const initialPrompt = ctxInitialPrompt ?? pendingPrompt;

  // Cross-device handoff: a signup/verify link carries the FIRST device's anon id
  // as `?aid=` (appended by the auth emails). Adopt it into this browser's storage
  // BEFORE the pending-prompt `claim` below runs, so a prompt typed on the phone is
  // claimed by the laptop that opened the email. Runs once, synchronously on mount,
  // ahead of the claim effect. [1517]
  useEffect(() => {
    try {
      const aid = new URLSearchParams(window.location.search).get('aid');
      if (aid) pendingPromptsApi.setAnonId(aid);
    } catch { /* no-op if URL/storage is unavailable */ }
  }, []);

  // A page that publishes an initialPrompt OR an auto-link ticket into the Brain
  // context wants the drawer open so BrainPanel can act on it.
  useEffect(() => {
    if (ctxInitialPrompt || initialTicket) setOpen(true);
  }, [ctxInitialPrompt, initialTicket, setOpen]);

  // Lock background scroll + close on Escape while the drawer is open. Shared
  // with the marketing mobile menu so every overlay dismisses the same way.
  useModalDismiss(open, () => setOpen(false));

  // A prompt typed on the landing page before sign-in is replayed here once the
  // user is back inside the authenticated shell: open the drawer and let
  // BrainPanel auto-send it. takePendingPrompt reads AND clears storage, so it
  // MUST only run once the user is authenticated — otherwise the launcher (now
  // mounted on marketing pages too) would consume the saved prompt before the
  // visitor ever signs in, breaking the landing→auth→replay handoff.
  //
  // ONCE per signed-in mount: the handoff is a one-shot, so re-running the local
  // take + the server `claim` POST on every client navigation was a request per
  // page view for nothing. `pathname` stays a dependency only so a session that
  // LANDS on /brainstorm (which skips the claim) still claims on the first page
  // after it; signing out re-arms it for the next sign-in.
  const handoffClaimedRef = useRef(false);
  // The claim CONSUMES the server record, so its answer must land even if the
  // person navigates while it is in flight — only an unmount drops it.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (!hasTenant) { handoffClaimedRef.current = false; return; }
    if (handoffClaimedRef.current) return;
    // On /brainstorm the docked Brain renders null (the page IS the Brain), so
    // it must NOT consume the one-shot pending prompt here — `takePendingPrompt`
    // clears storage, which would silently eat the prompt before the page can
    // replay it. The brainstorm page consumes it instead. [1509]
    if (pathname?.startsWith('/brainstorm')) return;
    handoffClaimedRef.current = true;
    const p = takePendingPrompt();
    if (p) {
      setPendingPrompt(p);
      setOpen(true);
      return;
    }
    // Same-browser miss → try the durable server record (cross-device handoff,
    // e.g. typed on phone, signed up on laptop). Best-effort. [1517]
    void pendingPromptsApi.claim().then((serverPrompt) => {
      if (mountedRef.current && serverPrompt) {
        setPendingPrompt(serverPrompt);
        setOpen(true);
      }
    });
  }, [hasTenant, setOpen, pathname]);

  // Brainstorm and Creation Sessions already provide a first-class Brain conversation;
  // mounting a second launcher there splits context and creates two competing chats.
  // pages a "sign in to use Brain" CTA would be redundant with the form itself.
  if (pathname?.startsWith('/brainstorm')) return null;
  // A board through EITHER lens — `/create/<id>` or Studio's `/studio/<id>` (`lib/canvasLens.ts`).
  if (pathname === '/create' || (pathname && lensForRoute(pathname))) return null;
  if (pathname === '/login' || pathname === '/register') return null;
  // Embedded surfaces render bare inside a host iframe — no floating chrome.
  if (pathname?.startsWith('/embed')) return null;

  return (
    <>
      {/* Brain-driven migration / reconciliation panel (opens on the LEFT). */}
      <MigrationPanelHost />

      {/* Floating launcher */}
      {!open && !inlineBrainMounted && (
        <>
          {/* A turn in flight is the MARK's animation, not a badge, so it survives the
              count: a Brain both awaiting an answer and running reads as both. */}
          <SurfaceLauncher
            className="brain-launcher"
            onOpen={() => setOpen(true)}
            running={counts.running > 0}
            label={counts.running > 0 ? tAttn('runningCount', { count: counts.running }) : tLauncher('open')}
            badge={counts.awaiting > 0
              ? { count: counts.awaiting, tone: 'awaiting', label: tAttn('needsYou', { count: counts.awaiting }) }
              : counts.unread > 0
                ? { count: counts.unread, tone: 'unread', label: tAttn('unread', { count: counts.unread }) }
                : null}
          />
          <style>{`
            .brain-launcher {
              position: fixed;
              right: 20px;
              bottom: 20px;
              z-index: 9990;
              width: 56px;
              height: 56px;
              border-radius: 50%;
              border: none;
              cursor: pointer;
              background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark));
              color: var(--text-on-accent);
              box-shadow: 0 8px 24px rgba(0,0,0,0.35);
              font-size: var(--font-size-section);
              display: flex;
              align-items: center;
              justify-content: center;
            }
            /* The mobile bottom nav is a fixed 56px bar (shown <768px). Lift the
               launcher above it so it never covers the menu, and clear the iOS
               safe-area inset the nav also accounts for. */
            @media (max-width: 767px) {
              .brain-launcher {
                bottom: calc(56px + 16px + env(safe-area-inset-bottom, 0px));
              }
            }
          `}</style>
        </>
      )}

      {open && (
        <>
          <div
            role="presentation"
            aria-hidden
            onClick={() => setOpen(false)}
            className="brain-drawer-backdrop"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={tLauncher('title')}
            className="brain-drawer"
          >
            {hasTenant ? (
              <BrainPanel
                variant="docked"
                pinnedProjectId={projectId}
                viewingProjectId={viewingProjectId}
                modality={modality}
                extraSystem={extraSystem}
                initialChatId={initialChatId}
                initialPrompt={initialPrompt}
                initialTicket={initialTicket}
                onClose={() => setOpen(false)}
              />
            ) : (
              // Logged-out: a real, metered guest chat (not a dead-end sign-in
              // wall) so a visitor can try the Brain before creating an account.
              <GuestBrainPanel variant="docked" initialPrompt={initialPrompt} onClose={() => setOpen(false)} />
            )}
          </div>
          <style>{`
            .brain-drawer-backdrop {
              position: fixed;
              inset: 0;
              z-index: 9998;
              background: rgba(0, 0, 0, 0.5);
            }
            .brain-drawer {
              position: fixed;
              top: 0;
              right: 0;
              bottom: 0;
              width: min(440px, 96vw);
              max-width: 100%;
              z-index: 9999;
              border-left: 1px solid var(--border-subtle);
              box-shadow: -8px 0 24px rgba(0, 0, 0, 0.2);
              display: flex;
              flex-direction: column;
              overflow: hidden;
              background: var(--bg-base);
            }
            /* On mobile the drawer goes full-screen so the close control is
               always reachable and the page can't show through / look cut off. */
            @media (max-width: 640px) {
              .brain-drawer {
                left: 0;
                right: 0;
                width: 100%;
                max-width: 100%;
                border-left: none;
              }
            }
          `}</style>
        </>
      )}
    </>
  );
}

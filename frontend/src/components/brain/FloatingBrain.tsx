'use client';

/**
 * The global Brain: a floating icon (bottom-right) that opens a docked
 * slide-out drawer hosting the shared <BrainPanel>. Mounted once, app-wide, by
 * ConditionalAppShell. Hidden on /brainstorm, where the same Brain UI is
 * already the whole page.
 *
 * It reads ambient page context (active project, modality, open-file system
 * context) from BrainContext, so the IDE (and any page) can steer the Brain
 * without prop-drilling.
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BrainPanel } from './BrainPanel';
import { GuestBrainPanel } from './GuestBrainPanel';
import { MigrationPanelHost } from '@/components/integrations/MigrationPanelHost';
import { useBrainContext, takePendingPrompt } from '@/lib/brain';
import { pendingPromptsApi } from '@/lib/builderforceApi';
import { useAttention } from '@/lib/useAttention';
import { useAuth } from '@/lib/AuthContext';
import { useModalDismiss } from '@/hooks/useModalDismiss';

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
  useEffect(() => {
    if (!hasTenant) return;
    // On /brainstorm the docked Brain renders null (the page IS the Brain), so
    // it must NOT consume the one-shot pending prompt here — `takePendingPrompt`
    // clears storage, which would silently eat the prompt before the page can
    // replay it. The brainstorm page consumes it instead. [1509]
    if (pathname?.startsWith('/brainstorm')) return;
    const p = takePendingPrompt();
    if (p) {
      setPendingPrompt(p);
      setOpen(true);
      return;
    }
    // Same-browser miss → try the durable server record (cross-device handoff,
    // e.g. typed on phone, signed up on laptop). Best-effort. [1517]
    let cancelled = false;
    void pendingPromptsApi.claim().then((serverPrompt) => {
      if (!cancelled && serverPrompt) {
        setPendingPrompt(serverPrompt);
        setOpen(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hasTenant, setOpen, pathname]);

  // On the full Brain Storm page the docked Brain is redundant; on the auth
  // pages a "sign in to use Brain" CTA would be redundant with the form itself.
  if (pathname?.startsWith('/brainstorm')) return null;
  if (pathname === '/login' || pathname === '/register') return null;
  // Embedded surfaces render bare inside a host iframe — no floating chrome.
  if (pathname?.startsWith('/embed')) return null;

  return (
    <>
      {/* Brain-driven migration / reconciliation panel (opens on the LEFT). */}
      <MigrationPanelHost />

      {/* Floating launcher */}
      {!open && (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={tLauncher('open')}
            title={tLauncher('title')}
            className="brain-launcher"
          >
            🧠
            {counts.awaiting > 0 ? (
              <span
                className="brain-launcher-badge"
                role="status"
                aria-label={tAttn('needsYou', { count: counts.awaiting })}
                title={tAttn('needsYou', { count: counts.awaiting })}
              >
                {counts.awaiting}
              </span>
            ) : counts.unread > 0 ? (
              // New messages (execution milestones / teammate turns) landed in a
              // chat you're not viewing — indigo count, distinct from the amber
              // "needs an answer" badge and the coral "running" dot.
              <span
                className="brain-launcher-badge brain-launcher-badge-unread"
                role="status"
                aria-label={tAttn('unread', { count: counts.unread })}
                title={tAttn('unread', { count: counts.unread })}
              >
                {counts.unread > 99 ? '99+' : counts.unread}
              </span>
            ) : counts.running > 0 ? (
              <span
                className="brain-launcher-dot"
                role="status"
                aria-label={tAttn('runningCount', { count: counts.running })}
                title={tAttn('runningCount', { count: counts.running })}
              />
            ) : null}
          </button>
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
              background: linear-gradient(135deg, var(--coral-bright, #f4726e), var(--coral-dark, #c2410c));
              color: #fff;
              box-shadow: 0 8px 24px rgba(0,0,0,0.35);
              font-size: 26px;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            /* "A person must answer" — amber count badge, pulsing so it's noticed
               even when the drawer is closed and you're multitasking elsewhere. */
            .brain-launcher-badge {
              position: absolute;
              top: -2px;
              right: -2px;
              min-width: 20px;
              height: 20px;
              padding: 0 5px;
              border-radius: 10px;
              background: var(--warning, #d97706);
              color: #fff;
              font-size: 11px;
              font-weight: 700;
              line-height: 20px;
              text-align: center;
              box-shadow: 0 0 0 2px var(--bg-base, #0b0b0b);
              animation: agentPulse 1.4s ease-in-out infinite;
            }
            /* "New unread messages" — indigo count, no pulse (informational, not a
               blocking ask). Distinct hue from the amber answer badge. */
            .brain-launcher-badge-unread {
              background: var(--badge-unread, #6366f1);
              animation: none;
            }
            /* Background activity (something running, nothing blocked) — a quiet
               coral dot, no count. */
            .brain-launcher-dot {
              position: absolute;
              top: 2px;
              right: 2px;
              width: 12px;
              height: 12px;
              border-radius: 50%;
              background: var(--coral-bright, #f4726e);
              box-shadow: 0 0 0 2px var(--bg-base, #0b0b0b);
              animation: agentPulse 1.4s ease-in-out infinite;
            }
            @media (prefers-reduced-motion: reduce) {
              .brain-launcher-badge, .brain-launcher-dot { animation: none; }
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

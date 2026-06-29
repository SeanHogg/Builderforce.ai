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
import Link from 'next/link';
import { BrainPanel } from './BrainPanel';
import { MigrationPanelHost } from '@/components/integrations/MigrationPanelHost';
import { useBrainContext, takePendingPrompt } from '@/lib/brain';
import { pendingPromptsApi } from '@/lib/builderforceApi';
import { useAuth } from '@/lib/AuthContext';
import { useModalDismiss } from '@/hooks/useModalDismiss';

export function FloatingBrain() {
  const pathname = usePathname();
  const { hasTenant } = useAuth();
  const { open, setOpen, projectId, viewingProjectId, modality, extraSystem, initialChatId } = useBrainContext();
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>(undefined);

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
      setInitialPrompt(p);
      setOpen(true);
      return;
    }
    // Same-browser miss → try the durable server record (cross-device handoff,
    // e.g. typed on phone, signed up on laptop). Best-effort. [1517]
    let cancelled = false;
    void pendingPromptsApi.claim().then((serverPrompt) => {
      if (!cancelled && serverPrompt) {
        setInitialPrompt(serverPrompt);
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
            aria-label="Open Brain assistant"
            title="Brain assistant"
            className="brain-launcher"
          >
            🧠
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
            aria-label="Brain assistant"
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
                onClose={() => setOpen(false)}
              />
            ) : (
              <BrainSignInCTA onClose={() => setOpen(false)} />
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

/**
 * Gated panel shown when the visitor isn't signed in (no workspace token). The
 * Brain is visible everywhere, but it can't call the gateway without auth, so
 * instead of a chat input we surface a sign-in / sign-up call to action. No
 * input means no anonymous gateway traffic.
 */
function BrainSignInCTA({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      <div
        style={{
          flexShrink: 0,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          🧠 Brain
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Brain"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 44 }}>🧠</div>
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>Meet Brain</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 280, lineHeight: 1.5 }}>
          Your AI co-builder for planning projects, generating specs, and shipping faster. Sign in to start a conversation.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <Link
            href="/login"
            style={{ padding: '10px 18px', fontSize: 14, fontWeight: 600, background: 'var(--accent, #3b82f6)', color: '#fff', borderRadius: 10, textDecoration: 'none' }}
          >
            Sign in
          </Link>
          <Link
            href="/register"
            style={{ padding: '10px 18px', fontSize: 14, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 10, textDecoration: 'none' }}
          >
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}

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

import { usePathname } from 'next/navigation';
import { BrainPanel } from './BrainPanel';
import { useBrainContext } from '@/lib/brain';

export function FloatingBrain() {
  const pathname = usePathname();
  const { open, setOpen, projectId, modality, extraSystem, initialChatId } = useBrainContext();

  // On the full Brain Storm page the docked Brain is redundant.
  if (pathname?.startsWith('/brainstorm')) return null;

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Brain assistant"
          title="Brain assistant"
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            zIndex: 9990,
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            background: 'linear-gradient(135deg, var(--coral-bright, #f4726e), var(--coral-dark, #c2410c))',
            color: '#fff',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            fontSize: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          🧠
        </button>
      )}

      {open && (
        <>
          <div
            role="presentation"
            aria-hidden
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.2)' }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Brain assistant"
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(440px, 96vw)',
              maxWidth: '100%',
              zIndex: 9999,
              borderLeft: '1px solid var(--border-subtle)',
              boxShadow: '-8px 0 24px rgba(0,0,0,0.2)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              background: 'var(--bg-base)',
            }}
          >
            <BrainPanel
              variant="docked"
              pinnedProjectId={projectId}
              modality={modality}
              extraSystem={extraSystem}
              initialChatId={initialChatId}
              onClose={() => setOpen(false)}
            />
          </div>
        </>
      )}
    </>
  );
}

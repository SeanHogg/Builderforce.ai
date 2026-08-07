'use client';

import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import styles from './PwaToast.module.css';

/**
 * Shared presentational shell for the PWA toasts (update-available +
 * install-app). Owns the placement, the surface and the primary-action button so
 * the two banners stay visually identical without duplicating the chrome, and so
 * the phone layout — where the bottom edge already belongs to the fixed bottom
 * bar and whatever the page docks above it — is decided in ONE stylesheet.
 *
 * `slot` is the toast's index in the shared stack (0 = nearest the anchored
 * edge). When two toasts are live at once they pass different slots so they
 * stack instead of overlapping. The offset arithmetic is the stylesheet's: the
 * slot is handed over as a custom property, because the anchor edge and the row
 * height are not the same on a phone as on a desktop.
 */

type SlotStyle = CSSProperties & { '--pwa-toast-slot': number };

export function PwaToast({ children, slot = 0 }: { children: ReactNode; slot?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={styles.shell}
      style={{ '--pwa-toast-slot': Math.max(0, slot) } as SlotStyle}
    >
      {children}
    </div>
  );
}

export function PwaToastText({ children }: { children: ReactNode }) {
  return <span className={styles.text}>{children}</span>;
}

export function PwaToastPrimaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={styles.primary}>
      {children}
    </button>
  );
}

export function PwaToastDismissButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations('pwa');
  return (
    <button type="button" onClick={onClick} aria-label={t('dismiss')} title={t('dismiss')} className={styles.dismiss}>
      {/* A drawn ✕ rather than the character: the glyph rendered at whatever
          weight and baseline the platform font felt like, which is what made the
          toast look bolted together on a phone. */}
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    </button>
  );
}

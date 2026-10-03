'use client';

import { useTranslations } from 'next-intl';
import { useWebContainerBooted } from '@/lib/browserRuntime/webcontainerSession';

/**
 * The attribution WebContainer's free (non-commercial) licence requires wherever
 * the in-browser runtime is in use. It decides its own visibility: nothing renders
 * until this page has actually booted a WebContainer, so it can be dropped into any
 * surface that might run one without the host tracking that itself.
 */
export function WebContainerAttribution() {
  const t = useTranslations('webcontainer');
  if (!useWebContainerBooted()) return null;

  return (
    <p
      className="flex flex-wrap items-center gap-1 px-3 py-1 text-xs"
      style={{
        margin: 0,
        background: 'var(--bg-elevated)',
        borderTop: '1px solid var(--border-subtle)',
        color: 'var(--text-muted)',
      }}
    >
      <span>{t('attributionLead')}</span>
      <a
        href="https://webcontainers.io"
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('attributionAria')}
        style={{ color: 'var(--accent)' }}
      >
        WebContainers by StackBlitz
      </a>
    </p>
  );
}

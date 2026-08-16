'use client';

/**
 * `/templates` — the installable half of the catalogue, on its own page.
 *
 * The gallery component is shared with the marketplace's Templates chip, so
 * this page is a heading and a mount. The starting-point picker under every
 * prompt bar reads the SAME catalogue, which is what makes "where do I find
 * templates?" have one answer rather than four.
 */

import { useTranslations } from 'next-intl';
import { TemplateGallery } from '@/components/templates/TemplateGallery';

export default function TemplatesPage() {
  const t = useTranslations('templates');
  return (
    <main style={{ padding: 'clamp(16px, 4vw, 32px)', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 'clamp(1.25rem, 3vw, 1.5rem)', fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('title')}
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)', maxWidth: '60ch' }}>
          {t('subtitle')}
        </p>
      </header>
      <TemplateGallery />
    </main>
  );
}

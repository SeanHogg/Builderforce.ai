import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo';
import { TemplateGallery } from '@/components/templates/TemplateGallery';

// Non-static route under @cloudflare/next-on-pages — the build fails without it.
export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('templates');
  return pageMetadata({ title: t('title'), description: t('subtitle'), path: '/templates' });
}

/**
 * `/templates` — the installable half of the catalogue, on its own page.
 *
 * A server shell around one client grid: the gallery is shared with the
 * marketplace's Templates chip, so this page is a heading and a mount. The
 * starting-point picker under every prompt bar reads the SAME catalogue, which
 * is what makes "where do I find templates?" have one answer rather than four.
 */
export default async function TemplatesPage() {
  const t = await getTranslations('templates');
  return (
    <main style={{ padding: 'clamp(16px, 4vw, 32px)', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header>
        <h1 className="ui-text-page-title" style={{ margin: 0, color: 'var(--text-primary)' }}>{t('title')}</h1>
        <p className="ui-text-small" style={{ margin: '6px 0 0', color: 'var(--text-muted)', maxWidth: '60ch' }}>
          {t('subtitle')}
        </p>
      </header>
      <TemplateGallery />
    </main>
  );
}

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import PageContainer from '@/components/PageContainer';
import { ReferenceCard } from '@/components/references/ReferenceCard';
import { getSharedReferences } from '@/lib/referencesApi';

// Dynamic on the Edge Runtime — the token is resolved per request, and a revoked
// link must stop working immediately, which any caching would delay.
export const runtime = 'edge';

/**
 * `noindex`, deliberately and non-negotiably.
 *
 * This page shows a named third party's contact details to whoever holds the link.
 * That is defensible because the link is issued, scoped and revocable — and it
 * stops being defensible the moment a crawler puts it in an index. The header is
 * set here rather than left to a global default so it cannot be lost to one.
 *
 * It has to live in `generateMetadata` and NOWHERE ELSE: the title is localized,
 * so this route needs the async form, and Next refuses a module that exports
 * both — "`metadata` and `generateMetadata` cannot be exported at the same
 * time" is a BUILD failure, not a warning, which is how a static `metadata`
 * duplicating these robots flags took the whole deploy down.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('references');
  return { title: t('shared.metaTitle'), robots: { index: false, follow: false, nocache: true } };
}

export default async function SharedReferencesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('references');
  const view = await getSharedReferences(token).catch(() => null);

  return (
    <PageContainer width="readable" style={{ padding: '48px 24px 80px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {!view ? (
        <>
          <h1 style={{ margin: 0, fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('shared.goneTitle')}
          </h1>
          <p style={{ margin: 0, fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)', maxWidth: '60ch' }}>
            {t('shared.goneBody')}
          </p>
        </>
      ) : (
        <>
          <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h1 style={{ margin: 0, fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)' }}>
              {view.label || t('shared.title')}
            </h1>
            <p style={{ margin: 0, fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)', maxWidth: '60ch' }}>
              {view.includeContact ? t('shared.ledeWithContact') : t('shared.ledeNoContact')}
            </p>
          </header>

          {view.references.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>{t('shared.empty')}</p>
          ) : (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {view.references.map((reference) => (
                <ReferenceCard
                  key={reference.id}
                  reference={reference}
                  statusLabel={t(`status.${reference.status}`)}
                  canSpeakToLabel={t('canSpeakTo')}
                />
              ))}
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}

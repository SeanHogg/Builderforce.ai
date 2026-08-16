import { getTranslations } from 'next-intl/server';
import PageContainer from '@/components/PageContainer';
import ReferencesClient from '@/app/references/ReferencesClient';

/**
 * `/references` — a person's own reference list.
 *
 * A SERVER component: the heading and lede have no interactivity, so the route
 * root stays off the client-rooted-pages ratchet and only the list below it
 * ships as client code. Everything the list shows is the signed-in person's
 * private data, so there is no `metadata` export and nothing here for a crawler;
 * logged-out visitors get the route teaser from middleware.
 */
export const runtime = 'edge';

export default async function ReferencesPage() {
  const t = await getTranslations('references');
  return (
    <PageContainer width="readable" style={{ padding: '40px 24px 72px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('title')}
        </h1>
        <p style={{ margin: 0, fontSize: 'var(--font-size-lede)', color: 'var(--text-secondary)', maxWidth: '60ch' }}>
          {t('lede')}
        </p>
      </header>
      <ReferencesClient />
    </PageContainer>
  );
}

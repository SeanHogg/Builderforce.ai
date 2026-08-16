import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import PageContainer from '@/components/PageContainer';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { pageMetadata } from '@/lib/seo';
import { getSalaryDirectory } from '@/lib/salary';

// Dynamic on the Edge Runtime, same as /compare/[competitor]: `getTranslations()`
// reads the locale cookie, which forces the route dynamic, and next-on-pages then
// requires every non-static route to opt in explicitly.
export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('salary');
  return pageMetadata({ title: t('index.metaTitle'), description: t('index.metaDescription'), path: '/salary' });
}

export default async function SalaryIndexPage() {
  const t = await getTranslations('salary');
  const directory = await getSalaryDirectory();
  const roles = directory?.roles ?? [];

  // The families are the page's structure, derived from the catalog rather than
  // restated — a new family appears when a role declares it.
  const families = [...new Set(roles.map((r) => r.family))];

  return (
    <PageContainer width="readable" style={{ padding: '48px 24px 80px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h1 style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {t('index.title')}
        </h1>
        <p style={{ fontSize: 'var(--font-size-lede)', color: 'var(--text-secondary)', margin: 0, maxWidth: '62ch' }}>
          {t('index.lede')}
        </p>
      </header>

      {roles.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>{t('index.unavailable')}</p>
      )}

      {families.map((family) => (
        <section key={family} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            {family}
          </h2>
          <ul style={{
            listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10,
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          }}>
            {roles.filter((r) => r.family === family).map((role) => (
              <li key={role.slug}>
                <Link
                  href={`/salary/${role.slug}`}
                  style={{
                    display: 'block', padding: '13px 15px', borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
                    color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 600,
                    fontSize: 'var(--font-size-body)',
                  }}
                >
                  {role.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <RelatedArticles surface="salary" />
    </PageContainer>
  );
}

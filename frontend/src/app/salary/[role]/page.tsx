import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import PageContainer from '@/components/PageContainer';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { CityTable, SeniorityTable } from '@/components/salary/SalaryTables';
import { pageMetadata } from '@/lib/seo';
import { getSalaryRoleGuide, money } from '@/lib/salary';

// See /salary — cookie-based locale forces this dynamic, so it opts into the Edge
// Runtime rather than being prerendered. Unknown roles 404 from the API read.
export const runtime = 'edge';

export async function generateMetadata({ params }: { params: Promise<{ role: string }> }): Promise<Metadata> {
  const { role } = await params;
  const data = await getSalaryRoleGuide(role);
  if (!data) return { title: 'Salary Guide Not Found' };
  const t = await getTranslations('salary');
  const { guide } = data;
  return pageMetadata({
    title: t('role.metaTitle', { role: guide.role.title }),
    description: t('role.metaDescription', {
      role: guide.role.title,
      median: money(guide.national.median, guide.currency),
      cities: guide.cities.length,
    }),
    path: `/salary/${guide.role.slug}`,
  });
}

export default async function SalaryRolePage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  const data = await getSalaryRoleGuide(role);
  if (!data) notFound();
  const { guide } = data;
  const t = await getTranslations('salary');

  return (
    <PageContainer width="readable" style={{ padding: '48px 24px 80px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Link href="/salary" style={{ fontSize: 'var(--font-size-small)', color: 'var(--accent)', textDecoration: 'none' }}>
          {t('backToIndex')}
        </Link>
        <h1 style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {t('role.title', { role: guide.role.title })}
        </h1>
        <p style={{ fontSize: 'var(--font-size-lede)', color: 'var(--text-secondary)', margin: 0, maxWidth: '62ch' }}>
          {t('role.lede', {
            role: guide.role.title,
            median: money(guide.national.median, guide.currency),
            low: money(guide.national.low, guide.currency),
            high: money(guide.national.high, guide.currency),
          })}
        </p>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {t('role.byCity')}
        </h2>
        <CityTable
          rows={guide.cities}
          currency={guide.currency}
          roleSlug={guide.role.slug}
          labels={{
            city: t('table.city'), low: t('table.low'), median: t('table.median'),
            high: t('table.high'), spread: t('table.spread'), vsNational: t('table.vsNational'),
          }}
        />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {t('role.bySeniority')}
        </h2>
        <SeniorityTable
          rows={guide.seniorities}
          currency={guide.currency}
          labels={{
            seniority: t('table.seniority'), low: t('table.low'),
            median: t('table.median'), high: t('table.high'), spread: t('table.spread'),
          }}
        />
      </section>

      <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0, maxWidth: '68ch' }}>
        {t('modelNote')}{' '}
        <Link href="/tools/salary-calculator" style={{ color: 'var(--accent)' }}>{t('calculatorCta')}</Link>
      </p>

      <RelatedArticles surface="salary" />
    </PageContainer>
  );
}

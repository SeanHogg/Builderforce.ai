import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import PageContainer from '@/components/PageContainer';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { CityTable, SeniorityTable } from '@/components/salary/SalaryTables';
import { pageMetadata } from '@/lib/seo';
import { getSalaryCityGuide, money } from '@/lib/salary';

// See /salary — cookie-based locale forces this dynamic, hence the Edge Runtime.
export const runtime = 'edge';

export async function generateMetadata(
  { params }: { params: Promise<{ role: string; city: string }> },
): Promise<Metadata> {
  const { role, city } = await params;
  const data = await getSalaryCityGuide(role, city);
  if (!data) return { title: 'Salary Guide Not Found' };
  const t = await getTranslations('salary');
  const { guide } = data;
  return pageMetadata({
    title: t('city.metaTitle', { role: guide.role.title, city: guide.city.name }),
    description: t('city.metaDescription', {
      role: guide.role.title,
      city: guide.city.name,
      median: money(guide.analysis.band.median, guide.currency),
      low: money(guide.analysis.band.low, guide.currency),
      high: money(guide.analysis.band.high, guide.currency),
    }),
    path: `/salary/${guide.role.slug}/${guide.city.slug}`,
  });
}

export default async function SalaryCityPage(
  { params }: { params: Promise<{ role: string; city: string }> },
) {
  const { role, city } = await params;
  const data = await getSalaryCityGuide(role, city);
  if (!data) notFound();
  const { guide } = data;
  const t = await getTranslations('salary');
  const band = guide.analysis.band;

  return (
    <PageContainer width="readable" style={{ padding: '48px 24px 80px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Link href={`/salary/${guide.role.slug}`} style={{ fontSize: 'var(--font-size-small)', color: 'var(--accent)', textDecoration: 'none' }}>
          {t('backToRole', { role: guide.role.title })}
        </Link>
        <h1 style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {t('city.title', { role: guide.role.title, city: guide.city.name })}
        </h1>
        <p style={{ fontSize: 'var(--font-size-lede)', color: 'var(--text-secondary)', margin: 0, maxWidth: '62ch' }}>
          {t('city.lede', {
            role: guide.role.title,
            city: guide.city.name,
            median: money(band.median, guide.currency),
            low: money(band.low, guide.currency),
            high: money(band.high, guide.currency),
          })}
        </p>
      </header>

      {/* The anchor to negotiate from — the one number this page exists to give. */}
      <div style={{
        display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline',
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-base)', padding: '18px 20px',
      }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('table.median')}</span>
          <strong style={{ fontSize: 'var(--font-size-section)', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {money(band.median, guide.currency)}
          </strong>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('city.anchorLabel')}</span>
          <strong style={{ fontSize: 'var(--font-size-section)', color: 'var(--coral-bright)', fontVariantNumeric: 'tabular-nums' }}>
            {money(band.high, guide.currency)}
          </strong>
        </span>
        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', maxWidth: '40ch' }}>
          {t('city.anchorHint')}
        </span>
      </div>

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

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {t('city.assumptions')}
        </h2>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {guide.analysis.assumptions.map((assumption) => (
            <li key={assumption} style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)' }}>{assumption}</li>
          ))}
        </ul>
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0, maxWidth: '68ch' }}>
          {guide.analysis.basis}
        </p>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {t('city.elsewhere', { role: guide.role.title })}
        </h2>
        <CityTable
          rows={guide.otherCities}
          currency={guide.currency}
          roleSlug={guide.role.slug}
          labels={{
            city: t('table.city'), low: t('table.low'), median: t('table.median'),
            high: t('table.high'), spread: t('table.spread'), vsNational: t('table.vsNational'),
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

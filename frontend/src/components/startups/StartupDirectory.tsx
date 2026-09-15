'use client';

/**
 * The startup directory — the marketplace's `company · business` section.
 *
 * BurnRateOS's `/businesses` page and the "Discover startups" band on its home,
 * as ONE section of the storefront rather than a destination beside it (operator
 * call 2026-09-15: "startup listings should be part of the marketplace"). The
 * storefront's search box is the search; this renders the stage row, the grid,
 * the paging and the interest panel, and the two doors under it.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Pagination } from '@/components/Pagination';
import { SkeletonGrid } from '@/app/marketplace/SkeletonGrid';
import { StartupCard } from './StartupCard';
import { StartupFilters } from './StartupFilters';
import { ExpressInterestPanel } from './ExpressInterestPanel';
import { StartupDoors, useListYourStartupHref } from './StartupDoors';
import { useStartupDirectory } from './useStartupDirectory';
import { startupMutedStyle, startupPrimaryButtonStyle } from './startupStyles';

export function StartupDirectory({ search }: { search: string }) {
  const t = useTranslations('startups.directory');
  const directory = useStartupDirectory({ search });
  const listHref = useListYourStartupHref();

  return (
    <section aria-label={t('heading')} style={{ display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)' }}>{t('heading')}</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('blurb')}</p>
        </div>
        {directory.page && <span style={startupMutedStyle}>{t('count', { count: directory.page.total })}</span>}
      </header>

      <StartupFilters query={directory.query} onChange={directory.setQuery} />

      {directory.error && (
        <p role="alert" style={{ margin: 0, padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--error-bg)', color: 'var(--error-text)', borderLeft: '3px solid var(--danger)', fontSize: 'var(--font-size-small)' }}>
          {directory.error}
        </p>
      )}

      {directory.loading && !directory.page && <SkeletonGrid count={6} />}

      {directory.page && directory.page.startups.length === 0 && !directory.error && (
        <div className="ui-empty-state" style={{ textAlign: 'center', padding: '32px 16px' }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('empty')}</p>
          <Link href={listHref} style={{ ...startupPrimaryButtonStyle, width: 'auto', display: 'inline-flex', marginTop: 12, textDecoration: 'none' }}>{t('listYours')}</Link>
        </div>
      )}

      {directory.page && directory.page.startups.length > 0 && (
        <>
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))' }}>
            {directory.page.startups.map((startup) => (
              <StartupCard key={startup.slug} startup={startup} onInquire={directory.openInquiry} />
            ))}
          </div>
          {/* Server-paged, so the compact density — a numbered strip would advertise pages this grid has not fetched. */}
          <Pagination compact page={directory.page.page} pageCount={directory.page.totalPages} onChange={directory.setPage} />
        </>
      )}

      <StartupDoors onBrowseRaising={() => directory.setQuery({ ...directory.query, seekingInvestment: true, page: 1 })} />

      <ExpressInterestPanel
        open={directory.inquiring != null}
        onClose={directory.closeInquiry}
        company={directory.inquiring ? { slug: directory.inquiring.slug, name: directory.inquiring.name } : null}
      />
    </section>
  );
}

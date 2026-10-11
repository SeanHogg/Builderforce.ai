/**
 * The newest listed startups as a short grid, with the interest panel each card
 * opens — no filters, no paging, no doors. What a surface shows when the startup
 * directory is one thing on the page rather than the page: the investor
 * explainer's teaser and the marketplace's All view.
 */

import { useTranslations } from 'next-intl';
import { SkeletonGrid } from '@/app/marketplace/SkeletonGrid';
import { StartupCard } from './StartupCard';
import { ExpressInterestPanel } from './ExpressInterestPanel';
import { useStartupDirectory } from './useStartupDirectory';
import { startupMutedStyle } from './startupStyles';

export function StartupPreview({ search = '', limit }: { search?: string; limit: number }) {
  const t = useTranslations('startups.directory');
  const directory = useStartupDirectory({ search, limit });
  const startups = directory.page?.startups ?? [];

  return (
    <>
      {directory.loading && !directory.page && <SkeletonGrid count={limit} />}
      {startups.length > 0 && (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))' }}>
          {startups.map((startup) => <StartupCard key={startup.slug} startup={startup} onInquire={directory.openInquiry} />)}
        </div>
      )}
      {!directory.loading && startups.length === 0 && (
        <p style={startupMutedStyle}>{t('empty')}</p>
      )}
      <ExpressInterestPanel
        open={directory.inquiring != null}
        onClose={directory.closeInquiry}
        company={directory.inquiring ? { slug: directory.inquiring.slug, name: directory.inquiring.name } : null}
      />
    </>
  );
}

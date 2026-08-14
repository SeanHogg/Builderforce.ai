import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo';
import { publicApiGet } from '@/lib/publicApi';
import type { CreationListing } from '@/lib/creationListings';
import { ListingLaunch } from './ListingLaunch';

/**
 * A creation, for sale, and RUNNABLE from this page.
 *
 * The last step of "idea → make → run" used to stop at the author's own board.
 * This is where it lands: a public, indexable page for one published creation,
 * with a primary button that plays the game, opens the site, runs the tool or
 * installs the pack — decided by the listing's kind, not by a branch here.
 *
 * Server-rendered for the metadata and the fold (a marketplace product that is
 * invisible to search is a product nobody finds); the launch surface itself is a
 * client island, because running a stranger's creation is interactive by nature.
 */
export const runtime = 'edge';

async function loadListing(slug: string): Promise<CreationListing | null> {
  const body = await publicApiGet<{ listing?: CreationListing }>(
    `/api/listings/${encodeURIComponent(slug)}`,
  );
  return body?.listing ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const listing = await loadListing(slug);
  if (!listing) return { title: 'Not found', robots: { index: false, follow: false } };
  return pageMetadata({
    title: `${listing.name} — Builderforce.ai Marketplace`,
    description: listing.summary?.slice(0, 200)
      || `${listing.name}, published on the Builderforce.ai marketplace.`,
    path: `/marketplace/listing/${listing.slug}`,
    ogTitle: listing.name,
  });
}

export default async function ListingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const listing = await loadListing(slug);
  if (!listing) notFound();
  const t = await getTranslations('marketplaceListing');

  return (
    <main className="mpl">
      {/* Every colour is a theme token, so the page reads in light and dark; the
          column is a max-width with a fluid gutter rather than a fixed page. */}
      <style>{`
        .mpl { min-height: 100vh; }
        .mpl-main { max-width: var(--marketing-max); margin: 0 auto; width: 100%;
                    padding: 40px var(--marketing-gutter) 48px; }
        .mpl-eyebrow { font-family: var(--font-display); font-size: var(--font-size-eyebrow);
                       font-weight: 600; letter-spacing: .16em; text-transform: uppercase;
                       color: var(--coral-bright); margin-bottom: 10px; }
        .mpl-title { font-family: var(--font-display); font-weight: 700; letter-spacing: -.03em;
                     line-height: 1.1; font-size: var(--font-size-page-title);
                     color: var(--text-primary); margin: 0 0 10px; }
        .mpl-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center;
                    color: var(--text-secondary); font-size: var(--font-size-small); margin: 0 0 16px; }
        .mpl-summary { font-size: var(--font-size-lede); color: var(--text-primary);
                       line-height: 1.65; margin: 0 0 22px; max-width: 70ch; }
        .mpl-tags { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 20px; }
        .mpl-tag { font-size: var(--font-size-eyebrow); font-weight: 600; color: var(--text-secondary);
                   border: 1px solid var(--border-subtle); border-radius: var(--radius-full);
                   padding: 4px 12px; }
      `}</style>

      <div className="mpl-main">
        <div className="mpl-eyebrow">{t(`kind.${listing.kind}`)}</div>
        <h1 className="mpl-title">{listing.icon} {listing.name}</h1>
        <div className="mpl-meta">
          {listing.sellerName ? <span>{t('byAuthor', { author: listing.sellerName })}</span> : null}
          <span>· v{listing.version}</span>
          <span>· {t('installs', { count: listing.installCount })}</span>
        </div>
        {listing.summary ? <p className="mpl-summary">{listing.summary}</p> : null}
        {listing.tags.length > 0 && (
          <div className="mpl-tags">
            {listing.tags.map((tag) => <span key={tag} className="mpl-tag">{tag}</span>)}
          </div>
        )}

        <ListingLaunch listing={listing} />
      </div>
    </main>
  );
}

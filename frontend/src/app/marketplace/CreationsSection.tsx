/**
 * The things people BUILT, on sale — the marketplace's fourth producer.
 *
 * Until now everything in the marketplace was authored through a form (a skill),
 * registered as an agent, or posted as work. Nothing that came off the canvas
 * could get here, so the platform's own output was the one thing its marketplace
 * did not carry. This section is that feed.
 *
 * It renders itself for logged-out visitors too, and every card links to a page
 * where the thing RUNS. A marketplace of screenshots is not what publishing a
 * working game is for.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MARKETPLACE_LISTING_KINDS } from '@builderforce/creation-canvas-contract';
import {
  formatListingPrice,
  publicListingApi,
  type CreationListing,
} from '@/lib/creationListings';
import { SkeletonGrid } from './SkeletonGrid';

export function CreationsSection({ search }: { search: string }) {
  const t = useTranslations('marketplaceCreations');
  const [listings, setListings] = useState<CreationListing[] | null>(null);
  const [kind, setKind] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await publicListingApi.browse({ q: search, kind, limit: 24 });
      setListings(result.listings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setListings([]);
    }
  }, [search, kind]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section aria-label={t('heading')} style={{ display: 'grid', gap: 14 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline' }}>
        <h2 style={{
          margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 700,
          color: 'var(--text-primary)',
        }}>
          {t('heading')}
        </h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
          {t('blurb')}
        </p>
      </header>

      {/* The kind filter is the registry, so a new sellable kind appears here with
          no edit — the same reason the publish panel reads its options from it. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <FilterChip active={kind === ''} onClick={() => setKind('')} label={t('allKinds')} />
        {MARKETPLACE_LISTING_KINDS.map((spec) => (
          <FilterChip
            key={spec.id}
            active={kind === spec.id}
            onClick={() => setKind(spec.id)}
            label={`${spec.icon} ${t(`kind.${spec.id}`)}`}
          />
        ))}
      </div>

      {error && (
        <p role="alert" style={{
          margin: 0, padding: '10px 14px', borderRadius: 'var(--radius-md)',
          background: 'var(--tone-danger-bg)', color: 'var(--tone-danger-ink)',
          borderLeft: '3px solid var(--tone-danger-mark)', fontSize: 'var(--font-size-small)',
        }}>{error}</p>
      )}

      {listings === null && <SkeletonGrid count={6} />}

      {listings?.length === 0 && !error && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
          {t('empty')}
        </p>
      )}

      {!!listings?.length && (
        <div style={{
          display: 'grid', gap: 14,
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))',
        }}>
          {listings.map((listing) => <ListingCard key={listing.id} listing={listing} />)}
        </div>
      )}
    </section>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '6px 13px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
        fontSize: 'var(--font-size-eyebrow)', fontWeight: 600,
        border: `1px solid ${active ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
        background: active ? 'var(--coral-bright)' : 'var(--surface-card)',
        color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
      }}
    >
      {label}
    </button>
  );
}

function ListingCard({ listing }: { listing: CreationListing }) {
  const t = useTranslations('marketplaceCreations');
  return (
    <Link
      href={`/marketplace/listing/${listing.slug}`}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
        padding: 16, textDecoration: 'none',
        background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
        <span aria-hidden style={{ fontSize: 'var(--font-size-lede)' }}>{listing.icon}</span>
        <strong style={{
          color: 'var(--text-primary)', fontSize: 'var(--font-size-body)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{listing.name}</strong>
      </div>
      <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)' }}>
        {t(`kind.${listing.kind}`)}
        {listing.sellerName ? ` · ${listing.sellerName}` : ''}
      </span>
      {listing.summary && (
        <p style={{
          margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)',
          lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{listing.summary}</p>
      )}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'baseline', marginTop: 'auto', paddingTop: 6,
        flexWrap: 'wrap',
      }}>
        <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-small)' }}>
          {listing.priceCents === 0
            ? t('free')
            : formatListingPrice(listing.priceCents, listing.currency)}
        </strong>
        <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)' }}>
          {t(`launchVerb.${listing.launch}`)} · {t('installs', { count: listing.installCount })}
        </span>
      </div>
    </Link>
  );
}

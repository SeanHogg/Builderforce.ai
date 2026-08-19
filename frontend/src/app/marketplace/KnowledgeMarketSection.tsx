import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { knowledgeApi, type KnowledgeListing, type DocType } from '@/lib/knowledgeApi';
import { signInHref } from '@/lib/auth';
import { formatCents } from '@/lib/canvasMoney';

/**
 * Marketplace section for KNOWLEDGE listings (SOPs / processes / docs / canvases
 * a tenant published for sale). Browses the PUBLIC listings feed, so it renders
 * for logged-out visitors too (they can see what is for sale). "Add to my
 * Knowledge" installs a copy into the caller's workspace and opens it; a paid
 * listing is purchased first (checkout), and a logged-out visitor is sent to
 * sign in.
 *
 * It is the view the Assets → Knowledge chip selects, not an always-on strip
 * above the storefront, so it answers the shared search box and says "nothing
 * here" out loud rather than vanishing — a chip that renders a blank page reads
 * as a broken filter.
 */

const TYPE_LABEL: Record<DocType, string> = { sop: 'type_sop', process: 'type_process', doc: 'type_doc', postmortem: 'type_postmortem', known_error: 'type_known_error' };
const TYPE_ICON: Record<DocType, string> = { sop: '📋', process: '🔁', doc: '📄', postmortem: '🔬', known_error: '⚠️' };

export function KnowledgeMarketSection({ search = '' }: { search?: string }) {
  const t = useTranslations('knowledge');
  const router = useRouter();
  const { hasTenant } = useAuth();
  const [listings, setListings] = useState<KnowledgeListing[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Public feed — no tenant token needed, so logged-out visitors browse too.
    knowledgeApi.publicListings().then(setListings).catch(() => setListings([]));
  }, []);

  // The feed is one bounded page of listings, so the shared search box filters
  // it here rather than costing a round-trip per keystroke.
  const q = search.trim().toLowerCase();
  const visible = q
    ? listings.filter((l) =>
        l.title.toLowerCase().includes(q) ||
        (l.summary ?? '').toLowerCase().includes(q) ||
        l.tags.some((tg) => tg.toLowerCase().includes(q)))
    : listings;

  async function acquire(listing: KnowledgeListing) {
    // Buying/installing writes into a workspace — a logged-out visitor signs in first.
    if (!hasTenant) {
      router.push(signInHref('/marketplace'));
      return;
    }
    setInstalling(listing.id);
    setError(null);
    try {
      if (listing.priceCents > 0) {
        const res = await knowledgeApi.checkoutListing(listing.id);
        if (res.requiresConfig) {
          setError(t('checkoutUnavailable'));
          setInstalling(null);
          return;
        }
        // res.purchased (paid, recorded) or res.free — both allow install below.
      }
      const { documentId } = await knowledgeApi.installListing(listing.id);
      router.push(`/knowledge/${documentId}`);
    } catch {
      setError(t('installFailed'));
      setInstalling(null);
    }
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 4px' }}>{t('marketTitle')}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 'var(--font-size-small)', margin: '0 0 16px' }}>{t('marketSubtitle')}</p>
      {error && (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--font-size-small)', margin: '0 0 12px' }}>{error}</p>
      )}
      {visible.length === 0 && (
        <p style={{ textAlign: 'center', padding: '48px 0', margin: 0, color: 'var(--muted)', fontSize: 'var(--font-size-small)' }}>
          {t('marketEmpty')}
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 16 }}>
        {visible.map((l) => (
          <div key={l.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 'var(--font-size-body)' }}>
                {TYPE_ICON[l.docType]} {l.title}
              </span>
              <span className="badge badge-gray">{t(TYPE_LABEL[l.docType])}</span>
            </div>
            {l.summary && (
              <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--muted)', lineHeight: 1.5, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                {l.summary}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {l.tags.slice(0, 3).map((tg) => (
                <span key={tg} className="badge badge-gray">{tg}</span>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--font-size-small)', color: 'var(--muted)', marginTop: 'auto' }}>
              <span>{l.authorName ? t('by', { author: l.authorName }) : ''}</span>
              <span>{t('installs', { count: l.installCount })}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontWeight: 700 }}>{l.priceCents > 0 ? formatCents(l.priceCents) : t('free')}</span>
              <button type="button" className="btn btn-primary btn-sm" disabled={installing === l.id} onClick={() => acquire(l)}>
                {installing === l.id
                  ? t('installing')
                  : !hasTenant
                    ? t('signInToGet')
                    : l.priceCents > 0
                      ? t('buy')
                      : t('addToKnowledge')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { knowledgeApi, type KnowledgeListing, type DocType } from '@/lib/knowledgeApi';

/**
 * Marketplace section for KNOWLEDGE listings (SOPs / processes / docs / canvases
 * a tenant published for sale). Self-contained + self-gating: it fetches the
 * public listings with the tenant token, so it renders nothing for logged-out
 * visitors or when there are no listings. "Add to my Knowledge" installs a copy
 * into the caller's workspace and opens it.
 */

const TYPE_LABEL: Record<DocType, string> = { sop: 'type_sop', process: 'type_process', doc: 'type_doc' };
const TYPE_ICON: Record<DocType, string> = { sop: '📋', process: '🔁', doc: '📄' };

export function KnowledgeMarketSection() {
  const t = useTranslations('knowledge');
  const router = useRouter();
  const { hasTenant } = useAuth();
  const [listings, setListings] = useState<KnowledgeListing[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    if (!hasTenant) return;
    knowledgeApi.listings().then(setListings).catch(() => setListings([]));
  }, [hasTenant]);

  if (!hasTenant || listings.length === 0) return null;

  async function install(id: string) {
    setInstalling(id);
    try {
      const { documentId } = await knowledgeApi.installListing(id);
      router.push(`/knowledge/${documentId}`);
    } catch {
      setInstalling(null);
    }
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 4px' }}>{t('marketTitle')}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 16px' }}>{t('marketSubtitle')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {listings.map((l) => (
          <div key={l.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {TYPE_ICON[l.docType]} {l.title}
              </span>
              <span className="badge badge-gray">{t(TYPE_LABEL[l.docType])}</span>
            </div>
            {l.summary && (
              <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                {l.summary}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {l.tags.slice(0, 3).map((tg) => (
                <span key={tg} className="badge badge-gray">{tg}</span>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginTop: 'auto' }}>
              <span>{l.authorName ? t('by', { author: l.authorName }) : ''}</span>
              <span>{t('installs', { count: l.installCount })}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontWeight: 700 }}>{l.priceCents > 0 ? `$${(l.priceCents / 100).toFixed(2)}` : t('free')}</span>
              <button type="button" className="btn btn-primary btn-sm" disabled={installing === l.id} onClick={() => install(l.id)}>
                {installing === l.id ? t('installing') : t('addToKnowledge')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

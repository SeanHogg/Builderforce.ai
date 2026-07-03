'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { useOptionalAuth } from '@/lib/AuthContext';
import { listFreelancers, type FreelancerProfile, type TalentFilters } from '@/lib/freelancerApi';
import { RatingStars } from '@/components/freelance/RatingStars';

const DISCIPLINES = ['developer', 'dba', 'designer', 'devops', 'qa', 'pm', 'data', 'security', 'other'] as const;

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 18,
  display: 'flex', flexDirection: 'column', gap: 10, textDecoration: 'none',
};
const input: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
  borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none',
};

function initials(name: string | null): string {
  return (name ?? '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('') || '?';
}

export default function TalentMarketplaceClient() {
  const t = useTranslations('talent');
  const td = useTranslations('freelancer');
  const auth = useOptionalAuth();
  const [rows, setRows] = useState<FreelancerProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TalentFilters>({ page: 1, pageSize: 24 });

  const load = useCallback(async (f: TalentFilters) => {
    setLoading(true); setError(null);
    try { const res = await listFreelancers(f); setRows(res.items); setTotal(res.total); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(filters); }, [load, filters]);

  const patch = (p: Partial<TalentFilters>) => setFilters((f) => ({ ...f, page: 1, ...p }));
  const pageSize = filters.pageSize ?? 24;
  const page = filters.page ?? 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <PageContainer width="full" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 20, maxWidth: 720 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>{t('title')}</h1>
        <p style={{ fontSize: 15, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{t('hero.blurb')}</p>
        {!auth?.isAuthenticated && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
            <Link href="/register" className="btn btn-primary" style={{ textDecoration: 'none', padding: '9px 18px', borderRadius: 10, fontSize: 14, fontWeight: 700 }}>{t('hero.ctaHire')}</Link>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('signInToView')}</span>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <input style={{ ...input, flex: 1, minWidth: 180 }} placeholder={t('filter.search')} defaultValue={filters.q ?? ''}
          onKeyDown={(e) => { if (e.key === 'Enter') patch({ q: (e.target as HTMLInputElement).value }); }}
          onBlur={(e) => patch({ q: e.target.value })} aria-label={t('filter.search')} />
        <select style={input} value={filters.discipline ?? ''} onChange={(e) => patch({ discipline: e.target.value || undefined })} aria-label={t('filter.discipline')}>
          <option value="">{t('filter.allDisciplines')}</option>
          {DISCIPLINES.map((d) => <option key={d} value={d}>{td(`discipline.${d}`)}</option>)}
        </select>
        <select style={input} value={filters.sort ?? ''} onChange={(e) => patch({ sort: e.target.value || undefined })} aria-label={t('filter.sort')}>
          <option value="">{t('filter.sortRecent')}</option>
          <option value="rating">{t('filter.sortRating')}</option>
          <option value="rate_asc">{t('filter.sortRateAsc')}</option>
          <option value="rate_desc">{t('filter.sortRateDesc')}</option>
        </select>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>…</p>
      ) : error ? (
        <p style={{ color: 'var(--coral-bright)', fontSize: 13 }}>{error}</p>
      ) : rows.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>{t('empty')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' }}>
          {rows.map((f) => (
            <Link key={f.userId} href={`/talent/${f.userId}`} style={card} className="hover-lift">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--surface-interactive)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>
                  {initials(f.displayName)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.displayName ?? '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{f.headline ?? f.discipline ?? ''}</div>
                  <RatingStars rating={f.rating} count={f.ratingCount} />
                </div>
              </div>
              {f.skills.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {f.skills.slice(0, 4).map((s) => (
                    <span key={s} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>{s}</span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--coral-bright)' }}>
                  {f.hourlyRateCents != null ? `${f.currency} ${(f.hourlyRateCents / 100).toFixed(0)}${t('perHour')}` : ''}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('viewProfile')} →</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center', marginTop: 24 }}>
          <button type="button" disabled={page <= 1} onClick={() => setFilters((f) => ({ ...f, page: page - 1 }))}
            style={{ ...input, cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.5 : 1 }}>←</button>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('filter.pageOf', { page, pages })}</span>
          <button type="button" disabled={page >= pages} onClick={() => setFilters((f) => ({ ...f, page: page + 1 }))}
            style={{ ...input, cursor: page >= pages ? 'default' : 'pointer', opacity: page >= pages ? 0.5 : 1 }}>→</button>
        </div>
      )}
    </PageContainer>
  );
}

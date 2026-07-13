'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import NotificationsPanel from '@/components/freelance/NotificationsPanel';
import {
  listMyEngagements, respondEngagement,
  listJobs, bidJob, listMyProposals, withdrawProposal,
  type Engagement, type JobPosting, type JobProposal,
} from '@/lib/freelancerApi';

// The "Find work" surface (open jobs to bid on, my proposals, my engagements) is now
// a category of the marketplace rather than a standalone /freelancer/gigs page — same
// shared search box, one merged surface, matching the Talent + Models consolidation.

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 18,
};
const input: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
  borderRadius: 8, padding: '7px 10px', fontSize: 13, outline: 'none',
};
const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  invited: { bg: 'rgba(59,130,246,0.12)', fg: 'rgba(59,130,246,0.95)' },
  interviewing: { bg: 'rgba(245,158,11,0.14)', fg: 'var(--warning-fg, #f59e0b)' },
  active: { bg: 'rgba(34,197,94,0.14)', fg: 'rgba(34,197,94,0.95)' },
  submitted: { bg: 'rgba(59,130,246,0.12)', fg: 'rgba(59,130,246,0.95)' },
  accepted: { bg: 'rgba(34,197,94,0.14)', fg: 'rgba(34,197,94,0.95)' },
  declined: { bg: 'var(--bg-elevated)', fg: 'var(--text-muted)' },
};

type Tab = 'work' | 'proposals' | 'engagements';

export default function MarketplaceGigsSection({ search }: { search: string }) {
  const t = useTranslations('freelancer');
  const [tab, setTab] = useState<Tab>('work');
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [proposals, setProposals] = useState<JobProposal[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bidFor, setBidFor] = useState<string | null>(null);
  const [bid, setBid] = useState<{ note: string; rate: string }>({ note: '', rate: '' });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [j, p, e] = await Promise.all([
        listJobs().catch(() => []),
        listMyProposals().catch(() => []),
        listMyEngagements().catch(() => []),
      ]);
      setJobs(j); setProposals(p); setEngagements(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(null); }
  };

  const submitBid = async (jobId: string) => {
    setBusy(`bid:${jobId}`); setError(null);
    try {
      await bidJob(jobId, { coverNote: bid.note || undefined, rateCents: bid.rate ? Math.round(parseFloat(bid.rate) * 100) : undefined });
      setBidFor(null); setBid({ note: '', rate: '' });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  };

  const rate = (min: number | null, max: number | null, cur: string) => {
    if (min == null && max == null) return '';
    const f = (c: number) => (c / 100).toFixed(0);
    return min != null && max != null ? `${cur} ${f(min)}–${f(max)}` : `${cur} ${f((min ?? max)!)}`;
  };

  // The marketplace's shared search box filters this section too, so the one input
  // narrows jobs/proposals/engagements just like every other category.
  const q = search.trim().toLowerCase();
  const filteredJobs = q
    ? jobs.filter((j) =>
        j.title.toLowerCase().includes(q) ||
        (j.description ?? '').toLowerCase().includes(q) ||
        (j.tenantName ?? '').toLowerCase().includes(q) ||
        j.skills.some((s) => s.toLowerCase().includes(q)))
    : jobs;
  const filteredProposals = q
    ? proposals.filter((p) => (p.jobTitle ?? '').toLowerCase().includes(q))
    : proposals;
  const filteredEngagements = q
    ? engagements.filter((e) =>
        (e.title ?? '').toLowerCase().includes(q) ||
        (e.tenantName ?? '').toLowerCase().includes(q))
    : engagements;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'work', label: t('gigs.tabWork') },
    { id: 'proposals', label: t('gigs.tabProposals') },
    { id: 'engagements', label: t('gigs.tabEngagements') },
  ];

  const pill = (s: string) => {
    const c = STATUS_COLORS[s] ?? { bg: 'var(--bg-elevated)', fg: 'var(--text-muted)' };
    return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: c.bg, color: c.fg, flexShrink: 0 }}>{t(`status.${s}`)}</span>;
  };

  return (
    <div>
      <NotificationsPanel />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((tb) => (
          <button key={tb.id} type="button" onClick={() => setTab(tb.id)}
            style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: tab === tb.id ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
              border: `1px solid ${tab === tb.id ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
              color: 'var(--text-primary)' }}>
            {tb.label}
          </button>
        ))}
      </div>

      {error && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {loading && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</p>}

      {/* Open jobs to bid on */}
      {!loading && tab === 'work' && (
        filteredJobs.length === 0 ? <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('jobs.emptyOpen')}</div> : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
            {filteredJobs.map((j) => (
              <div key={j.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{j.title}</div>
                  {j.myProposal && pill(j.myProposal.status)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>{j.tenantName} · {rate(j.rateMinCents, j.rateMaxCents, j.currency)}</span>
                  {j.clientRating != null && (j.clientRatingCount ?? 0) > 0 && (
                    <span title={t('gigs.clientRatingTip')} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--warning-fg, #f59e0b)', fontWeight: 600 }}>★ {j.clientRating.toFixed(1)} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({j.clientRatingCount})</span></span>
                  )}
                </div>
                {j.description && <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8, maxHeight: 60, overflow: 'hidden' }}>{j.description}</p>}
                {j.skills.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {j.skills.slice(0, 5).map((s) => <span key={s} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>{s}</span>)}
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  {j.myProposal ? (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('jobs.alreadyBid')}</span>
                  ) : bidFor === j.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input style={input} placeholder={t('jobs.yourRate')} type="number" min={0} value={bid.rate} onChange={(e) => setBid((b) => ({ ...b, rate: e.target.value }))} />
                      <textarea style={{ ...input, minHeight: 60, resize: 'vertical' }} placeholder={t('jobs.coverNote')} value={bid.note} onChange={(e) => setBid((b) => ({ ...b, note: e.target.value }))} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" onClick={() => submitBid(j.id)} disabled={busy === `bid:${j.id}`}
                          style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{t('jobs.submitBid')}</button>
                        <button type="button" onClick={() => setBidFor(null)} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{t('cancel')}</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setBidFor(j.id); setBid({ note: '', rate: '' }); }}
                      style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid var(--coral-bright)', background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{t('jobs.bid')}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* My proposals */}
      {!loading && tab === 'proposals' && (
        filteredProposals.length === 0 ? <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('proposals.empty')}</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredProposals.map((p) => (
              <div key={p.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{p.jobTitle}</div>
                  {p.rateCents != null && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{p.currency} {(p.rateCents / 100).toFixed(0)}{t('perHour')}</div>}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {pill(p.status)}
                  {(p.status === 'submitted' || p.status === 'shortlisted') && (
                    <button type="button" onClick={() => act(`wd:${p.id}`, () => withdrawProposal(p.id))} disabled={busy === `wd:${p.id}`}
                      style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{t('proposals.withdraw')}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Engagements + accept/decline */}
      {!loading && tab === 'engagements' && (
        filteredEngagements.length === 0 ? <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('gigs.empty')}</div> : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
            {filteredEngagements.map((e) => (
              <div key={e.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{e.tenantName ?? t('gigs.workspace')}</div>
                  {pill(e.status)}
                </div>
                {e.title && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>{e.title}</div>}
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('gigs.rate')}: <strong style={{ color: 'var(--text-primary)' }}>{e.rateCents != null ? `${e.currency} ${(e.rateCents / 100).toFixed(0)}/hr` : '—'}</strong></div>
                {(e.status === 'invited' || e.status === 'interviewing') && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button type="button" onClick={() => act(`acc:${e.id}`, () => respondEngagement(e.id, true))} disabled={busy === `acc:${e.id}`}
                      style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{t('gigs.accept')}</button>
                    <button type="button" onClick={() => act(`dec:${e.id}`, () => respondEngagement(e.id, false))} disabled={busy === `dec:${e.id}`}
                      style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{t('gigs.decline')}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

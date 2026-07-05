'use client';

/**
 * TalentView — the Workforce → Talent tab: employer-side management of hired
 * freelancers (engagements, job postings, timecard approvals, invoices). Relocated
 * from the retired top-level /hires destination so managing external hires lives
 * alongside the rest of the workforce. Renders its own inner sub-tab bar; the outer
 * page owns the section title. Keeps the `hires`/`freelancer` i18n namespaces.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import NotificationsPanel from '@/components/freelance/NotificationsPanel';
import { getStoredTenant } from '@/lib/auth';
import {
  listEngagements, terminateEngagement, reviewFreelancer,
  listEmployerTimecards, approveTimecard, rejectTimecard, getTimecardReview,
  listMyJobs, postJob, updateJob, listJobProposals, acceptProposal, declineProposal,
  evaluateProposal, shortlistProposal, scheduleMeeting,
  listEngagementDeliverables, evaluateDeliverable, setDeliverableStatus,
  listEmployerInvoices, payInvoice,
  type Engagement, type Timecard, type TimecardEntry, type JobPosting, type JobProposal, type Invoice,
  type Deliverable, type PostingType, type EngagementType,
} from '@/lib/freelancerApi';

const card: React.CSSProperties = { background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 18 };
const input: React.CSSProperties = { background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', width: '100%' };
const btn = (v: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  border: v === 'primary' ? 'none' : `1px solid ${v === 'danger' ? 'rgba(239,68,68,0.5)' : 'var(--border-subtle)'}`,
  background: v === 'primary' ? 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))' : 'var(--bg-elevated)',
  color: v === 'primary' ? '#fff' : v === 'danger' ? '#f87171' : 'var(--text-primary)',
});
const fmtHrs = (m: number) => `${(m / 60).toFixed(1)}h`;
const money = (c: number, cur: string) => `${cur} ${(c / 100).toFixed(2)}`;
const DISCIPLINES = ['developer', 'dba', 'designer', 'devops', 'qa', 'pm', 'data', 'security', 'other'] as const;
const POSTING_TYPES: PostingType[] = ['project_bid', 'design', 'fte'];
const ENGAGEMENT_TYPES: EngagementType[] = ['fixed_bid', 'hourly', 'fte'];

/** AI eval headline (0..100) as a translucent chip — mirrors the eval-score chip
 *  convention (translucent bg + saturated text, readable in both themes). */
function ScoreChip({ score }: { score: number }) {
  const hue = score >= 75 ? '34,197,94' : score >= 50 ? '245,158,11' : '239,68,68';
  const fg = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#f87171';
  return (
    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 6, background: `rgba(${hue},0.16)`, color: fg, flexShrink: 0 }}>
      {Math.round(score)}
    </span>
  );
}

type Tab = 'team' | 'jobs' | 'timecards' | 'invoices';

export function TalentView() {
  const t = useTranslations('hires');
  const td = useTranslations('freelancer');
  const tg = useTranslations('gigs');
  // getStoredTenant() JSON.parses localStorage and returns a NEW object every
  // call — memoize it so `load` (and its effect) keep a stable identity and
  // don't re-fire on every render (which otherwise loops via setState).
  const tenant = useMemo(() => getStoredTenant(), []);
  const [tab, setTab] = useState<Tab>('team');
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [cards, setCards] = useState<Timecard[]>([]);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, TimecardEntry[]>>({});
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Record<string, JobProposal[]>>({});
  const [rateFor, setRateFor] = useState<string | null>(null);
  const [reviewForm, setReviewForm] = useState<{ rating: number; comment: string }>({ rating: 5, comment: '' });
  const [showPost, setShowPost] = useState(false);
  const [job, setJob] = useState<{ title: string; description: string; requirements: string; discipline: string; skills: string; postingType: PostingType; engagementType: EngagementType; rateMin: string; rateMax: string }>({ title: '', description: '', requirements: '', discipline: '', skills: '', postingType: 'project_bid', engagementType: 'fixed_bid', rateMin: '', rateMax: '' });
  // Per-proposal AI eval headline (0..100) + the open decline composer.
  const [propScores, setPropScores] = useState<Record<string, number>>({});
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [declineMsg, setDeclineMsg] = useState('');
  // Per-engagement deliverables review.
  const [openDeliv, setOpenDeliv] = useState<string | null>(null);
  const [deliverables, setDeliverables] = useState<Record<string, Deliverable[]>>({});
  const [delivScores, setDelivScores] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!tenant) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [e, tc, j, inv] = await Promise.all([
        listEngagements().catch(() => []), listEmployerTimecards().catch(() => []),
        listMyJobs().catch(() => []), listEmployerInvoices().catch(() => []),
      ]);
      setEngagements(e); setCards(tc); setJobs(j); setInvoices(inv);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [tenant]);

  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(null); }
  };

  const toggleReview = async (id: string) => {
    if (openCard === id) { setOpenCard(null); return; }
    setOpenCard(id);
    if (!entries[id]) { try { const { entries: rows } = await getTimecardReview(id); setEntries((p) => ({ ...p, [id]: rows })); } catch { /* noop */ } }
  };
  const toggleProposals = async (id: string) => {
    if (openJob === id) { setOpenJob(null); return; }
    setOpenJob(id);
    if (!proposals[id]) { try { const rows = await listJobProposals(id); setProposals((p) => ({ ...p, [id]: rows })); } catch { /* noop */ } }
  };
  const toggleDeliverables = async (id: string) => {
    if (openDeliv === id) { setOpenDeliv(null); return; }
    setOpenDeliv(id);
    if (!deliverables[id]) { try { const rows = await listEngagementDeliverables(id); setDeliverables((p) => ({ ...p, [id]: rows })); } catch { /* noop */ } }
  };

  const evalProposal = async (pid: string) => {
    setBusy(`ev:${pid}`); setError(null);
    try { const s = await evaluateProposal(pid); setPropScores((m) => ({ ...m, [pid]: s.overall100 })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };
  const submitDecline = async (pid: string) => {
    setBusy(`pd:${pid}`); setError(null);
    try { await declineProposal(pid, declineMsg.trim() || undefined); setDeclineFor(null); setDeclineMsg(''); await load(); if (openJob) { const rows = await listJobProposals(openJob).catch(() => null); if (rows) setProposals((p) => ({ ...p, [openJob]: rows })); } }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };
  const doSchedule = async (input: { title: string; kind: 'review' | 'interview'; jobId?: string; engagementId?: string }) => {
    setBusy(`mt:${input.jobId ?? input.engagementId}`); setError(null);
    try { await scheduleMeeting(input); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };
  const evalDeliverable = async (id: string) => {
    setBusy(`de:${id}`); setError(null);
    try { const s = await evaluateDeliverable(id); setDelivScores((m) => ({ ...m, [id]: s.overall100 })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };
  const decideDeliverable = async (engagementId: string, id: string, status: 'accepted' | 'changes_requested') => {
    setBusy(`ds:${id}`); setError(null);
    try { await setDeliverableStatus(id, status); const rows = await listEngagementDeliverables(engagementId).catch(() => null); if (rows) setDeliverables((p) => ({ ...p, [engagementId]: rows })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };

  const submitReview = async (engagementId: string) => {
    setBusy(`rev:${engagementId}`); setError(null);
    try { await reviewFreelancer(engagementId, reviewForm.rating, reviewForm.comment || undefined); setRateFor(null); setReviewForm({ rating: 5, comment: '' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };

  const submitJob = async () => {
    if (!job.title.trim()) return;
    setBusy('postjob'); setError(null);
    try {
      await postJob({
        title: job.title.trim(), description: job.description || undefined, requirements: job.requirements || undefined,
        discipline: job.discipline || undefined, postingType: job.postingType, engagementType: job.engagementType,
        skills: job.skills ? job.skills.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        rateMinCents: job.rateMin ? Math.round(parseFloat(job.rateMin) * 100) : undefined,
        rateMaxCents: job.rateMax ? Math.round(parseFloat(job.rateMax) * 100) : undefined,
      });
      setShowPost(false); setJob({ title: '', description: '', requirements: '', discipline: '', skills: '', postingType: 'project_bid', engagementType: 'fixed_bid', rateMin: '', rateMax: '' });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  };

  if (!tenant) {
    return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noWorkspace')}</p>;
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'team', label: t('team') }, { id: 'jobs', label: t('jobs') },
    { id: 'timecards', label: t('approvals') }, { id: 'invoices', label: t('invoices') },
  ];
  const statusPill = (s: string, extra?: string) => <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>{extra ?? s}</span>;

  return (
    <section>
      <NotificationsPanel />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((tb) => (
          <button key={tb.id} type="button" onClick={() => setTab(tb.id)}
            style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: tab === tb.id ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
              border: `1px solid ${tab === tb.id ? 'var(--coral-bright)' : 'var(--border-subtle)'}`, color: 'var(--text-primary)' }}>
            {tb.label}
          </button>
        ))}
      </div>

      {error && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {loading && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</p>}

      {/* Team */}
      {!loading && tab === 'team' && (
        engagements.length === 0 ? <div style={{ ...card, textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>{t('teamEmpty')}</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {engagements.map((e) => (
              <div key={e.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{e.freelancerName ?? e.freelancerUserId}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{t(`status.${e.status}`)}{e.rateCents != null ? ` · ${e.currency} ${(e.rateCents / 100).toFixed(0)}${t('perHour')}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" style={btn('ghost')} onClick={() => toggleDeliverables(e.id)}>{openDeliv === e.id ? t('hide') : tg('deliverables.heading')}</button>
                    <button type="button" style={btn('ghost')} onClick={() => { setRateFor(rateFor === e.id ? null : e.id); setReviewForm({ rating: 5, comment: '' }); }}>{t('rate')}</button>
                    <button type="button" style={btn('danger')} disabled={busy === e.id}
                      onClick={() => { if (confirm(t('terminateConfirm'))) void act(e.id, () => terminateEngagement(e.id)); }}>{busy === e.id ? '…' : t('terminate')}</button>
                  </div>
                </div>
                {openDeliv === e.id && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(deliverables[e.id] ?? []).length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tg('deliverables.empty')}</div> : (deliverables[e.id] ?? []).map((d) => {
                      const score = delivScores[d.id] ?? d.lastEvalOverall ?? null;
                      const decided = d.status === 'accepted' || d.status === 'changes_requested';
                      return (
                        <div key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{d.title}</span>
                              {score != null && <ScoreChip score={score} />}
                              {statusPill(d.status, tg(`deliverables.status.${d.status}`))}
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button type="button" style={btn('ghost')} disabled={busy === `de:${d.id}`} onClick={() => evalDeliverable(d.id)}>{busy === `de:${d.id}` ? tg('proposal.evaluating') : tg('deliverables.evaluate')}</button>
                              {!decided && <>
                                <button type="button" style={btn('primary')} disabled={busy === `ds:${d.id}`} onClick={() => decideDeliverable(e.id, d.id, 'accepted')}>{tg('deliverables.accept')}</button>
                                <button type="button" style={btn('ghost')} disabled={busy === `ds:${d.id}`} onClick={() => decideDeliverable(e.id, d.id, 'changes_requested')}>{tg('deliverables.requestChanges')}</button>
                              </>}
                            </div>
                          </div>
                          {d.body && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.body}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
                {rateFor === e.id && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" onClick={() => setReviewForm((r) => ({ ...r, rating: n }))} aria-label={`${n}`}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: n <= reviewForm.rating ? 'var(--warning-fg, #f59e0b)' : 'var(--border-subtle)' }}>★</button>
                      ))}
                    </div>
                    <textarea style={{ ...input, minHeight: 56, resize: 'vertical' }} placeholder={t('reviewComment')} value={reviewForm.comment} onChange={(ev) => setReviewForm((r) => ({ ...r, comment: ev.target.value }))} />
                    <div><button type="button" style={btn('primary')} disabled={busy === `rev:${e.id}`} onClick={() => submitReview(e.id)}>{t('submitReview')}</button></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* Jobs */}
      {!loading && tab === 'jobs' && (
        <>
          <div style={{ marginBottom: 14 }}>
            {showPost ? (
              <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input style={input} placeholder={t('job.titlePlaceholder')} value={job.title} onChange={(e) => setJob((j) => ({ ...j, title: e.target.value }))} />
                <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} placeholder={t('job.descPlaceholder')} value={job.description} onChange={(e) => setJob((j) => ({ ...j, description: e.target.value }))} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                  <select style={input} value={job.postingType} onChange={(e) => setJob((j) => { const postingType = e.target.value as PostingType; return { ...j, postingType, engagementType: postingType === 'fte' ? 'fte' : (j.engagementType === 'fte' ? 'fixed_bid' : j.engagementType) }; })}>
                    {POSTING_TYPES.map((v) => <option key={v} value={v}>{tg(`postingType.${v}`)}</option>)}
                  </select>
                  <select style={input} value={job.engagementType} disabled={job.postingType === 'fte'} onChange={(e) => setJob((j) => ({ ...j, engagementType: e.target.value as EngagementType }))}>
                    {ENGAGEMENT_TYPES.map((v) => <option key={v} value={v}>{tg(`engagementType.${v}`)}</option>)}
                  </select>
                </div>
                <textarea style={{ ...input, minHeight: 60, resize: 'vertical' }} placeholder={tg('publish.requirementsPlaceholder')} value={job.requirements} onChange={(e) => setJob((j) => ({ ...j, requirements: e.target.value }))} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                  <select style={input} value={job.discipline} onChange={(e) => setJob((j) => ({ ...j, discipline: e.target.value }))}>
                    <option value="">{t('job.discipline')}</option>
                    {DISCIPLINES.map((d) => <option key={d} value={d}>{td(`discipline.${d}`)}</option>)}
                  </select>
                  <input style={input} placeholder={t('job.rateMin')} type="number" min={0} value={job.rateMin} onChange={(e) => setJob((j) => ({ ...j, rateMin: e.target.value }))} />
                  <input style={input} placeholder={t('job.rateMax')} type="number" min={0} value={job.rateMax} onChange={(e) => setJob((j) => ({ ...j, rateMax: e.target.value }))} />
                </div>
                <input style={input} placeholder={t('job.skillsPlaceholder')} value={job.skills} onChange={(e) => setJob((j) => ({ ...j, skills: e.target.value }))} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" style={btn('primary')} disabled={busy === 'postjob' || !job.title.trim()} onClick={submitJob}>{t('job.post')}</button>
                  <button type="button" style={btn('ghost')} onClick={() => setShowPost(false)}>{t('cancelBtn')}</button>
                </div>
              </div>
            ) : (
              <button type="button" style={btn('primary')} onClick={() => setShowPost(true)}>{t('job.postNew')}</button>
            )}
          </div>
          {jobs.length === 0 ? <div style={{ ...card, textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>{t('job.empty')}</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {jobs.map((j) => (
                <div key={j.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{j.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{t(`job.status.${j.status}`)} · {t('job.proposals', { count: j.proposalCount ?? 0 })}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" style={btn('ghost')} onClick={() => toggleProposals(j.id)}>{openJob === j.id ? t('hide') : t('job.viewProposals')}</button>
                      {j.status === 'open' && <button type="button" style={btn('ghost')} disabled={busy === `close:${j.id}`} onClick={() => act(`close:${j.id}`, () => updateJob(j.id, { status: 'closed' }))}>{t('job.close')}</button>}
                    </div>
                  </div>
                  {openJob === j.id && (
                    <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {(proposals[j.id] ?? []).length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('job.noProposals')}</div> : (proposals[j.id] ?? []).map((p) => {
                        const isFte = j.postingType === 'fte';
                        const score = propScores[p.id] ?? p.lastEvalOverall ?? null;
                        const actionable = p.status === 'submitted' || p.status === 'shortlisted';
                        return (
                        <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{p.freelancerName}{p.rateCents != null ? ` · ${p.currency} ${(p.rateCents / 100).toFixed(0)}${t('perHour')}` : ''}</span>
                                {score != null && <ScoreChip score={score} />}
                                {p.status === 'shortlisted' && statusPill(p.status, tg(isFte ? 'candidate.shortlisted' : 'proposal.shortlisted'))}
                              </div>
                              {p.coverNote && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{p.coverNote}</div>}
                              {p.status === 'declined' && p.declineReason && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>{p.declineReason}</div>}
                            </div>
                            {actionable ? (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <button type="button" style={btn('ghost')} disabled={busy === `ev:${p.id}`} onClick={() => evalProposal(p.id)}>{busy === `ev:${p.id}` ? tg('proposal.evaluating') : tg('proposal.evaluate')}</button>
                                {p.status === 'submitted' && <button type="button" style={btn('ghost')} disabled={busy === `sl:${p.id}`} onClick={() => act(`sl:${p.id}`, () => shortlistProposal(p.id))}>{tg(isFte ? 'candidate.shortlist' : 'proposal.shortlist')}</button>}
                                <button type="button" style={btn('ghost')} disabled={busy === `mt:${j.id}`} onClick={() => doSchedule({ title: tg(isFte ? 'meeting.interviewTitle' : 'meeting.reviewTitle'), kind: isFte ? 'interview' : 'review', jobId: j.id })}>{tg(isFte ? 'meeting.scheduleInterview' : 'meeting.scheduleReview')}</button>
                                <button type="button" style={btn('primary')} disabled={busy === `pa:${p.id}`} onClick={() => act(`pa:${p.id}`, () => acceptProposal(p.id).then(() => undefined))}>{t('job.accept')}</button>
                                <button type="button" style={btn('ghost')} onClick={() => { setDeclineFor(declineFor === p.id ? null : p.id); setDeclineMsg(''); }}>{tg(isFte ? 'candidate.reject' : 'proposal.decline')}</button>
                              </div>
                            ) : statusPill(p.status, td(`status.${p.status}`))}
                          </div>
                          {declineFor === p.id && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
                              <textarea style={{ ...input, minHeight: 56, resize: 'vertical' }} placeholder={tg('proposal.declineReasonPlaceholder')} value={declineMsg} onChange={(e) => setDeclineMsg(e.target.value)} />
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button type="button" style={btn('danger')} disabled={busy === `pd:${p.id}`} onClick={() => submitDecline(p.id)}>{busy === `pd:${p.id}` ? '…' : tg('proposal.declineSend')}</button>
                                <button type="button" style={btn('ghost')} onClick={() => setDeclineFor(null)}>{t('cancelBtn')}</button>
                              </div>
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Timecards */}
      {!loading && tab === 'timecards' && (
        cards.length === 0 ? <div style={{ ...card, textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>{t('approvalsEmpty')}</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cards.map((tc) => (
              <div key={tc.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{tc.freelancerName ?? ''}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{tc.periodStart} – {tc.periodEnd} · {fmtHrs(tc.billableMinutes)} · {money(tc.amountCents, tc.currency)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button type="button" style={btn('ghost')} onClick={() => toggleReview(tc.id)}>{openCard === tc.id ? t('hide') : t('review')}</button>
                    {tc.status === 'submitted' ? (
                      <>
                        <button type="button" style={btn('ghost')} disabled={busy === tc.id} onClick={() => act(tc.id, () => rejectTimecard(tc.id))}>{t('reject')}</button>
                        <button type="button" style={btn('primary')} disabled={busy === tc.id} onClick={() => act(tc.id, () => approveTimecard(tc.id))}>{busy === tc.id ? '…' : t('approve')}</button>
                      </>
                    ) : statusPill(tc.status, t(`cardStatus.${tc.status}`))}
                  </div>
                </div>
                {openCard === tc.id && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                    {(entries[tc.id] ?? []).length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noEntries')}</div> : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {(entries[tc.id] ?? []).map((en) => (
                          <div key={en.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
                            <span>{en.workDate} · {t(`entrySource.${en.source}`)}{en.description ? ` · ${en.description}` : ''}</span>
                            <span style={{ color: en.billable ? 'var(--text-primary)' : 'var(--text-muted)' }}>{fmtHrs(en.minutes)}{en.billable ? '' : ` (${t('nonBillable')})`}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* Invoices */}
      {!loading && tab === 'invoices' && (
        invoices.length === 0 ? <div style={{ ...card, textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>{t('invoice.empty')}</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {invoices.map((inv) => (
              <div key={inv.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{inv.freelancerName ?? ''} · {money(inv.amountCents, inv.currency)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: inv.status === 'paid' ? 'rgba(34,197,94,0.14)' : 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: inv.status === 'paid' ? 'rgba(34,197,94,0.95)' : 'var(--text-secondary)' }}>{t(`invoice.status.${inv.status}`)}</span>
                  {inv.status === 'pending' && (
                    <button type="button" style={btn('primary')} disabled={busy === `pay:${inv.id}`} onClick={() => act(`pay:${inv.id}`, () => payInvoice(inv.id).then(() => undefined))}>{busy === `pay:${inv.id}` ? '…' : t('invoice.pay')}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </section>
  );
}

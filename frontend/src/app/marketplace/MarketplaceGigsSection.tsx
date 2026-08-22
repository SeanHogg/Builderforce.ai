'use client';

import { Icon } from '@/components/ui/Icon';
import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import NotificationsPanel from '@/components/freelance/NotificationsPanel';
import { GuestSignupCta } from '@/components/GuestSignupCta';
import { useAuth } from '@/lib/AuthContext';
import { listMyEngagements, respondEngagement, type Engagement } from '@/lib/freelance/engagements';
import { listMyInvites, respondToInvite, markInviteViewed, type JobInvite } from '@/lib/freelance/invites';
import { listSavedJobs, saveJob, unsaveJob } from '@/lib/freelance/jobSeeker';
import { listRecommendedJobs, type PostingMatch } from '@/lib/freelance/matching';
import { openJobAttachment, openMyProposalAttachment, uploadProposalAttachment, deleteProposalAttachment } from '@/lib/freelance/postingAttachments';
import { listJobs, getJob, bidJob, listMyProposals, withdrawProposal, type JobPosting, type JobProposal, type ScreeningQuestion } from '@/lib/freelance/postings';
import {
  ENGAGEMENT_TYPES, EXPERIENCE_LEVELS, JOB_DISCIPLINES, JOB_SPECIALTIES, PROJECT_LENGTHS,
  experienceKey, inviteStatusKey, projectLengthKey, specialtyKey,
} from '@/components/talent/jobVocabulary';
import { ScreeningAnswersForm, unansweredRequired } from '@/components/talent/ScreeningQuestionsEditor';
import { AttachmentsPanel } from '@/components/talent/AttachmentsPanel';
import { MatchScore, MatchSkills } from '@/components/talent/MatchScore';
import { JobAlertsPanel } from '@/components/freelance/JobAlertsPanel';
import { MilestoneLinesEditor, MilestoneLinesPreview } from '@/components/freelance/MilestoneSchedulePanel';
import type { MilestoneDraft, MilestoneRow } from '@/lib/milestonesApi';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import { useFormat } from "@/i18n/useFormat";

// The "Find work" surface (open jobs to bid on, my proposals, my engagements) is now
// a category of the marketplace rather than a standalone /freelancer/gigs page — same
// shared search box, one merged surface, matching the Talent + Models consolidation.
//
// TWO of the three reads are private, and the split matters. `GET /api/jobs` is a
// PUBLIC browse — open jobs are world-browsable, and hiding them behind a sign-in
// would make "find work" a catalogue of screenshots. `/jobs/proposals/mine` and
// `/engagements/mine` are behind the person-level JWT. Moving this surface into the
// public marketplace is what made that distinction load-bearing: a logged-out visitor
// picking the Gigs chip fired all three, and the `.catch(() => [])` on each hid the
// empty result while the transport still raised the global error toast and filed a
// support ticket. So the jobs list stays open to everyone and only the two tabs that
// are ABOUT the viewer ask for an account.

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 18,
};
const input: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)', padding: '7px 10px', fontSize: 13, outline: 'none',
};
/** One pill style for every skill / shape tag on this surface. */
const chip: React.CSSProperties = {
  fontSize: 'var(--font-size-eyebrow)', padding: '2px 8px', borderRadius: 'var(--radius-full)',
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)',
};

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  invited: { bg: 'rgba(59,130,246,0.12)', fg: 'rgba(59,130,246,0.95)' },
  interviewing: { bg: 'rgba(245,158,11,0.14)', fg: 'var(--warning-text, var(--warning))' },
  active: { bg: 'rgba(34,197,94,0.14)', fg: 'rgba(34,197,94,0.95)' },
  submitted: { bg: 'rgba(59,130,246,0.12)', fg: 'rgba(59,130,246,0.95)' },
  accepted: { bg: 'rgba(34,197,94,0.14)', fg: 'rgba(34,197,94,0.95)' },
  declined: { bg: 'var(--bg-elevated)', fg: 'var(--text-muted)' },
};

type Tab = 'work' | 'foryou' | 'invites' | 'saved' | 'proposals' | 'engagements' | 'alerts';

/** The server-side criteria this surface can narrow on. Kept as one object so the whole
 *  set travels to `listJobs` in a single call rather than as six independent states that
 *  can fire six overlapping requests. */
interface BrowseFilters {
  discipline: string;
  specialty: string;
  experienceLevel: string;
  projectLength: string;
  engagementType: string;
}

const NO_FILTERS: BrowseFilters = {
  discipline: '', specialty: '', experienceLevel: '', projectLength: '', engagementType: '',
};

const optionStyle: React.CSSProperties = { background: 'var(--bg-elevated)', color: 'var(--text-primary)' };

export default function MarketplaceGigsSection({ search }: { search: string }) {
  const { formatCents } = useMoneyFormat();
  const fmt = useFormat();
  const t = useTranslations('freelancer');
  const tm = useTranslations('milestones');
  // The category tree and the invitation vocabulary already have labels in `talent`, and
  // the engagement shapes in `gigs`. Reused rather than restated: a second translation of
  // "Fixed bid" is a second thing to keep in step across five catalogues.
  const tt = useTranslations('talent');
  const tg = useTranslations('gigs');
  const { isAuthenticated } = useAuth();
  const [tab, setTab] = useState<Tab>('work');
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [proposals, setProposals] = useState<JobProposal[]>([]);
  const [saved, setSaved] = useState<JobProposal[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [invites, setInvites] = useState<JobInvite[]>([]);
  const [recommended, setRecommended] = useState<PostingMatch[]>([]);
  const [filters, setFilters] = useState<BrowseFilters>(NO_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bidFor, setBidFor] = useState<string | null>(null);
  const [bid, setBid] = useState<{ note: string; rate: string }>({ note: '', rate: '' });
  // The bidder's COUNTER-PROPOSED schedule. Held here and sent with the bid, because
  // the proposal row does not exist until the bid lands — writing the lines first
  // would have nothing to attach them to.
  const [bidLines, setBidLines] = useState<MilestoneDraft[]>([]);
  // The posting's own published schedule, for the one job whose bid form is open.
  const [published, setPublished] = useState<MilestoneRow[] | null>(null);
  // The screening questions of the ONE posting being bid on, and this bidder's answers.
  // Read with the detail rather than carried on the cached browse projection: widening
  // that projection would mean invalidating the public cache on every question edit.
  const [screening, setScreening] = useState<ScreeningQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // The posting's own brief, for the job whose bid form is open.
  const [jobAttachments, setJobAttachments] = useState<JobPosting['attachments']>([]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // Open jobs for everyone; the two "mine" reads only when there is a token to
      // send. Asking for them signed-out is not a read that comes back empty — it is
      // a 401 that files a support ticket about somebody who is only browsing.
      const [j, p, e, sv, inv, rec] = await Promise.all([
        listJobs(filters).catch(() => []),
        isAuthenticated ? listMyProposals().catch(() => []) : Promise.resolve([]),
        isAuthenticated ? listMyEngagements().catch(() => []) : Promise.resolve([]),
        isAuthenticated ? listSavedJobs().catch(() => []) : Promise.resolve([]),
        // Two more reads that are ABOUT THE VIEWER, so they follow the same rule as
        // proposals and engagements: never fired without a token. A logged-out visitor
        // picking the Gigs chip must not trip a 401 that files a support ticket.
        isAuthenticated ? listMyInvites().catch(() => []) : Promise.resolve([]),
        isAuthenticated ? listRecommendedJobs().catch(() => []) : Promise.resolve([]),
      ]);
      setJobs(j); setProposals(p); setEngagements(e); setSaved(sv);
      setInvites(inv); setRecommended(rec);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, filters]);

  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(null); }
  };

  /**
   * Open the bid form for one posting.
   *
   * The browse list is a cached public projection and deliberately carries no schedules
   * — widening it would mean invalidating that cache on every milestone edit for a panel
   * most visitors never open. So the terms are read for the ONE job being bid on, and
   * the editor is SEEDED from them: a counter-offer starts as the published schedule,
   * because most bidders agree with most of it and retyping it from memory is how the
   * two sides end up describing different work.
   */
  const openBid = async (job: JobPosting) => {
    setBidFor(job.id); setBid({ note: '', rate: '' }); setBidLines([]); setPublished(null);
    setScreening([]); setAnswers({}); setJobAttachments([]);
    try {
      const detail = await getJob(job.id);
      // The screening questions and the brief come from the DETAIL read for the one job
      // being bid on. Both are part of the offer and neither is on the cached browse
      // projection, so they are fetched when they are about to be used.
      const questions = detail.screeningQuestions ?? [];
      setScreening(questions);
      setJobAttachments(detail.attachments ?? []);
      // Seeded from what this bidder already answered, so revising a bid is an edit and
      // not a re-application.
      setAnswers(Object.fromEntries((detail.myProposal?.id ? proposals : [])
        .filter((row) => row.jobId === job.id)
        .flatMap((row) => (row.screeningAnswers ?? []).map((a) => [a.questionId, a.answer]))));
      if (job.engagementType !== 'fixed_bid') return;
      const posting = detail.milestones ?? [];
      setPublished(posting);
      // A revision starts from what THIS bidder already proposed; a first bid starts from
      // the posting's published terms. Either way the editor opens on something real, so a
      // schedule is edited rather than retyped from memory.
      const mine = detail.myProposal?.milestones ?? [];
      const seed = mine.length > 0 ? mine : posting;
      setBidLines(seed.map((line) => ({ title: line.title, description: line.description, amountCents: line.amountCents, dueAt: line.dueAt })));
    } catch { /* a schedule we could not read is one the bidder simply authors themselves */ }
  };

  const submitBid = async (jobId: string) => {
    setBusy(`bid:${jobId}`); setError(null);
    try {
      await bidJob(jobId, {
        coverNote: bid.note || undefined,
        rateCents: bid.rate ? Math.round(parseFloat(bid.rate) * 100) : undefined,
        // Blank lines are dropped rather than refused: a half-typed extra row must not
        // lose somebody the proposal they wrote.
        milestones: bidLines.filter((line) => line.title.trim() && line.amountCents > 0),
        screeningAnswers: Object.entries(answers)
          .filter(([, answer]) => answer.trim())
          .map(([questionId, answer]) => ({ questionId, answer })),
      });
      setBidFor(null); setBid({ note: '', rate: '' }); setBidLines([]); setPublished(null);
      setScreening([]); setAnswers({});
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  };

  /**
   * What a posting costs, in the unit its SHAPE implies.
   *
   * Hourly work shows the per-hour band; fixed-price work shows the whole-job total. The
   * same integer means opposite things in the two, so the label is never omitted and the
   * two are never merged into one number (see migration 0985).
   */
  const priceLabel = (job: Pick<JobPosting, 'rateMinCents' | 'rateMaxCents' | 'budgetTotalCents' | 'currency' | 'engagementType'>) => {
    const f = (c: number) => (c / 100).toFixed(0);
    const cur = job.currency;
    if (job.engagementType !== 'hourly' && job.budgetTotalCents != null) {
      return t('jobs.budgetTotal', { amount: `${cur} ${f(job.budgetTotalCents)}` });
    }
    const min = job.rateMinCents;
    const max = job.rateMaxCents;
    if (min == null && max == null) return '';
    const band = min != null && max != null ? `${cur} ${f(min)}–${f(max)}` : `${cur} ${f((min ?? max)!)}`;
    return job.engagementType === 'hourly' ? t('jobs.rateBand', { amount: band }) : band;
  };

  /** Invitations still awaiting an answer. `expired` is projected by the server from the
   *  deadline and the clock, so this list can never offer an action the API would refuse. */
  const liveInvites = invites.filter((invite) => invite.status === 'sent' || invite.status === 'viewed');

  /** Accept or decline. Accepting returns the proposal it OPENED, so the next thing the
   *  bidder sees is the bid form on that posting — an invite that lands inside the flow
   *  rather than at a dead end. */
  const answerInvite = async (invite: JobInvite, accept: boolean) => {
    setBusy(`invite:${invite.id}`); setError(null);
    try {
      await respondToInvite(invite.id, accept);
      await load();
      if (accept) {
        const job = jobs.find((entry) => entry.id === invite.jobId);
        setTab('work');
        if (job) await openBid(job);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
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
    { id: 'foryou', label: t('gigs.tabForYou') },
    // The count is on the tab because an invitation that expires unseen is the failure
    // this whole feature exists to prevent.
    { id: 'invites', label: liveInvites.length > 0 ? `${t('gigs.tabInvites')} (${liveInvites.length})` : t('gigs.tabInvites') },
    { id: 'saved', label: t('gigs.tabSaved') },
    { id: 'proposals', label: t('gigs.tabProposals') },
    { id: 'engagements', label: t('gigs.tabEngagements') },
    { id: 'alerts', label: t('gigs.tabAlerts') },
  ];

  /** Ids the seeker shortlisted — drives the save toggle on every job card. */
  const savedIds = new Set(saved.map((row) => String(row.jobId)));
  const filteredSaved = q
    ? saved.filter((row) => (row.jobTitle ?? '').toLowerCase().includes(q))
    : saved;

  const pill = (s: string) => {
    const c = STATUS_COLORS[s] ?? { bg: 'var(--bg-elevated)', fg: 'var(--text-muted)' };
    return <span style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, padding: '3px 9px', borderRadius: 'var(--radius-sm)', background: c.bg, color: c.fg, flexShrink: 0 }}>{t(`status.${s}`)}</span>;
  };

  /** The two tabs that are about the VIEWER rather than about the work on offer. */
  const guestWall = !isAuthenticated && tab !== 'work' ? (
    <GuestSignupCta
      prompt={{ next: '/marketplace?category=gigs' }}
      title={t('gigs.signedOutTitle')}
      body={t('gigs.signedOutBody')}
    />
  ) : null;

  return (
    <div>
      {/* Self-gating: renders nothing, and polls nothing, without a token. */}
      <NotificationsPanel />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((tb) => (
          <button key={tb.id} type="button" onClick={() => setTab(tb.id)}
            style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer',
              background: tab === tb.id ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
              border: `1px solid ${tab === tb.id ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
              color: 'var(--text-primary)' }}>
            {tb.label}
          </button>
        ))}
      </div>

      {error && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)', marginBottom: 16 }}>{error}</div>}
      {loading && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('loading')}</p>}

      {/* An account, not an empty list — the two private tabs have nothing to show a
          visitor who has none, and "no proposals" would be a lie rather than a state. */}
      {guestWall}

      {/* The criteria the SERVER narrows on. Distinct from the marketplace's shared search
          box, which filters the loaded page in memory: these five go into the query, so a
          board of two hundred postings can be cut down before it is sent. They are the
          same criteria a job ALERT saves, evaluated by the same spec (`jobFilters.ts`),
          which is what stops an alert disagreeing with the board it was set from. */}
      {tab === 'work' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <select style={input} aria-label={t('jobs.filterDiscipline')} value={filters.discipline}
            onChange={(e) => setFilters((f) => ({ ...f, discipline: e.target.value, specialty: '' }))}>
            <option value="" style={optionStyle}>{t('jobs.filterDiscipline')}</option>
            {JOB_DISCIPLINES.map((value) => <option key={value} value={value} style={optionStyle}>{t(`discipline.${value}`)}</option>)}
          </select>
          {filters.discipline && (JOB_SPECIALTIES[filters.discipline] ?? []).length > 0 && (
            <select style={input} aria-label={t('jobs.filterSpecialty')} value={filters.specialty}
              onChange={(e) => setFilters((f) => ({ ...f, specialty: e.target.value }))}>
              <option value="" style={optionStyle}>{t('jobs.filterSpecialty')}</option>
              {(JOB_SPECIALTIES[filters.discipline] ?? []).map((value) => (
                <option key={value} value={value} style={optionStyle}>{tt(specialtyKey(value))}</option>
              ))}
            </select>
          )}
          <select style={input} aria-label={t('jobs.filterExperience')} value={filters.experienceLevel}
            onChange={(e) => setFilters((f) => ({ ...f, experienceLevel: e.target.value }))}>
            <option value="" style={optionStyle}>{t('jobs.filterExperience')}</option>
            {EXPERIENCE_LEVELS.map((value) => <option key={value} value={value} style={optionStyle}>{t(experienceKey(value))}</option>)}
          </select>
          <select style={input} aria-label={t('jobs.filterLength')} value={filters.projectLength}
            onChange={(e) => setFilters((f) => ({ ...f, projectLength: e.target.value }))}>
            <option value="" style={optionStyle}>{t('jobs.filterLength')}</option>
            {PROJECT_LENGTHS.map((value) => <option key={value} value={value} style={optionStyle}>{t(projectLengthKey(value))}</option>)}
          </select>
          <select style={input} aria-label={t('jobs.filterEngagement')} value={filters.engagementType}
            onChange={(e) => setFilters((f) => ({ ...f, engagementType: e.target.value }))}>
            <option value="" style={optionStyle}>{t('jobs.filterEngagement')}</option>
            {ENGAGEMENT_TYPES.map((value) => <option key={value} value={value} style={optionStyle}>{tg(`engagementType.${value}`)}</option>)}
          </select>
          {(filters.discipline || filters.specialty || filters.experienceLevel || filters.projectLength || filters.engagementType) && (
            <button type="button" onClick={() => setFilters(NO_FILTERS)}
              style={{ padding: '7px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer' }}>
              {t('jobs.filterClear')}
            </button>
          )}
        </div>
      )}

      {/* Open jobs to bid on */}
      {!loading && tab === 'work' && (
        filteredJobs.length === 0 ? <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('jobs.emptyOpen')}</div> : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
            {filteredJobs.map((j) => (
              <div key={j.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)' }}>{j.title}</div>
                  {j.myProposal && pill(j.myProposal.status)}
                </div>
                <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>{j.tenantName} · {priceLabel(j)}</span>
                  {j.clientRating != null && (j.clientRatingCount ?? 0) > 0 && (
                    <span title={t('gigs.clientRatingTip')} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--warning-text, var(--warning))', fontWeight: 600 }}><Icon source="★" size="1em" /> {j.clientRating.toFixed(1)} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({j.clientRatingCount})</span></span>
                  )}
                </div>
                {j.description && <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', marginTop: 8, maxHeight: 60, overflow: 'hidden' }}>{j.description}</p>}

                {/* The SHAPE of the work, which is what a bidder screens on before they
                    read a word of the description. */}
                {(j.experienceLevel || j.projectLength || j.specialty) && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {j.specialty && <span style={chip}>{tt(specialtyKey(j.specialty))}</span>}
                    {j.experienceLevel && <span style={chip}>{t(experienceKey(j.experienceLevel))}</span>}
                    {j.projectLength && <span style={chip}>{t(projectLengthKey(j.projectLength))}</span>}
                  </div>
                )}

                {j.skills.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {j.skills.slice(0, 5).map((s) => <span key={s} style={chip}>{s}</span>)}
                  </div>
                )}
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {/* Shortlisting is available to anyone signed in, including before
                      they are ready to bid — which is the whole point of a shortlist. */}
                  {isAuthenticated && !j.myProposal && (
                    <button type="button" disabled={busy === `save:${j.id}`}
                      aria-pressed={savedIds.has(j.id)}
                      onClick={() => act(`save:${j.id}`, () => (savedIds.has(j.id) ? unsaveJob(j.id) : saveJob(j.id)))}
                      title={savedIds.has(j.id) ? t('jobs.unsave') : t('jobs.save')}
                      style={{ padding: '7px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                        border: `1px solid ${savedIds.has(j.id) ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                        background: savedIds.has(j.id) ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
                        color: savedIds.has(j.id) ? 'var(--coral-bright)' : 'var(--text-secondary)',
                        fontSize: 'var(--font-size-small)', fontWeight: 600 }}>
                      {savedIds.has(j.id) ? t('jobs.saved') : t('jobs.save')}
                    </button>
                  )}
                  {j.myProposal && bidFor !== j.id ? (
                    <>
                      <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('jobs.alreadyBid')}</span>
                      {/* Revising is the SAME upsert that made the bid, so the form is the
                          same form — seeded from what was already proposed rather than
                          blank, because a revision is an edit and not a re-application. */}
                      {(j.myProposal.status === 'submitted' || j.myProposal.status === 'shortlisted') && (
                        <button type="button" onClick={() => void openBid(j)}
                          style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer' }}>
                          {t('jobs.reviseBid')}
                        </button>
                      )}
                    </>
                  ) : bidFor === j.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {/* The client's brief, read-only. A bid priced without the spec is a
                          bid on a different job, so these are as available to a bidder as
                          the description is. */}
                      {(jobAttachments ?? []).length > 0 && (
                        <AttachmentsPanel
                          attachments={jobAttachments ?? []}
                          readOnly
                          onOpen={(attachmentId) => openJobAttachment(j.id, attachmentId)}
                        />
                      )}
                      <input style={input} placeholder={t('jobs.yourRate')} type="number" min={0} value={bid.rate} onChange={(e) => setBid((b) => ({ ...b, rate: e.target.value }))} />
                      <textarea style={{ ...input, minHeight: 60, resize: 'vertical' }} placeholder={t('jobs.coverNote')} value={bid.note} onChange={(e) => setBid((b) => ({ ...b, note: e.target.value }))} />
                      <ScreeningAnswersForm questions={screening} answers={answers} onChange={setAnswers} />
                      {/* Counter-propose the deliverables. Only offered on fixed-price
                          work: an hourly engagement is transacted through timecards and
                          has no schedule to disagree with. */}
                      {j.engagementType === 'fixed_bid' && (
                        <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 10 }}>
                          {(published?.length ?? 0) > 0 && (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>{tm('posting.published')}</div>
                              <MilestoneLinesPreview milestones={published ?? []} />
                            </div>
                          )}
                          <div style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>{tm('proposed.yours')}</div>
                          <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '0 0 8px' }}>{tm('proposed.explainer')}</p>
                          <MilestoneLinesEditor lines={bidLines} onChange={setBidLines} currency={j.currency} />
                        </div>
                      )}
                      {/* Work samples hang off the PROPOSAL, so they can only be attached
                          once the row exists — i.e. after a first submit. Offered here on a
                          revision rather than hidden away on another screen. */}
                      {j.myProposal?.id && (
                        <AttachmentsPanel
                          attachments={proposals.find((row) => row.id === j.myProposal?.id)?.attachments ?? []}
                          onOpen={(attachmentId) => openMyProposalAttachment(j.myProposal!.id, attachmentId)}
                          onUpload={async (file) => { await uploadProposalAttachment(j.myProposal!.id, file); await load(); }}
                          onRemove={async (attachmentId) => { await deleteProposalAttachment(j.myProposal!.id, attachmentId); await load(); }}
                        />
                      )}
                      {unansweredRequired(screening, answers).length > 0 && (
                        <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--coral-bright)' }}>
                          {t('jobs.screeningMissing', { count: unansweredRequired(screening, answers).length })}
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" onClick={() => submitBid(j.id)} disabled={busy === `bid:${j.id}` || unansweredRequired(screening, answers).length > 0}
                          style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: 'var(--text-on-accent)', fontSize: 'var(--font-size-small)', fontWeight: 700, cursor: 'pointer' }}>{t('jobs.submitBid')}</button>
                        <button type="button" onClick={() => setBidFor(null)} style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer' }}>{t('cancel')}</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => void openBid(j)}
                      style={{ padding: '7px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--coral-bright)', background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)', fontWeight: 700, cursor: 'pointer' }}>{t('jobs.bid')}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Invitations addressed to me. The reason `job_invites` is a row and not a
          notification: accepting one opens the proposal and drops the bidder straight into
          the bid form on that posting. */}
      {!loading && !guestWall && tab === 'invites' && (
        invites.length === 0
          ? <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('gigs.invitesEmpty')}</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {invites.map((invite) => (
                <div key={invite.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{invite.jobTitle ?? '—'}</div>
                    <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 4 }}>
                      {invite.tenantName} · {tt(inviteStatusKey(invite.status))}
                      {invite.expiresAt && (invite.status === 'sent' || invite.status === 'viewed') && ` · ${tt('invite.expires', { date: fmt.date(invite.expiresAt) })}`}
                    </div>
                    {invite.message && (
                      <p style={{ margin: '8px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', fontStyle: 'italic' }}>{invite.message}</p>
                    )}
                  </div>
                  {(invite.status === 'sent' || invite.status === 'viewed') ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" disabled={busy === `invite:${invite.id}`}
                        onClick={() => { void markInviteViewed(invite.id); void answerInvite(invite, true); }}
                        style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: 'var(--text-on-accent)', fontSize: 'var(--font-size-small)', fontWeight: 700, cursor: 'pointer' }}>
                        {t('gigs.inviteAccept')}
                      </button>
                      <button type="button" disabled={busy === `invite:${invite.id}`}
                        onClick={() => void answerInvite(invite, false)}
                        style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer' }}>
                        {t('gigs.inviteDecline')}
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{tt(inviteStatusKey(invite.status))}</span>
                  )}
                </div>
              ))}
            </div>
          )
      )}

      {/* The cached match query, seeker direction. Ranked against this person's own
          for-hire profile, with the evidence shown — a score nobody can check is worth
          less than no score. */}
      {!loading && !guestWall && tab === 'foryou' && (
        recommended.length === 0
          ? <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('gigs.forYouEmpty')}</div>
          : (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
              {recommended.map((match) => (
                <div key={match.id} style={card}>
                  <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{match.title}</div>
                  <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '4px 0 8px' }}>
                    {match.tenantName} · {priceLabel(match)}
                  </div>
                  <MatchScore score={match.score} reasons={match.reasons} />
                  <MatchSkills matched={match.matchedSkills} missing={match.missingSkills} />
                  <button type="button"
                    onClick={() => {
                      // The board is the surface that can actually take a bid, so the
                      // recommendation hands off to it rather than growing a second bid form.
                      const job = jobs.find((entry) => entry.id === match.id);
                      setTab('work');
                      if (job) void openBid(job);
                    }}
                    style={{ marginTop: 12, padding: '7px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--coral-bright)', background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)', fontWeight: 700, cursor: 'pointer' }}>
                    {t('jobs.bid')}
                  </button>
                </div>
              ))}
            </div>
          )
      )}

      {/* Shortlisted jobs */}
      {!loading && !guestWall && tab === 'saved' && (
        filteredSaved.length === 0
          ? <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('jobs.emptySaved')}</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredSaved.map((row) => (
                <div key={row.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)' }}>{row.jobTitle ?? '—'}</div>
                    <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 4 }}>{t('jobs.savedOn', { date: row.createdAt ? fmt.date(row.createdAt) : '—' })}</div>
                  </div>
                  <button type="button" disabled={busy === `unsave:${row.jobId}`}
                    onClick={() => act(`unsave:${row.jobId}`, () => unsaveJob(String(row.jobId)))}
                    style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer' }}>
                    {t('jobs.unsave')}
                  </button>
                </div>
              ))}
            </div>
          )
      )}

      {/* Standing searches. Self-contained: it owns its own reads and writes. */}
      {!loading && !guestWall && tab === 'alerts' && <JobAlertsPanel />}

      {/* My proposals */}
      {!loading && !guestWall && tab === 'proposals' && (
        filteredProposals.length === 0 ? <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('proposals.empty')}</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredProposals.map((p) => (
              <div key={p.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-primary)' }}>{p.jobTitle}</div>
                  {p.rateCents != null && <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 2 }}>{formatCents(p.rateCents, { currency: p.currency, maximumFractionDigits: 0 })}{t('perHour')}</div>}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {pill(p.status)}
                  {(p.status === 'submitted' || p.status === 'shortlisted') && (
                    <button type="button" onClick={() => act(`wd:${p.id}`, () => withdrawProposal(p.id))} disabled={busy === `wd:${p.id}`}
                      style={{ padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer' }}>{t('proposals.withdraw')}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Engagements + accept/decline */}
      {!loading && !guestWall && tab === 'engagements' && (
        filteredEngagements.length === 0 ? <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('gigs.empty')}</div> : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
            {filteredEngagements.map((e) => (
              <div key={e.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)' }}>{e.tenantName ?? t('gigs.workspace')}</div>
                  {pill(e.status)}
                </div>
                {e.title && <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', marginBottom: 6 }}>{e.title}</div>}
                <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('gigs.rate')}: <strong style={{ color: 'var(--text-primary)' }}>{e.rateCents != null ? `${formatCents(e.rateCents, { currency: e.currency, maximumFractionDigits: 0 })}/hr` : '—'}</strong></div>
                {(e.status === 'invited' || e.status === 'interviewing') && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button type="button" onClick={() => act(`acc:${e.id}`, () => respondEngagement(e.id, true))} disabled={busy === `acc:${e.id}`}
                      style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: 'var(--text-on-accent)', fontSize: 'var(--font-size-small)', fontWeight: 700, cursor: 'pointer' }}>{t('gigs.accept')}</button>
                    <button type="button" onClick={() => act(`dec:${e.id}`, () => respondEngagement(e.id, false))} disabled={busy === `dec:${e.id}`}
                      style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer' }}>{t('gigs.decline')}</button>
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

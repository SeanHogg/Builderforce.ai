'use client';

/**
 * The CLIENT-SIDE talent operations, in one place.
 *
 * ── WHY ONE PAGE AND NOT FOUR ───────────────────────────────────────────────────
 * Shortlisting somebody, inviting them to a posting, reading who else the match query
 * suggests, and reading how the bids that came back actually scored are four views of ONE
 * hiring decision. Split across four routes they become four lists nobody finishes: the
 * client picks a posting on one page, loses it on the next, and re-picks it on the third.
 * So the posting is chosen ONCE, at the top, and everything below is about that choice.
 *
 * The shortlist is the exception and sits above the picker — it is about PEOPLE and
 * survives every posting, which is the whole reason it exists as a durable join rather
 * than as a filter on a search.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import PageContainer from '@/components/PageContainer';
import { ShortlistPanel } from '@/components/talent/ShortlistPanel';
import { TalentRecommendations } from '@/components/talent/TalentRecommendations';
import { JobInvitesPanel } from '@/components/talent/JobInvitesPanel';
import { ProposalEvalLensPanel } from '@/components/talent/ProposalEvalLensPanel';
import { inviteToJob } from '@/lib/freelance/invites';
import { listMyJobs, type JobPosting } from '@/lib/freelance/postings';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)', padding: 16, minWidth: 0,
};

const selectStyle: React.CSSProperties = {
  width: '100%', maxWidth: 420, boxSizing: 'border-box', padding: '8px 10px',
  fontSize: 'var(--font-size-body)', borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
};

type Section = 'recommendations' | 'invites' | 'evaluations';

export default function ShortlistClient() {
  const t = useTranslations('talent');
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [jobId, setJobId] = useState<string>('');
  const [section, setSection] = useState<Section>('recommendations');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const mine = await listMyJobs();
      // Only OPEN postings can be invited to — the API refuses an invite to a filled one
      // rather than promising a bid that could never be accepted, so the picker says so
      // before the click instead of after it.
      const open = mine.filter((job) => job.status === 'open');
      setJobs(open);
      setJobId((current) => current || (open[0]?.id ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shortlist.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => jobs.find((job) => job.id === jobId) ?? null, [jobs, jobId]);

  /** Invite straight off the shortlist, onto whichever posting is selected. */
  const inviteFromShortlist = async (freelancerUserId: string) => {
    if (!jobId) { setError(t('invite.pickJobFirst')); return; }
    setError(null);
    setNotice(null);
    try {
      await inviteToJob(jobId, { freelancerUserId });
      setNotice(t('invite.sentNotice'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('invite.failed'));
    }
  };

  const SECTIONS: Array<{ id: Section; label: string }> = [
    { id: 'recommendations', label: t('tabs.recommendations') },
    { id: 'invites', label: t('tabs.invites') },
    { id: 'evaluations', label: t('tabs.evaluations') },
  ];

  return (
    <PageContainer width="full" style={{ padding: 'clamp(20px, 5vw, 32px)' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>
          {t('shortlist.pageTitle')}
        </h1>
        <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: 0, maxWidth: '65ch' }}>
          {t('shortlist.pageSubtitle')}
        </p>
      </div>

      {error && <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 'var(--font-size-body)', marginBottom: 14 }}>{error}</div>}
      {notice && <div style={{ ...cardStyle, color: 'var(--text-primary)', fontSize: 'var(--font-size-body)', marginBottom: 14 }}>{notice}</div>}

      <section style={{ marginBottom: 28 }}>
        <ShortlistPanel onInvite={(entry) => void inviteFromShortlist(entry.freelancerUserId)} />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label htmlFor="talent-ops-job" style={{ display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
            {t('shortlist.jobLabel')}
          </label>
          {loading ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', margin: 0 }}>{t('shortlist.loading')}</p>
          ) : jobs.length === 0 ? (
            <div style={{ ...cardStyle, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
              {t('shortlist.noOpenJobs')}{' '}
              <Link href="/marketplace/publish-gig" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                {t('shortlist.publishOne')}
              </Link>
            </div>
          ) : (
            <select id="talent-ops-job" style={selectStyle} value={jobId} onChange={(e) => setJobId(e.target.value)}>
              {jobs.map((job) => (
                // A native <option> needs its OWN opaque background and colour — one that
                // inherits only the wrapper's is unreadable in one of the themes.
                <option key={job.id} value={job.id} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                  {job.title}
                </option>
              ))}
            </select>
          )}
        </div>

        {selected && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SECTIONS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSection(entry.id)}
                  style={{
                    padding: '7px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                    fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)',
                    background: section === entry.id ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
                    border: `1px solid ${section === entry.id ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {section === 'recommendations' && <TalentRecommendations key={`rec-${selected.id}`} jobId={selected.id} />}
            {section === 'invites' && <JobInvitesPanel key={`inv-${selected.id}`} jobId={selected.id} />}
            {section === 'evaluations' && <ProposalEvalLensPanel key={`eval-${selected.id}`} jobId={selected.id} />}
          </>
        )}
      </section>
    </PageContainer>
  );
}

'use client';

/**
 * "Publish a listing" under Talent → Gigs — a BOARD PICKER, not a form.
 *
 * ── WHY A PICKER ─────────────────────────────────────────────────────────────
 * The storefront's publish CTA used to open the skill form for every chip it had
 * no route for, so Talent offered slug/version/repo fields that describe neither
 * a freelancer nor a gig. The person half was a route lookup (`/freelancer/profile`
 * — the `available_for_hire` opt-in). The gig half was not: `POST
 * /api/marketplace/publish` publishes a gig FROM AN EXISTING TICKET and derives
 * the title, the description and the requirements from it, so there is no "post a
 * gig" page to point at and never was.
 *
 * The honest CTA is therefore this: choose the work. A form that re-collected a
 * title and a description would be asking somebody to retype what a ticket
 * already says, and the two copies would immediately disagree.
 *
 * ── WHAT PUBLISHING ACTUALLY DOES ────────────────────────────────────────────
 * Marks the ticket `hireable` and mints (or reopens) its one job posting. A
 * ticket owns ONE posting identity for its whole life — re-publishing a closed
 * one reopens that row rather than minting a replacement, so proposals and
 * history are never orphaned. The page says so before the click, because "publish"
 * on a ticket somebody published last quarter is not obviously the same act.
 *
 * ── WHAT THE FORM ADDS, AND WHAT IT STILL REFUSES TO ASK (0985) ──────────────
 * The picker's argument stands: the title, the description and the requirements come
 * from the ticket, and re-collecting them would be asking somebody to retype what a
 * board already says. Everything below is the opposite kind of fact — the TERMS, which
 * exist nowhere on a ticket and which a freelancer cannot bid sensibly without: the
 * money, the seniority, the expected length, the sub-category, and the questions every
 * bidder is asked.
 *
 * The money field follows the SHAPE. Hourly work asks for a rate band; fixed-price work
 * asks for a whole-job total. They are different quantities in different units — the same
 * integer means opposite things in each — so the form never shows both, and the API
 * refuses a total on hourly work rather than storing a number whose unit contradicts the
 * posting (see migration 0985).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { tasksApi, gigMarketplaceApi, type Task } from '@/lib/builderforceApi';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import PageContainer from '@/components/PageContainer';
import {
  ENGAGEMENT_TYPES, EXPERIENCE_LEVELS, JOB_DISCIPLINES, JOB_SPECIALTIES, PROJECT_LENGTHS,
  experienceKey, projectLengthKey, specialtyKey,
} from '@/components/talent/jobVocabulary';
import { ScreeningQuestionsEditor, type ScreeningQuestionDraft } from '@/components/talent/ScreeningQuestionsEditor';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
  minWidth: 0,
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 380,
  boxSizing: 'border-box',
  padding: '8px 10px',
  fontSize: 'var(--font-size-body)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
};

const primaryButton: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 'var(--font-size-body)',
  fontWeight: 600,
  borderRadius: 'var(--radius-md)',
  background: 'var(--accent-strong, var(--surface-interactive))',
  color: 'var(--text-on-accent, var(--text-primary))',
  border: '1px solid var(--border-subtle)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/** Work that is finished, cancelled or already someone's problem is not work to
 *  hire for. A closed lane on a board is not a gig. */
const CLOSED_LANES = new Set(['done', 'closed', 'cancelled', 'archived']);

/** The terms a posting carries beyond what its ticket already says. */
interface PostingTerms {
  postingType: string;
  engagementType: string;
  discipline: string;
  specialty: string;
  experienceLevel: string;
  projectLength: string;
  visibility: 'public' | 'private';
  /** Whole-job total, in major units as typed. Fixed-price and FTE only. */
  budgetTotal: string;
  /** Per-hour band, in major units as typed. Hourly only. */
  rateMin: string;
  rateMax: string;
  screeningQuestions: ScreeningQuestionDraft[];
}

const DEFAULT_TERMS: PostingTerms = {
  postingType: 'project_bid',
  engagementType: 'fixed_bid',
  discipline: '',
  specialty: '',
  experienceLevel: '',
  projectLength: '',
  visibility: 'public',
  budgetTotal: '',
  rateMin: '',
  rateMax: '',
  screeningQuestions: [],
};

/** Major units as typed -> integer cents, or undefined when the field is blank. Blank is
 *  "not stated", which is a different instruction from zero. */
const toCents = (value: string): number | undefined => {
  const parsed = parseFloat(value);
  return value.trim() && Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : undefined;
};

const fieldStyle: React.CSSProperties = {
  width: '100%', maxWidth: 380, boxSizing: 'border-box', padding: '8px 10px',
  fontSize: 'var(--font-size-body)', borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
};

const optionStyle: React.CSSProperties = { background: 'var(--bg-elevated)', color: 'var(--text-primary)' };

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: 6,
};

export default function PublishGigClient() {
  const t = useTranslations('publishGig');
  // The posting-type / engagement-type / visibility vocabularies already have labels in
  // the `gigs` namespace (the board's publish modal renders the same three lists), and
  // the discipline + specialty tree in `talent`. Reused rather than restated: a second
  // translation of "Fixed bid" is a second thing to keep in step across five catalogues.
  const tg = useTranslations('gigs');
  const tt = useTranslations('talent');
  const tf = useTranslations('freelancer');
  const scope = useOptionalProjectScope();

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(scope?.currentProjectId ?? null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState<number | null>(null);
  const [published, setPublished] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState<PostingTerms>(DEFAULT_TERMS);
  const [showTerms, setShowTerms] = useState(false);

  const patchTerms = (change: Partial<PostingTerms>) => setTerms((current) => ({ ...current, ...change }));

  /** Hourly work is priced as a band; everything else as a whole-job total. */
  const hourly = terms.engagementType === 'hourly';
  const specialties = terms.discipline ? (JOB_SPECIALTIES[terms.discipline] ?? []) : [];

  useEffect(() => {
    fetchProjects()
      .then((list) => {
        setProjects(list);
        setProjectId((current) => current ?? (list[0] ? Number(list[0].id) : null));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const loadTasks = useCallback(async () => {
    if (projectId == null) { setTasks([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      setTasks(await tasksApi.list(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  /** Open work only, and never a GAP or a SECURITY ticket — one is a defect
   *  found in our own delivery and the other is redacted from the person looking
   *  at it, so neither is something to offer a stranger. */
  const publishable = useMemo(
    () => tasks.filter((task) => (
      !CLOSED_LANES.has(task.status.toLowerCase())
      && task.taskType !== 'gap'
      && task.taskType !== 'security'
      && !task.restricted
    )),
    [tasks],
  );

  const publish = async (task: Task) => {
    setPublishing(task.id);
    setError(null);
    try {
      const result = await gigMarketplaceApi.publish({
        ticketId: task.id,
        postingType: terms.postingType,
        engagementType: terms.engagementType,
        visibility: terms.visibility,
        discipline: terms.discipline || undefined,
        specialty: terms.specialty || undefined,
        experienceLevel: terms.experienceLevel || undefined,
        projectLength: terms.projectLength || undefined,
        // Exactly ONE of the two shapes of money is ever sent, decided by the engagement
        // type. Sending both would leave the posting saying two things about its price.
        rateMinCents: hourly ? toCents(terms.rateMin) : undefined,
        rateMaxCents: hourly ? toCents(terms.rateMax) : undefined,
        budgetTotalCents: hourly ? undefined : toCents(terms.budgetTotal),
        screeningQuestions: terms.screeningQuestions
          .filter((question) => question.prompt.trim())
          .map((question) => ({ ...question, prompt: question.prompt.trim() })),
      });
      setPublished((prev) => ({ ...prev, [task.id]: result.jobId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(null);
    }
  };

  return (
    <PageContainer width="readable" style={{ padding: 'clamp(20px, 5vw, 32px)' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: 0, maxWidth: '65ch' }}>{t('subtitle')}</p>
      </div>

      {error && (
        <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 'var(--font-size-body)', marginBottom: 14 }}>{error}</div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
          {t('projectLabel')}
        </label>
        <select
          style={selectStyle}
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
        >
          {projects.map((project) => (
            // A native <option> needs its OWN opaque background and colour — one
            // that inherits only the wrapper's is unreadable in one of the themes.
            <option key={project.id} value={project.id} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      {/* The TERMS. Applied to whichever ticket is published next, because publishing is
          one click on a row and a per-row form would be the retyping this page exists to
          avoid. */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setShowTerms((open) => !open)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
            border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
            color: 'var(--text-primary)', fontSize: 'var(--font-size-card-title)', fontWeight: 600,
          }}
          aria-expanded={showTerms}
        >
          {t('terms.heading')}
          <span style={{ marginLeft: 'auto', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', fontWeight: 500 }}>
            {showTerms ? t('terms.hide') : t('terms.show')}
          </span>
        </button>
        <p style={{ margin: '6px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', maxWidth: '65ch' }}>
          {t('terms.explainer')}
        </p>

        {showTerms && (
          <div style={{ display: 'grid', gap: 14, marginTop: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
            <div>
              <label style={labelStyle} htmlFor="gig-posting-type">{t('terms.postingType')}</label>
              <select id="gig-posting-type" style={fieldStyle} value={terms.postingType} onChange={(e) => patchTerms({ postingType: e.target.value })}>
                {['project_bid', 'design', 'fte'].map((value) => (
                  <option key={value} value={value} style={optionStyle}>{tg(`postingType.${value}`)}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle} htmlFor="gig-engagement-type">{t('terms.engagementType')}</label>
              <select id="gig-engagement-type" style={fieldStyle} value={terms.engagementType} onChange={(e) => patchTerms({ engagementType: e.target.value })}>
                {ENGAGEMENT_TYPES.map((value) => (
                  <option key={value} value={value} style={optionStyle}>{tg(`engagementType.${value}`)}</option>
                ))}
              </select>
            </div>

            {/* One shape of money, decided by the engagement type. A rate band and a
                whole-job total are different quantities; showing both invites a number
                that means the wrong thing. */}
            {hourly ? (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label style={labelStyle} htmlFor="gig-rate-min">{t('terms.rateMin')}</label>
                  <input id="gig-rate-min" style={fieldStyle} type="number" min={0} value={terms.rateMin} onChange={(e) => patchTerms({ rateMin: e.target.value })} />
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label style={labelStyle} htmlFor="gig-rate-max">{t('terms.rateMax')}</label>
                  <input id="gig-rate-max" style={fieldStyle} type="number" min={0} value={terms.rateMax} onChange={(e) => patchTerms({ rateMax: e.target.value })} />
                </div>
              </div>
            ) : (
              <div>
                <label style={labelStyle} htmlFor="gig-budget">{t('terms.budgetTotal')}</label>
                <input id="gig-budget" style={fieldStyle} type="number" min={0} value={terms.budgetTotal} onChange={(e) => patchTerms({ budgetTotal: e.target.value })} />
                <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('terms.budgetHint')}</p>
              </div>
            )}

            <div>
              <label style={labelStyle} htmlFor="gig-experience">{t('terms.experience')}</label>
              <select id="gig-experience" style={fieldStyle} value={terms.experienceLevel} onChange={(e) => patchTerms({ experienceLevel: e.target.value })}>
                <option value="" style={optionStyle}>{t('terms.anyLevel')}</option>
                {EXPERIENCE_LEVELS.map((value) => (
                  <option key={value} value={value} style={optionStyle}>{tf(experienceKey(value))}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle} htmlFor="gig-length">{t('terms.projectLength')}</label>
              <select id="gig-length" style={fieldStyle} value={terms.projectLength} onChange={(e) => patchTerms({ projectLength: e.target.value })}>
                <option value="" style={optionStyle}>{t('terms.anyLength')}</option>
                {PROJECT_LENGTHS.map((value) => (
                  <option key={value} value={value} style={optionStyle}>{tf(projectLengthKey(value))}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle} htmlFor="gig-discipline">{t('terms.discipline')}</label>
              <select
                id="gig-discipline"
                style={fieldStyle}
                value={terms.discipline}
                // Changing the parent clears the leaf: a specialty is only meaningful
                // under its discipline, and the server drops an orphan anyway.
                onChange={(e) => patchTerms({ discipline: e.target.value, specialty: '' })}
              >
                <option value="" style={optionStyle}>{t('terms.anyDiscipline')}</option>
                {JOB_DISCIPLINES.map((value) => (
                  <option key={value} value={value} style={optionStyle}>{tf(`discipline.${value}`)}</option>
                ))}
              </select>
            </div>

            {specialties.length > 0 && (
              <div>
                <label style={labelStyle} htmlFor="gig-specialty">{t('terms.specialty')}</label>
                <select id="gig-specialty" style={fieldStyle} value={terms.specialty} onChange={(e) => patchTerms({ specialty: e.target.value })}>
                  <option value="" style={optionStyle}>{t('terms.anySpecialty')}</option>
                  {specialties.map((value) => (
                    <option key={value} value={value} style={optionStyle}>{tt(specialtyKey(value))}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label style={labelStyle} htmlFor="gig-visibility">{t('terms.visibility')}</label>
              <select id="gig-visibility" style={fieldStyle} value={terms.visibility} onChange={(e) => patchTerms({ visibility: e.target.value === 'private' ? 'private' : 'public' })}>
                <option value="public" style={optionStyle}>{tg('visibility.public')}</option>
                <option value="private" style={optionStyle}>{tg('visibility.private')}</option>
              </select>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <div style={labelStyle}>{t('screening.heading')}</div>
              <ScreeningQuestionsEditor
                questions={terms.screeningQuestions}
                onChange={(screeningQuestions) => patchTerms({ screeningQuestions })}
              />
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : publishable.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
          <p style={{ margin: '0 0 10px' }}>{t('empty')}</p>
          <Link href="/tasks" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t('openBoard')}</Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {publishable.map((task) => (
            <div key={task.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 600, color: 'var(--text-primary)' }}>{task.title}</div>
                <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 2 }}>
                  {task.key} · {task.status}
                </div>
              </div>
              {published[task.id] ? (
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Link
                    href={`/marketplace?family=talent&kind=gig`}
                    style={{ fontSize: 'var(--font-size-body)', fontWeight: 600, color: 'var(--text-primary)' }}
                  >
                    {t('viewListing')}
                  </Link>
                  {/* Publishing and INVITING are one thought: a listing nobody is pointed
                      at waits for whoever happens to browse. This is the only place a
                      client is guaranteed to be standing right after creating one. */}
                  <Link
                    href="/talent/shortlist"
                    style={{ fontSize: 'var(--font-size-body)', fontWeight: 600, color: 'var(--coral-bright)' }}
                  >
                    {t('inviteTalent')}
                  </Link>
                </div>
              ) : (
                // No RoleGate: `POST /api/marketplace/publish` carries
                // `authMiddleware` and no `requireRole`, so any member of the
                // workspace may publish a ticket they can already see. A gate here
                // would disable a control the server accepts, which is the mirror
                // of the bug RoleGate exists to prevent.
                <button
                  type="button"
                  style={primaryButton}
                  disabled={publishing === task.id}
                  onClick={() => void publish(task)}
                >
                  {publishing === task.id ? t('publishing') : t('publish')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 18, maxWidth: '65ch' }}>{t('reopenNote')}</p>
      <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 8, maxWidth: '65ch' }}>
        <Link href="/talent/shortlist" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t('inviteTalent')}</Link>
        {' — '}{t('inviteTalentNote')}
      </p>
    </PageContainer>
  );
}

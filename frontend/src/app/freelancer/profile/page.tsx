'use client';

import { Icon } from '@/components/ui/Icon';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Select } from '@/components/Select';
import { Button, Surface } from '@/components/ui';
import { TalentProfileView } from '@/components/freelance/TalentProfileView';
import ProfileIdentityCard from '@/components/profile/ProfileIdentityCard';
import {
  TALENT_DISCIPLINES, TALENT_AVAILABILITIES, TALENT_SEEKING_MODES, TALENT_WORK_MODES, TALENT_SENIORITIES,
} from '@/components/freelance/talentFields';
import {
  getMyFreelancerProfile, updateMyFreelancerProfile, checkMySlug,
  type FreelancerProfile, type MyResume, type ResumeSuggestions, type SlugCheck,
} from '@/lib/freelancerApi';
import { ProfileResumePanel } from '@/components/freelance/ProfileResumePanel';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';

const DISCIPLINES = TALENT_DISCIPLINES;
const AVAILABILITIES = TALENT_AVAILABILITIES;
const SEEKING_MODES = TALENT_SEEKING_MODES;
const WORK_MODES = TALENT_WORK_MODES;
const SENIORITIES = TALENT_SENIORITIES;

export default function FreelancerProfilePage() {
  const t = useTranslations('freelancer');
  const [profile, setProfile] = useState<FreelancerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [nameText, setNameText] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [rateDollars, setRateDollars] = useState('');
  const [slugText, setSlugText] = useState('');
  // Career intent — free-text fields kept as strings while editing so a half-typed
  // comma list or salary never round-trips through the number/array shape mid-keystroke.
  const [targetRolesText, setTargetRolesText] = useState('');
  const [salaryMinText, setSalaryMinText] = useState('');
  const [salaryMaxText, setSalaryMaxText] = useState('');
  const [slugCheck, setSlugCheck] = useState<SlugCheck | null>(null);
  // Held only so the Preview slide-out can show the résumé alongside unsaved edits.
  // The panel below owns every résumé interaction and reports the loaded value up.
  const [myResume, setMyResume] = useState<MyResume | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // 1500ms confirmation, owned by the shared hook.
  const { copied, copy } = useCopyToClipboard(1500);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = await getMyFreelancerProfile();
      setProfile(p);
      setNameText(p.displayName ?? '');
      setSkillsText((p.skills ?? []).join(', '));
      setRateDollars(p.hourlyRateCents != null ? (p.hourlyRateCents / 100).toString() : '');
      setSlugText(p.slug ?? '');
      setTargetRolesText((p.targetRoles ?? []).join(', '));
      setSalaryMinText(p.desiredSalaryMinCents != null ? (p.desiredSalaryMinCents / 100).toString() : '');
      setSalaryMaxText(p.desiredSalaryMaxCents != null ? (p.desiredSalaryMaxCents / 100).toString() : '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const set = (patch: Partial<FreelancerProfile>) => setProfile((p) => (p ? { ...p, ...patch } : p));

  // The employment fields exist only when this listing is offered to employers. Derived
  // here from the one value that decides it rather than tracked as separate state.
  const seeksEmployment = profile?.seeking === 'employment' || profile?.seeking === 'both';

  // Debounced slug availability check (only when it changed from the saved value).
  useEffect(() => {
    const trimmed = slugText.trim();
    if (!profile || trimmed === (profile.slug ?? '')) { setSlugCheck(null); return; }
    if (!trimmed) { setSlugCheck(null); return; }
    let cancelled = false;
    const handle = setTimeout(() => {
      checkMySlug(trimmed).then((r) => { if (!cancelled) setSlugCheck(r); }).catch(() => { if (!cancelled) setSlugCheck(null); });
    }, 350);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [slugText, profile]);

  const currentSkills = useMemo(() => skillsText.split(',').map((s) => s.trim()).filter(Boolean), [skillsText]);

  const save = async () => {
    if (!profile) return;
    setSaving(true); setError(null); setOk(false);
    try {
      const hourlyRateCents = rateDollars ? Math.round(parseFloat(rateDollars) * 100) : undefined;
      const trimmedSlug = slugText.trim();
      await updateMyFreelancerProfile({
        displayName: nameText.trim(),
        headline: profile.headline, bio: profile.bio, discipline: profile.discipline,
        skills: currentSkills, hourlyRateCents, currency: profile.currency, visibility: profile.visibility,
        availability: profile.availability, published: profile.published, location: profile.location, timezone: profile.timezone,
        // Career intent — the same listing, offered to employment demand as well as
        // project demand. PATCH replaces the row, so these travel with every save.
        seeking: profile.seeking ?? 'services',
        targetRoles: targetRolesText.split(',').map((r) => r.trim()).filter(Boolean).slice(0, 12),
        seniority: profile.seniority ?? null,
        desiredSalaryMinCents: salaryMinText ? Math.round(parseFloat(salaryMinText) * 100) : undefined,
        desiredSalaryMaxCents: salaryMaxText ? Math.round(parseFloat(salaryMaxText) * 100) : undefined,
        workMode: profile.workMode ?? null,
        noticePeriodDays: profile.noticePeriodDays ?? undefined,
        openToRelocation: profile.openToRelocation === true,
        // Only send slug when it changed (empty string clears it).
        ...(trimmedSlug !== (profile.slug ?? '') ? { slug: trimmedSlug } : {}),
      });
      setOk(true);
      setSlugCheck(null);
      // Reflect the persisted name/slug locally without a full reload.
      setProfile((p) => (p ? { ...p, displayName: nameText.trim() || null, slug: trimmedSlug || null, skills: currentSkills } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // The résumé panel owns upload, style and version; the only thing the FORM needs
  // from it is the extracted fields, which the user reviews and then saves.
  const applyResumeSuggestions = (suggestions: ResumeSuggestions) => {
    set({
      headline: profile?.headline || suggestions.headline,
      bio: profile?.bio || suggestions.summary,
      discipline: profile?.discipline || suggestions.discipline,
    });
    if (!currentSkills.length && suggestions.skills.length) setSkillsText(suggestions.skills.join(', '));
  };

  const publicPath = profile ? `/talent/${profile.slug || profile.userId}` : '';
  const publicUrl = typeof window !== 'undefined' && publicPath ? `${window.location.origin}${publicPath}` : publicPath;

  // Clipboard refusal stays silent as before — the URL is visible next to the button.
  const copyLink = () => { void copy(publicUrl); };

  // A fully-resolved profile object from current (possibly unsaved) editor state, for
  // the Preview slide-out — reuses the exact public render (TalentProfileView).
  const previewProfile = useMemo<FreelancerProfile | null>(() => {
    if (!profile) return null;
    return {
      ...profile,
      displayName: nameText.trim() || null,
      slug: slugText.trim() || null,
      skills: currentSkills,
      hourlyRateCents: rateDollars ? Math.round(parseFloat(rateDollars) * 100) : null,
      // The preview must show the same résumé a visitor sees, so hand the editor's
      // loaded family through as the public projection.
      publicResume: myResume ? { title: myResume.title, family: myResume.family } : profile.publicResume,
    };
  }, [profile, nameText, slugText, currentSkills, rateDollars, myResume]);

  if (loading) return <PageContainer width="readable" style={{ padding: '32px 40px' }}><p style={{ color: 'var(--text-muted)' }}>{t('loading')}</p></PageContainer>;
  if (!profile) return <PageContainer width="readable" style={{ padding: '32px 40px' }}><p style={{ color: 'var(--coral-bright)' }}>{error ?? t('loadFailed')}</p></PageContainer>;

  const slugMsg = slugText.trim() && slugText.trim() !== (profile.slug ?? '') && slugCheck;

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('profile.title')}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('profile.subtitle')}</p>
        </div>
        <button type="button" onClick={() => setPreviewOpen(true)} className="ui-button ui-button--secondary ui-button--sm"><Icon source="👁" size="1em" /> {t('profile.preview')}</button>
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
        {/* Left: editable details */}
        <Surface style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Identity: THE shared profile card (PRD 21 E2). Avatar and display
              name are the user's, not the gig account's — the fields below
              EXTEND this profile rather than forking it. Controlled, because
              this editor holds its own draft until Save. */}
          <ProfileIdentityCard
            displayName={nameText}
            avatarUrl={profile.avatarUrl}
            onDisplayNameChange={setNameText}
            onAvatarChange={(avatarUrl) => set({ avatarUrl })}
          />

          {/* Public alias (slug) */}
          <div>
            <label className="ui-field__label">{t('profile.alias')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '0 12px' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>/talent/</span>
              <input className="ui-input" style={{ border: 'none', background: 'transparent', padding: '9px 0' }} value={slugText} maxLength={40}
                onChange={(e) => setSlugText(e.target.value)} placeholder={t('profile.aliasPlaceholder')} />
            </div>
            {slugMsg && !slugCheck!.valid && <p style={{ fontSize: 11, color: 'var(--coral-bright)', margin: '6px 0 0' }}>{t('profile.aliasInvalid')}</p>}
            {slugMsg && slugCheck!.valid && slugCheck!.available && <p style={{ fontSize: 11, color: 'rgba(34,197,94,0.9)', margin: '6px 0 0' }}><Icon source="✓" size="1em" /> {t('profile.aliasAvailable')}</p>}
            {slugMsg && slugCheck!.valid && !slugCheck!.available && (
              <p style={{ fontSize: 11, color: 'var(--coral-bright)', margin: '6px 0 0' }}>
                {t('profile.aliasTaken')}
                {slugCheck!.suggestions.length > 0 && (
                  <> {t('profile.aliasTry')} {slugCheck!.suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => setSlugText(s)}
                      style={{ background: 'none', border: 'none', padding: 0, margin: '0 6px 0 0', color: 'var(--coral-bright)', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline' }}>{s}</button>
                  ))}</>
                )}
              </p>
            )}
            {!slugMsg && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>{t('profile.aliasHint')}</p>}
          </div>

          <div>
            <label className="ui-field__label">{t('profile.headline')}</label>
            <input className="ui-input" value={profile.headline ?? ''} maxLength={200}
              onChange={(e) => set({ headline: e.target.value })} placeholder={t('profile.headlinePlaceholder')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="ui-field__label">{t('profile.discipline')}</label>
              <Select className="ui-input" value={profile.discipline ?? ''} onChange={(e) => set({ discipline: e.target.value })}>
                <option value="">—</option>
                {DISCIPLINES.map((d) => <option key={d} value={d}>{t(`discipline.${d}`)}</option>)}
              </Select>
            </div>
            <div>
              <label className="ui-field__label">{t('profile.availability')}</label>
              <Select className="ui-input" value={profile.availability} onChange={(e) => set({ availability: e.target.value as FreelancerProfile['availability'] })}>
                {AVAILABILITIES.map((a) => <option key={a} value={a}>{t(`availability.${a}`)}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <label className="ui-field__label">{t('profile.bio')}</label>
            <textarea className="ui-input" style={{ minHeight: 90, resize: 'vertical' }} value={profile.bio ?? ''} maxLength={5000}
              onChange={(e) => set({ bio: e.target.value })} placeholder={t('profile.bioPlaceholder')} />
          </div>
          <div>
            <label className="ui-field__label">{t('profile.skills')}</label>
            <input className="ui-input" value={skillsText} onChange={(e) => setSkillsText(e.target.value)} placeholder={t('profile.skillsPlaceholder')} />
          </div>

          {/* ── What you are open to ────────────────────────────────────────────
              ONE listing, two kinds of demand. A full-time role is a posting with
              postingType 'fte' and an application is a proposal on it, so employment
              needed no second profile — only this statement of intent. The employment
              fields below are what an employer's search actually matches on, and a
              strong listing that never states them is invisible to every one of them. */}
          <fieldset className="ui-fieldset">
            <legend className="ui-field__label">{t('profile.seekingLegend')}</legend>
            <p className="ui-field__message">{t('profile.seekingHint')}</p>
            <Select
              className="ui-input"
              aria-label={t('profile.seekingLegend')}
              value={profile.seeking ?? 'services'}
              onChange={(e) => set({ seeking: e.target.value as NonNullable<FreelancerProfile['seeking']> })}
            >
              {SEEKING_MODES.map((mode) => <option key={mode} value={mode}>{t(`seeking.${mode}`)}</option>)}
            </Select>

            {seeksEmployment && (
              <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                <div>
                  <label className="ui-field__label" htmlFor="targetRoles">{t('profile.targetRoles')}</label>
                  <input id="targetRoles" className="ui-input" value={targetRolesText}
                    onChange={(e) => setTargetRolesText(e.target.value)} placeholder={t('profile.targetRolesPlaceholder')} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                  <div>
                    <label className="ui-field__label" htmlFor="seniority">{t('profile.seniority')}</label>
                    <Select id="seniority" className="ui-input" value={profile.seniority ?? ''}
                      onChange={(e) => set({ seniority: e.target.value || null })}>
                      <option value="">—</option>
                      {SENIORITIES.map((level) => <option key={level} value={level}>{t(`seniority.${level}`)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="ui-field__label" htmlFor="workMode">{t('profile.workMode')}</label>
                    <Select id="workMode" className="ui-input" value={profile.workMode ?? ''}
                      onChange={(e) => set({ workMode: (e.target.value || null) as FreelancerProfile['workMode'] })}>
                      <option value="">—</option>
                      {WORK_MODES.map((mode) => <option key={mode} value={mode}>{t(`workMode.${mode}`)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="ui-field__label" htmlFor="noticeDays">{t('profile.noticePeriod')}</label>
                    <input id="noticeDays" className="ui-input" type="number" min={0} max={365} step="1"
                      value={profile.noticePeriodDays ?? ''}
                      onChange={(e) => set({ noticePeriodDays: e.target.value === '' ? null : Number(e.target.value) })}
                      placeholder="30" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                  <div>
                    <label className="ui-field__label" htmlFor="salaryMin">{t('profile.salaryMin')}</label>
                    <input id="salaryMin" className="ui-input" type="number" min={0} step="1000" value={salaryMinText}
                      onChange={(e) => setSalaryMinText(e.target.value)} placeholder="80000" />
                  </div>
                  <div>
                    <label className="ui-field__label" htmlFor="salaryMax">{t('profile.salaryMax')}</label>
                    <input id="salaryMax" className="ui-input" type="number" min={0} step="1000" value={salaryMaxText}
                      onChange={(e) => setSalaryMaxText(e.target.value)} placeholder="110000" />
                  </div>
                  <label className="ui-field__label" style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end', minHeight: 40 }}>
                    <input type="checkbox" checked={profile.openToRelocation === true}
                      onChange={(e) => set({ openToRelocation: e.target.checked })} />
                    {t('profile.openToRelocation')}
                  </label>
                </div>
              </div>
            )}
          </fieldset>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label className="ui-field__label">{t('profile.rate')}</label>
              <input className="ui-input" type="number" min={0} step="1" value={rateDollars}
                onChange={(e) => setRateDollars(e.target.value)} placeholder="150" />
            </div>
            <div>
              <label className="ui-field__label">{t('profile.currency')}</label>
              <input className="ui-input" value={profile.currency} maxLength={3}
                onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <label className="ui-field__label">{t('profile.location')}</label>
              <input className="ui-input" value={profile.location ?? ''} maxLength={120} onChange={(e) => set({ location: e.target.value })} />
            </div>
          </div>

          {/* Visibility + publish */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', paddingTop: 4 }}>
            <div>
              <label className="ui-field__label">{t('profile.visibility')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['public', 'private'] as const).map((v) => (
                  <button key={v} type="button" onClick={() => set({ visibility: v })}
                    style={{
                      padding: '7px 14px', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      background: profile.visibility === v ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
                      border: `1px solid ${profile.visibility === v ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                      color: 'var(--text-primary)',
                    }}>
                    {t(`visibility.${v}`)}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>{t(`visibility.${profile.visibility}Hint`)}</p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', marginTop: 20 }}>
              <input type="checkbox" checked={!!profile.published} onChange={(e) => set({ published: e.target.checked })} style={{ accentColor: 'var(--coral-bright)' }} />
              {t('profile.publish')}
            </label>
          </div>

          {/* Public URL */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 4, borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('profile.publicUrl')}:</span>
            <a href={publicPath} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--coral-bright)', textDecoration: 'none', wordBreak: 'break-all' }}>{publicUrl}</a>
            <Button type="button" variant="secondary" size="sm" onClick={copyLink}>{copied ? t('profile.copied') : t('profile.copyLink')}</Button>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingTop: 6, flexWrap: 'wrap' }}>
            <Button type="button" variant="primary" onClick={save} loading={saving}>
              {saving ? t('saving') : t('save')}
            </Button>
            {ok && <span style={{ fontSize: 13, color: 'var(--success-text)' }}>{t('saved')}</span>}
            {error && <span style={{ fontSize: 13, color: 'var(--error-text)' }}>{error}</span>}
          </div>
        </Surface>

        {/* Right: the résumé — upload it, choose its design, pick which version is the
            one employers see, and decide who they are. Self-contained because the
            résumé saves on change while the profile form saves on submit. */}
        <ProfileResumePanel onAutofill={applyResumeSuggestions} onLoaded={setMyResume} />
      </div>

      {/* Preview: exactly what employers see, rendered from unsaved editor state. */}
      {previewProfile && (
        <SlideOutPanel open={previewOpen} onClose={() => setPreviewOpen(false)} title={t('profile.previewTitle')} width="min(680px, 96vw)">
          <div style={{ padding: 20 }}>
            <TalentProfileView profile={previewProfile} resumeEmptyNote={t('resume.empty')} />
          </div>
        </SlideOutPanel>
      )}
    </PageContainer>
  );
}

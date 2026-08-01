'use client';

/**
 * Step bodies for the HIRED (for-hire / freelancer) onboarding track.
 *
 * A hired account has no workspace, no repos and no agent roster — its first
 * five minutes are about becoming hireable: fill the profile, attach a résumé,
 * publish, then find work. These bodies drive the SAME endpoints as the
 * /freelancer/profile editor (via `useMyTalentProfile`), so anything set here is
 * immediately live on the public profile.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { TALENT_DISCIPLINES, TALENT_AVAILABILITIES } from '@/components/freelance/talentFields';
import {
  talentLabel as label, talentInput as input, talentSoftBtn as softBtn, talentPrimaryBtn as primaryBtn,
} from '@/components/freelance/formStyles';
import { useMyTalentProfile, invalidateMyTalentProfile } from '@/components/freelance/useMyTalentProfile';
import { uploadMyResume, getResumeSuggestions } from '@/lib/freelancerApi';

const intro: React.CSSProperties = { margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)' };
const okText: React.CSSProperties = { fontSize: 13, color: 'rgba(34,197,94,0.9)' };
const errText: React.CSSProperties = { fontSize: 13, color: 'var(--coral-bright)' };

/** Shared status line so every hired step reports save state identically. */
function StatusLine({ saving, saved, error }: { saving: boolean; saved: boolean; error: string | null }) {
  const tf = useTranslations('freelancer');
  if (error) return <span style={errText}>{error}</span>;
  if (saving) return <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tf('saving')}</span>;
  if (saved) return <span style={okText}>{tf('saved')}</span>;
  return null;
}

// ── Step: talent profile ────────────────────────────────────────────────────

export function WizardTalentProfileStep() {
  const t = useTranslations('onboarding');
  const tf = useTranslations('freelancer');
  const { profile, loading, saving, saved, error, patch, save } = useMyTalentProfile();
  const [skillsText, setSkillsText] = useState<string | null>(null);
  const [rateText, setRateText] = useState<string | null>(null);

  if (loading) return <p style={intro}>{tf('loading')}</p>;
  if (!profile) return <p style={errText}>{error ?? tf('loadFailed')}</p>;

  const skills = skillsText ?? (profile.skills ?? []).join(', ');
  const rate = rateText ?? (profile.hourlyRateCents != null ? String(profile.hourlyRateCents / 100) : '');

  const onSave = () =>
    save({
      displayName: (profile.displayName ?? '').trim() || null,
      headline: profile.headline,
      discipline: profile.discipline,
      availability: profile.availability,
      skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
      hourlyRateCents: rate ? Math.round(parseFloat(rate) * 100) : null,
    });

  return (
    <div>
      <p style={intro}>{t('talentProfile.intro')}</p>
      <div style={{ display: 'grid', gap: 14 }}>
        <div>
          <label style={label}>{tf('profile.name')}</label>
          <input style={input} value={profile.displayName ?? ''} maxLength={255}
            onChange={(e) => patch({ displayName: e.target.value })} placeholder={tf('profile.namePlaceholder')} />
        </div>
        <div>
          <label style={label}>{tf('profile.headline')}</label>
          <input style={input} value={profile.headline ?? ''} maxLength={200}
            onChange={(e) => patch({ headline: e.target.value })} placeholder={tf('profile.headlinePlaceholder')} />
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))' }}>
          <div>
            <label style={label}>{tf('profile.discipline')}</label>
            <Select style={input} value={profile.discipline ?? ''} onChange={(e) => patch({ discipline: e.target.value })}>
              <option value="">—</option>
              {TALENT_DISCIPLINES.map((d) => <option key={d} value={d}>{tf(`discipline.${d}`)}</option>)}
            </Select>
          </div>
          <div>
            <label style={label}>{tf('profile.availability')}</label>
            <Select style={input} value={profile.availability}
              onChange={(e) => patch({ availability: e.target.value as typeof profile.availability })}>
              {TALENT_AVAILABILITIES.map((a) => <option key={a} value={a}>{tf(`availability.${a}`)}</option>)}
            </Select>
          </div>
          <div>
            <label style={label}>{tf('profile.rate')}</label>
            <input style={input} type="number" min={0} step="1" value={rate}
              onChange={(e) => setRateText(e.target.value)} placeholder="150" />
          </div>
        </div>
        <div>
          <label style={label}>{tf('profile.skills')}</label>
          <input style={input} value={skills} onChange={(e) => setSkillsText(e.target.value)}
            placeholder={tf('profile.skillsPlaceholder')} />
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={onSave} disabled={saving}
            style={{ ...primaryBtn, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? tf('saving') : tf('save')}
          </button>
          <StatusLine saving={false} saved={saved} error={error} />
        </div>
      </div>
    </div>
  );
}

// ── Step: résumé ────────────────────────────────────────────────────────────

export function WizardResumeStep() {
  const t = useTranslations('onboarding');
  const tf = useTranslations('freelancer');
  const { profile, loading, saving, saved, error, patch, save } = useMyTalentProfile();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [autofilling, setAutofilling] = useState(false);
  const [autofilled, setAutofilled] = useState(false);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadError(null);
    try {
      const res = await uploadMyResume(file);
      setFilename(res.resumeFilename);
      invalidateMyTalentProfile();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const applyResume = async () => {
    setAutofilling(true); setUploadError(null); setAutofilled(false);
    try {
      const s = await getResumeSuggestions();
      if (!s.available) { setUploadError(tf('profile.autofillUnavailable')); return; }
      const next = {
        headline: profile?.headline || s.headline,
        bio: profile?.bio || s.summary,
        discipline: profile?.discipline || s.discipline,
        ...(!(profile?.skills ?? []).length && s.skills.length ? { skills: s.skills } : {}),
      };
      patch(next);
      await save(next);
      setAutofilled(true);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutofilling(false);
    }
  };

  if (loading) return <p style={intro}>{tf('loading')}</p>;

  const currentFile = filename ?? profile?.resumeFilename ?? null;

  return (
    <div>
      <p style={intro}>{t('resumeStep.intro')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={softBtn}>
          {uploading ? tf('resume.uploading') : (currentFile ? tf('resume.replace') : tf('resume.upload'))}
          <input type="file" accept=".pdf,.doc,.docx,.txt,.md" onChange={onUpload} style={{ display: 'none' }} />
        </label>
        {(profile?.canAutofill || currentFile) && (
          <button type="button" onClick={applyResume} disabled={autofilling} style={softBtn}>
            {autofilling ? tf('profile.filling') : `✨ ${tf('profile.fillFromResume')}`}
          </button>
        )}
      </div>
      {currentFile && <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px' }}>📄 {currentFile}</p>}
      {autofilled && <p style={{ ...okText, margin: '0 0 8px' }}>{tf('profile.autofilled')}</p>}
      <StatusLine saving={saving} saved={saved && !autofilled} error={uploadError ?? error} />
      <p style={{ ...intro, marginTop: 14, marginBottom: 0 }}>{t('resumeStep.skipHint')}</p>
    </div>
  );
}

// ── Step: publish ───────────────────────────────────────────────────────────

export function WizardPublishStep() {
  const t = useTranslations('onboarding');
  const tf = useTranslations('freelancer');
  const { profile, loading, saving, saved, error, patch, save } = useMyTalentProfile();

  if (loading) return <p style={intro}>{tf('loading')}</p>;
  if (!profile) return <p style={errText}>{error ?? tf('loadFailed')}</p>;

  const publicPath = `/talent/${profile.slug || profile.userId}`;

  return (
    <div>
      <p style={intro}>{t('publishStep.intro')}</p>

      <div style={{ marginBottom: 14 }}>
        <label style={label}>{tf('profile.visibility')}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['public', 'private'] as const).map((v) => (
            <button key={v} type="button" onClick={() => patch({ visibility: v })}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: profile.visibility === v ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
                border: `1px solid ${profile.visibility === v ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                color: 'var(--text-primary)',
              }}>
              {tf(`visibility.${v}`)}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>{tf(`visibility.${profile.visibility}Hint`)}</p>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
        <input type="checkbox" checked={!!profile.published} onChange={(e) => patch({ published: e.target.checked })}
          style={{ accentColor: 'var(--coral-bright)' }} />
        {tf('profile.publish')}
      </label>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => save({ visibility: profile.visibility, published: !!profile.published })}
          disabled={saving} style={{ ...primaryBtn, cursor: saving ? 'wait' : 'pointer' }}>
          {saving ? tf('saving') : tf('save')}
        </button>
        <StatusLine saving={false} saved={saved} error={error} />
      </div>

      <p style={{ ...intro, marginTop: 16, marginBottom: 0 }}>
        {tf('profile.publicUrl')}:{' '}
        <a href={publicPath} target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--coral-bright)', textDecoration: 'none', wordBreak: 'break-all' }}>{publicPath}</a>
      </p>
    </div>
  );
}

// ── Step: find work ─────────────────────────────────────────────────────────

export function WizardFindWorkStep() {
  const t = useTranslations('onboarding');
  return (
    <div>
      <p style={intro}>{t('findWorkStep.intro')}</p>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
        {([
          { href: '/marketplace?category=gigs', emoji: '🔎', key: 'gigs' },
          { href: '/freelancer/timecard', emoji: '⏱', key: 'timecard' },
        ] as const).map(({ href, emoji, key }) => (
          <Link key={key} href={href}
            style={{
              display: 'block', padding: 16, borderRadius: 12, textDecoration: 'none',
              border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
            }}>
            <span style={{ fontSize: 22 }}>{emoji}</span>
            <span style={{ display: 'block', fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginTop: 6 }}>
              {t(`findWorkStep.${key}`)}
            </span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {t(`findWorkStep.${key}Hint`)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

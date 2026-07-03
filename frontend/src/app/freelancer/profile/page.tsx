'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import {
  getMyFreelancerProfile, updateMyFreelancerProfile, uploadMyResume, getMyEmbedToken,
  type FreelancerProfile,
} from '@/lib/freelancerApi';

const DISCIPLINES = ['developer', 'dba', 'designer', 'devops', 'qa', 'pm', 'data', 'security', 'other'] as const;
const AVAILABILITIES = ['open', 'limited', 'unavailable'] as const;

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20,
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6,
};
const input: React.CSSProperties = {
  width: '100%', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '9px 12px', fontSize: 14, outline: 'none',
};

export default function FreelancerProfilePage() {
  const t = useTranslations('freelancer');
  const [profile, setProfile] = useState<FreelancerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [skillsText, setSkillsText] = useState('');
  const [rateDollars, setRateDollars] = useState('');
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = await getMyFreelancerProfile();
      setProfile(p);
      setSkillsText((p.skills ?? []).join(', '));
      setRateDollars(p.hourlyRateCents != null ? (p.hourlyRateCents / 100).toString() : '');
      const embed = await getMyEmbedToken('profile').catch(() => null);
      setEmbedUrl(embed?.embedUrl ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const set = (patch: Partial<FreelancerProfile>) => setProfile((p) => (p ? { ...p, ...patch } : p));

  const save = async () => {
    if (!profile) return;
    setSaving(true); setError(null); setOk(false);
    try {
      const skills = skillsText.split(',').map((s) => s.trim()).filter(Boolean);
      const hourlyRateCents = rateDollars ? Math.round(parseFloat(rateDollars) * 100) : undefined;
      await updateMyFreelancerProfile({
        headline: profile.headline, bio: profile.bio, discipline: profile.discipline,
        skills, hourlyRateCents, currency: profile.currency, visibility: profile.visibility,
        availability: profile.availability, published: profile.published, location: profile.location, timezone: profile.timezone,
      });
      setOk(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setError(null);
    try {
      await uploadMyResume(file);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <PageContainer width="readable" style={{ padding: '32px 40px' }}><p style={{ color: 'var(--text-muted)' }}>{t('loading')}</p></PageContainer>;
  if (!profile) return <PageContainer width="readable" style={{ padding: '32px 40px' }}><p style={{ color: 'var(--coral-bright)' }}>{error ?? t('loadFailed')}</p></PageContainer>;

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('profile.title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('profile.subtitle')}</p>
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
        {/* Left: editable details */}
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={label}>{t('profile.headline')}</label>
            <input style={input} value={profile.headline ?? ''} maxLength={200}
              onChange={(e) => set({ headline: e.target.value })} placeholder={t('profile.headlinePlaceholder')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={label}>{t('profile.discipline')}</label>
              <select style={input} value={profile.discipline ?? ''} onChange={(e) => set({ discipline: e.target.value })}>
                <option value="">—</option>
                {DISCIPLINES.map((d) => <option key={d} value={d}>{t(`discipline.${d}`)}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>{t('profile.availability')}</label>
              <select style={input} value={profile.availability} onChange={(e) => set({ availability: e.target.value as FreelancerProfile['availability'] })}>
                {AVAILABILITIES.map((a) => <option key={a} value={a}>{t(`availability.${a}`)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={label}>{t('profile.bio')}</label>
            <textarea style={{ ...input, minHeight: 90, resize: 'vertical' }} value={profile.bio ?? ''} maxLength={5000}
              onChange={(e) => set({ bio: e.target.value })} placeholder={t('profile.bioPlaceholder')} />
          </div>
          <div>
            <label style={label}>{t('profile.skills')}</label>
            <input style={input} value={skillsText} onChange={(e) => setSkillsText(e.target.value)} placeholder={t('profile.skillsPlaceholder')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={label}>{t('profile.rate')}</label>
              <input style={input} type="number" min={0} step="1" value={rateDollars}
                onChange={(e) => setRateDollars(e.target.value)} placeholder="150" />
            </div>
            <div>
              <label style={label}>{t('profile.currency')}</label>
              <input style={input} value={profile.currency} maxLength={3}
                onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <label style={label}>{t('profile.location')}</label>
              <input style={input} value={profile.location ?? ''} maxLength={120} onChange={(e) => set({ location: e.target.value })} />
            </div>
          </div>

          {/* Visibility + publish */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', paddingTop: 4 }}>
            <div>
              <label style={label}>{t('profile.visibility')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['public', 'private'] as const).map((v) => (
                  <button key={v} type="button" onClick={() => set({ visibility: v })}
                    style={{
                      padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
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

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingTop: 6 }}>
            <button type="button" onClick={save} disabled={saving}
              style={{
                padding: '10px 20px', borderRadius: 10, border: 'none', cursor: saving ? 'wait' : 'pointer',
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', fontWeight: 700, fontSize: 14,
              }}>
              {saving ? t('saving') : t('save')}
            </button>
            {ok && <span style={{ fontSize: 13, color: 'rgba(34,197,94,0.9)' }}>{t('saved')}</span>}
            {error && <span style={{ fontSize: 13, color: 'var(--coral-bright)' }}>{error}</span>}
          </div>
        </div>

        {/* Right: resume + hired.video viewer */}
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>{t('resume.title')}</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('resume.subtitle')}</p>
          </div>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start', cursor: 'pointer',
            padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
            color: 'var(--text-primary)', fontSize: 13, fontWeight: 600,
          }}>
            {uploading ? t('resume.uploading') : (profile.resumeFilename ? t('resume.replace') : t('resume.upload'))}
            <input type="file" accept=".pdf,.doc,.docx,.txt,.md" onChange={onUpload} style={{ display: 'none' }} />
          </label>
          {profile.resumeFilename && <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>📄 {profile.resumeFilename}</p>}

          {embedUrl ? (
            <iframe
              title={t('resume.viewerTitle')}
              src={embedUrl}
              style={{ width: '100%', height: 520, border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--bg-elevated)' }}
            />
          ) : (
            <div style={{
              padding: 20, borderRadius: 10, border: '1px dashed var(--border-subtle)', background: 'var(--bg-elevated)',
              fontSize: 13, color: 'var(--text-muted)', textAlign: 'center',
            }}>
              {profile.hiredVideoConnected ? t('resume.viewerPending') : t('resume.viewerNotConnected')}
              {profile.hiredVideoClaimUrl && (
                <div style={{ marginTop: 10 }}>
                  <a href={profile.hiredVideoClaimUrl} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--coral-bright)', fontWeight: 600, textDecoration: 'none' }}>
                    {t('resume.claimHiredVideo')} →
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

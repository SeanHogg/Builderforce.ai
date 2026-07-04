'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { TalentProfileView, TalentAvatar } from '@/components/freelance/TalentProfileView';
import {
  getMyFreelancerProfile, updateMyFreelancerProfile, uploadMyResume, uploadMyAvatar,
  getMyEmbedToken, checkMySlug, getResumeSuggestions, connectHiredVideo,
  type FreelancerProfile, type SlugCheck,
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
const softBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
  color: 'var(--text-primary)', fontSize: 13, fontWeight: 600,
};

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
  const [slugCheck, setSlugCheck] = useState<SlugCheck | null>(null);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [autofilled, setAutofilled] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = await getMyFreelancerProfile();
      setProfile(p);
      setNameText(p.displayName ?? '');
      setSkillsText((p.skills ?? []).join(', '));
      setRateDollars(p.hourlyRateCents != null ? (p.hourlyRateCents / 100).toString() : '');
      setSlugText(p.slug ?? '');
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

  const onAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true); setError(null);
    try {
      const { avatarUrl } = await uploadMyAvatar(file);
      set({ avatarUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setAvatarUploading(false);
    }
  };

  // Pull extracted fields from the résumé and prefill the form (user reviews + saves).
  const applyResume = async () => {
    setAutofilling(true); setError(null); setAutofilled(false);
    try {
      const s = await getResumeSuggestions();
      if (!s.available) { setError(t('profile.autofillUnavailable')); return; }
      set({
        headline: profile?.headline || s.headline,
        bio: profile?.bio || s.summary,
        discipline: profile?.discipline || s.discipline,
      });
      if (!currentSkills.length && s.skills.length) setSkillsText(s.skills.join(', '));
      setAutofilled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read résumé');
    } finally {
      setAutofilling(false);
    }
  };

  const connectHired = async () => {
    setConnecting(true); setError(null);
    try {
      const res = await connectHiredVideo({ redirectUrl: typeof window !== 'undefined' ? window.location.href : undefined });
      if (res.consentUrl) window.open(res.consentUrl, '_blank', 'noopener,noreferrer');
      else setError(t('resume.connectUnavailable'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  const publicPath = profile ? `/talent/${profile.slug || profile.userId}` : '';
  const publicUrl = typeof window !== 'undefined' && publicPath ? `${window.location.origin}${publicPath}` : publicPath;

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

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
      embedUrl,
    };
  }, [profile, nameText, slugText, currentSkills, rateDollars, embedUrl]);

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
        <button type="button" onClick={() => setPreviewOpen(true)} style={softBtn}>👁 {t('profile.preview')}</button>
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
        {/* Left: editable details */}
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Identity: avatar + name */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <TalentAvatar profile={{ displayName: nameText || profile.displayName, avatarUrl: profile.avatarUrl }} size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={label}>{t('profile.name')}</label>
              <input style={input} value={nameText} maxLength={255}
                onChange={(e) => setNameText(e.target.value)} placeholder={t('profile.namePlaceholder')} />
              <label style={{ ...softBtn, marginTop: 8, padding: '6px 12px', fontSize: 12 }}>
                {avatarUploading ? t('profile.uploading') : (profile.avatarUrl ? t('profile.avatarChange') : t('profile.avatarUpload'))}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onAvatarUpload} style={{ display: 'none' }} />
              </label>
            </div>
          </div>

          {/* Public alias (slug) */}
          <div>
            <label style={label}>{t('profile.alias')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '0 12px' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>/talent/</span>
              <input style={{ ...input, border: 'none', background: 'transparent', padding: '9px 0' }} value={slugText} maxLength={40}
                onChange={(e) => setSlugText(e.target.value)} placeholder={t('profile.aliasPlaceholder')} />
            </div>
            {slugMsg && !slugCheck!.valid && <p style={{ fontSize: 11, color: 'var(--coral-bright)', margin: '6px 0 0' }}>{t('profile.aliasInvalid')}</p>}
            {slugMsg && slugCheck!.valid && slugCheck!.available && <p style={{ fontSize: 11, color: 'rgba(34,197,94,0.9)', margin: '6px 0 0' }}>✓ {t('profile.aliasAvailable')}</p>}
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

          {/* Public URL */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 4, borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('profile.publicUrl')}:</span>
            <a href={publicPath} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--coral-bright)', textDecoration: 'none', wordBreak: 'break-all' }}>{publicUrl}</a>
            <button type="button" onClick={copyLink} style={{ ...softBtn, padding: '4px 10px', fontSize: 11 }}>{copied ? t('profile.copied') : t('profile.copyLink')}</button>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingTop: 6, flexWrap: 'wrap' }}>
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={softBtn}>
              {uploading ? t('resume.uploading') : (profile.resumeFilename ? t('resume.replace') : t('resume.upload'))}
              <input type="file" accept=".pdf,.doc,.docx,.txt,.md" onChange={onUpload} style={{ display: 'none' }} />
            </label>
            {(profile.canAutofill || profile.resumeFilename) && (
              <button type="button" onClick={applyResume} disabled={autofilling} style={softBtn}>
                {autofilling ? t('profile.filling') : `✨ ${t('profile.fillFromResume')}`}
              </button>
            )}
          </div>
          {profile.resumeFilename && <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>📄 {profile.resumeFilename}</p>}
          {autofilled && <p style={{ fontSize: 12, color: 'rgba(34,197,94,0.9)', margin: 0 }}>{t('profile.autofilled')}</p>}

          {embedUrl ? (
            <iframe
              title={t('resume.viewerTitle')}
              src={embedUrl}
              style={{ width: '100%', height: 460, border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--bg-elevated)' }}
            />
          ) : (
            <div style={{
              padding: 20, borderRadius: 10, border: '1px dashed var(--border-subtle)', background: 'var(--bg-elevated)',
              fontSize: 13, color: 'var(--text-muted)', textAlign: 'center',
            }}>
              {profile.hiredVideoConnected ? t('resume.viewerPending') : t('resume.viewerNotConnected')}
              {!profile.hiredVideoConnected && (
                <div style={{ marginTop: 12 }}>
                  <button type="button" onClick={connectHired} disabled={connecting}
                    style={{ ...softBtn, margin: '0 auto', background: 'var(--surface-coral-soft)', border: '1px solid var(--coral-bright)', color: 'var(--coral-bright)' }}>
                    {connecting ? t('resume.connecting') : t('resume.connectExisting')}
                  </button>
                </div>
              )}
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

      {/* Preview: exactly what employers see, rendered from unsaved editor state. */}
      {previewProfile && (
        <SlideOutPanel open={previewOpen} onClose={() => setPreviewOpen(false)} title={t('profile.previewTitle')} width="min(680px, 96vw)">
          <div style={{ padding: 20 }}>
            <TalentProfileView profile={previewProfile} resumeEmptyNote={t('resume.viewerNotConnected')} />
          </div>
        </SlideOutPanel>
      )}
    </PageContainer>
  );
}

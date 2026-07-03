'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { useOptionalAuth } from '@/lib/AuthContext';
import { RatingStars } from '@/components/freelance/RatingStars';
import { getFreelancer, hireFreelancer, type FreelancerProfile } from '@/lib/freelancerApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20,
};

export default function TalentDetailClient() {
  const t = useTranslations('talent');
  const params = useParams();
  const id = String(params?.id ?? '');
  const auth = useOptionalAuth();
  const [profile, setProfile] = useState<FreelancerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hireState, setHireState] = useState<'idle' | 'busy' | 'hired' | 'invited'>('idle');
  const [hireError, setHireError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getFreelancer(id).then(setProfile).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, [id]);

  const doHire = async (status: 'active' | 'interviewing') => {
    if (!profile) return;
    setHireState('busy'); setHireError(null);
    try {
      await hireFreelancer({ freelancerUserId: profile.userId, status });
      setHireState(status === 'active' ? 'hired' : 'invited');
    } catch (e) {
      setHireError(e instanceof Error ? e.message : t('hireError'));
      setHireState('idle');
    }
  };

  if (loading) return <PageContainer width="readable" style={{ padding: '32px 40px' }}><p style={{ color: 'var(--text-muted)' }}>…</p></PageContainer>;
  if (error || !profile) {
    return (
      <PageContainer width="readable" style={{ padding: '32px 40px' }}>
        <p style={{ color: 'var(--coral-bright)' }}>{error === 'AUTH_REQUIRED' || (error ?? '').includes('signed-in') ? t('signInForResume') : (error ?? t('private'))}</p>
        <Link href="/talent" style={{ color: 'var(--coral-bright)', fontWeight: 600, textDecoration: 'none' }}>← {t('back')}</Link>
      </PageContainer>
    );
  }

  const canHire = !!auth?.hasTenant && auth.user?.id !== profile.userId;

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <Link href="/talent" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>← {t('back')}</Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', margin: '16px 0 20px' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{profile.displayName ?? '—'}</h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '4px 0 0' }}>{profile.headline ?? profile.discipline ?? ''}</p>
          <div style={{ marginTop: 6 }}><RatingStars rating={profile.rating} count={profile.ratingCount} size={15} /></div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            {profile.hourlyRateCents != null && <span>{t('rate')}: <strong style={{ color: 'var(--coral-bright)' }}>{profile.currency} {(profile.hourlyRateCents / 100).toFixed(0)}{t('perHour')}</strong></span>}
            {profile.location && <span>{t('location')}: {profile.location}</span>}
            <span>{t('availability')}: {profile.availability}</span>
          </div>
        </div>
        {canHire && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={() => doHire('interviewing')} disabled={hireState === 'busy' || hireState !== 'idle'}
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              {t('interview')}
            </button>
            <button type="button" onClick={() => doHire('active')} disabled={hireState === 'busy' || hireState !== 'idle'}
              style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', fontWeight: 700, fontSize: 13, cursor: hireState === 'busy' ? 'wait' : 'pointer' }}>
              {hireState === 'busy' ? t('hiring') : hireState === 'hired' ? t('hired') : t('hire')}
            </button>
          </div>
        )}
      </div>
      {hireState === 'hired' && <div style={{ ...card, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', color: 'rgba(34,197,94,0.95)', fontSize: 13, marginBottom: 16 }}>{t('hired')} ✓</div>}
      {hireState === 'invited' && <div style={{ ...card, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.4)', color: 'rgba(59,130,246,0.95)', fontSize: 13, marginBottom: 16 }}>{t('invited')} ✓</div>}
      {hireError && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>{hireError}</div>}

      {profile.bio && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{t('about')}</div>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{profile.bio}</p>
        </div>
      )}

      {profile.skills.length > 0 && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{t('skills')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {profile.skills.map((s) => (
              <span key={s} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Reviews */}
      {profile.reviews && profile.reviews.length > 0 && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{t('reviews')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {profile.reviews.map((r, i) => (
              <div key={i} style={{ borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none', paddingTop: i > 0 ? 12 : 0 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
                  <RatingStars rating={r.rating} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.reviewerName ?? ''}</span>
                </div>
                {r.comment && <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{r.comment}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Embedded résumé viewer (hired.video) */}
      <div style={{ ...card }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{t('resumeTitle')}</div>
        {profile.embedUrl ? (
          <iframe title={t('resumeTitle')} src={profile.embedUrl}
            style={{ width: '100%', height: 560, border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--bg-elevated)' }} />
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{auth?.isAuthenticated ? t('noResume') : t('signInForResume')}</p>
        )}
      </div>
    </PageContainer>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { useOptionalAuth } from '@/lib/AuthContext';
import { TalentProfileView } from '@/components/freelance/TalentProfileView';
import { getFreelancer, hireFreelancer, type FreelancerProfile } from '@/lib/freelancerApi';
import { MessagesButton } from '@/components/freelance/MessagesButton';

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
        <Link href="/marketplace?category=talent" style={{ color: 'var(--coral-bright)', fontWeight: 600, textDecoration: 'none' }}>← {t('back')}</Link>
      </PageContainer>
    );
  }

  const isOwner = auth?.user?.id === profile.userId;
  const canHire = !!auth?.hasTenant && !isOwner;

  const actions = isOwner ? (
    <Link href="/freelancer/profile"
      style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
      {t('editProfile')}
    </Link>
  ) : canHire ? (
    <>
      <MessagesButton side="employer" context={{ freelancerUserId: profile.userId, title: profile.displayName ?? undefined }} label={t('message')} />
      <button type="button" onClick={() => doHire('interviewing')} disabled={hireState === 'busy' || hireState !== 'idle'}
        style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
        {t('interview')}
      </button>
      <button type="button" onClick={() => doHire('active')} disabled={hireState === 'busy' || hireState !== 'idle'}
        style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', fontWeight: 700, fontSize: 13, cursor: hireState === 'busy' ? 'wait' : 'pointer' }}>
        {hireState === 'busy' ? t('hiring') : hireState === 'hired' ? t('hired') : t('hire')}
      </button>
    </>
  ) : undefined;

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/marketplace?category=talent" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>← {t('back')}</Link>
      </div>

      {hireState === 'hired' && <div style={{ ...card, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', color: 'rgba(34,197,94,0.95)', fontSize: 13, marginBottom: 16 }}>{t('hired')} ✓</div>}
      {hireState === 'invited' && <div style={{ ...card, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.4)', color: 'rgba(59,130,246,0.95)', fontSize: 13, marginBottom: 16 }}>{t('invited')} ✓</div>}
      {hireError && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>{hireError}</div>}

      <TalentProfileView
        profile={profile}
        actions={actions}
        resumeEmptyNote={auth?.isAuthenticated ? t('noResume') : t('signInForResume')}
      />
    </PageContainer>
  );
}

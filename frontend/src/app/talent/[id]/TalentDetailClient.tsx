'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { useOptionalAuth } from '@/lib/AuthContext';
import { TalentProfileView } from '@/components/freelance/TalentProfileView';
import { hireFreelancer } from '@/lib/freelance/engagements';
import { getFreelancer, type FreelancerProfile } from '@/lib/freelance/talentProfile';
import { MessagesButton } from '@/components/freelance/MessagesButton';
import { ShortlistToggle } from '@/components/talent/ShortlistToggle';
import { Icon } from '@/components/ui/Icon';
import { faultMessage } from '@/lib/apiClient';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 20,
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
    getFreelancer(id).then(setProfile).catch((e: unknown) => setError(faultMessage(e))).finally(() => setLoading(false));
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
      style={{ padding: '9px 18px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontWeight: 600, fontSize: 'var(--font-size-small)', textDecoration: 'none' }}>
      {t('editProfile')}
    </Link>
  ) : canHire ? (
    <>
      {/* Shortlisting comes BEFORE hiring in the real sequence: a client comparing five
          people needs somewhere to put them that is not a browser tab. */}
      <ShortlistToggle freelancerUserId={profile.userId} />
      <MessagesButton side="employer" context={{ freelancerUserId: profile.userId, title: profile.displayName ?? undefined }} label={t('message')} />
      <button type="button" onClick={() => doHire('interviewing')} disabled={hireState === 'busy' || hireState !== 'idle'}
        style={{ padding: '9px 16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontWeight: 600, fontSize: 'var(--font-size-small)', cursor: 'pointer' }}>
        {t('interview')}
      </button>
      <button type="button" onClick={() => doHire('active')} disabled={hireState === 'busy' || hireState !== 'idle'}
        style={{ padding: '9px 18px', borderRadius: 'var(--radius-lg)', border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: 'var(--text-on-accent)', fontWeight: 700, fontSize: 'var(--font-size-small)', cursor: hireState === 'busy' ? 'wait' : 'pointer' }}>
        {hireState === 'busy' ? t('hiring') : hireState === 'hired' ? t('hired') : t('hire')}
      </button>
    </>
  ) : undefined;

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/marketplace?category=talent" style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', textDecoration: 'none' }}>← {t('back')}</Link>
      </div>

      {hireState === 'hired' && <div style={{ ...card, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', color: 'rgba(34,197,94,0.95)', fontSize: 'var(--font-size-small)', marginBottom: 16 }}><Icon name="check" size={14} /> {t('hired')}</div>}
      {hireState === 'invited' && <div style={{ ...card, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.4)', color: 'rgba(59,130,246,0.95)', fontSize: 'var(--font-size-small)', marginBottom: 16 }}><Icon name="check" size={14} /> {t('invited')}</div>}
      {hireError && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)', marginBottom: 16 }}>{hireError}</div>}

      <TalentProfileView
        profile={profile}
        actions={actions}
        resumeEmptyNote={auth?.isAuthenticated ? t('noResume') : t('signInForResume')}
      />
    </PageContainer>
  );
}

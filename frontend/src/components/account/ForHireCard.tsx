'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useAvailableForHire, useIsFreelancer } from '@/lib/rbac';

/**
 * Settings card that lets an EXISTING builder opt in to being hired talent — publish
 * a for-hire profile and pick up gigs while keeping the full builder shell. Decides
 * its own visibility (DRY): a dedicated freelancer account already lives in the gig
 * shell, so this renders nothing for them.
 */
const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 20,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-primary)',
  marginBottom: 14,
};

const linkBtn: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600,
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)', borderRadius: 8, textDecoration: 'none',
};

export default function ForHireCard() {
  const t = useTranslations('settings');
  const isFreelancer = useIsFreelancer();
  const available = useAvailableForHire();
  const { setAvailableForHire } = useAuth();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A dedicated freelancer account is always for-hire and uses the restricted gig
  // shell — this opt-in surface is only for builders.
  if (isFreelancer) return null;

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await setAvailableForHire(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('forHire.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...cardStyle, marginBottom: 20 }}>
      <div style={sectionTitle}>{t('forHire.title')}</div>

      {available ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>{t('forHire.onBody')}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/freelancer/profile" style={{ ...linkBtn, background: 'var(--surface-interactive)', color: 'var(--text-primary)' }}>
              {t('forHire.editProfile')} →
            </Link>
            <Link href="/freelancer/gigs" style={linkBtn}>
              {t('forHire.findWork')} →
            </Link>
            <button
              type="button"
              onClick={() => void toggle(false)}
              disabled={busy}
              style={{
                marginLeft: 'auto', padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
                background: 'none', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', borderRadius: 8,
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? t('forHire.disabling') : t('forHire.turnOff')}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>{t('forHire.offBody')}</p>
          <div>
            <button
              type="button"
              onClick={() => void toggle(true)}
              disabled={busy}
              style={{
                padding: '9px 18px', fontSize: 13, fontWeight: 700, borderRadius: 10, border: 'none', cursor: busy ? 'wait' : 'pointer',
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff',
                opacity: busy ? 0.6 : 1, letterSpacing: '0.02em',
              }}
            >
              {busy ? t('forHire.enabling') : t('forHire.offCta')}
            </button>
          </div>
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: 'var(--coral-bright)', margin: '12px 0 0' }}>{error}</p>}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { REGISTER_MARKETING } from '@/lib/content';
import MarketingVisual from './MarketingVisual';
import AccountTypeChooser, { type AccountType } from './AccountTypeChooser';

/**
 * Full-screen, blocking role chooser shown by the onboarding gate to an account
 * that was provisioned via OAuth / magic-link and never picked Build vs Hired on
 * the /register form. Mirrors the register split-panel: the same chooser buttons
 * on the left, a live marketing preview (visual + value props) on the right that
 * updates with the selection. Resolving it calls `onSelect`, which advances the
 * gate.
 */
export default function RoleChoiceScreen({
  onSelect,
}: {
  onSelect: (accountType: AccountType) => Promise<void>;
}) {
  const t = useTranslations('welcomeRole');
  const [selected, setSelected] = useState<AccountType>('standard');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const marketing = REGISTER_MARKETING[selected];

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onSelect(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-deep)',
        color: 'var(--text-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
        overflowY: 'auto',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 860,
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 20,
          boxShadow: '0 16px 48px var(--shadow-coral-soft)',
          padding: 'clamp(24px, 4vw, 40px)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span
            style={{
              display: 'inline-block', marginBottom: 12,
              fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'var(--coral-bright)', background: 'var(--surface-coral-soft)',
              border: '1px solid var(--border-accent)', borderRadius: 999, padding: '4px 12px',
              fontFamily: 'var(--font-display)',
            }}
          >
            {t('eyebrow')}
          </span>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.4rem, 3vw, 1.75rem)', fontWeight: 700, margin: '0 0 8px' }}>
            {t('title')}
          </h1>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            {t('subtitle')}
          </p>
        </div>

        {/* Two-column on desktop (chooser | live preview), stacked on mobile */}
        <div className="role-choice-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20, alignItems: 'start' }}>
          <div>
            <AccountTypeChooser value={selected} onChange={setSelected} />
          </div>

          {/* Live marketing preview for the current selection */}
          <div
            key={selected}
            className="role-choice-preview"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 14,
              padding: 18,
            }}
          >
            <MarketingVisual variant={selected} />
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700, margin: '0 0 6px' }}>
              {marketing.heading}
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
              {marketing.intro}
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {marketing.bullets.slice(0, 4).map((b) => (
                <li key={b.title} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ flexShrink: 0 }} aria-hidden>{b.icon}</span>
                  <span><strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{b.title}</strong> — {b.desc}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {error && (
          <div
            style={{
              marginTop: 20,
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.4)',
              color: '#f87171',
              borderRadius: 10,
              padding: '10px 14px',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            style={{
              padding: '13px 28px',
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '0.95rem',
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.6 : 1,
              boxShadow: '0 6px 20px var(--shadow-coral-mid)',
              letterSpacing: '0.02em',
            }}
          >
            {submitting ? t('saving') : t('continue')}
          </button>
        </div>
      </div>

      <style>{`
        @media (min-width: 720px) {
          .role-choice-grid { grid-template-columns: 1fr 1fr !important; }
        }
        .role-choice-preview { animation: roleChoiceFade 0.3s ease; }
        @keyframes roleChoiceFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) { .role-choice-preview { animation: none; } }
      `}</style>
    </div>
  );
}

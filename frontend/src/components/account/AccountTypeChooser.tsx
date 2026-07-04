'use client';

import { useTranslations } from 'next-intl';

export type AccountType = 'standard' | 'freelancer';

/**
 * The Build (standard) vs Hired (freelancer) radiogroup. The ONE place this
 * two-option choice is rendered, shared by the /register form and the post-OAuth
 * role chooser so the labels, order, and accessibility semantics never drift.
 */
export default function AccountTypeChooser({
  value,
  onChange,
}: {
  value: AccountType;
  onChange: (t: AccountType) => void;
}) {
  const tr = useTranslations('register');

  const options: { key: AccountType; icon: string; title: string; sub: string }[] = [
    { key: 'standard', icon: '🚀', title: tr('buildTitle'), sub: tr('buildSub') },
    { key: 'freelancer', icon: '💼', title: tr('hireTitle'), sub: tr('hireSub') },
  ];

  return (
    <div role="radiogroup" aria-label={tr('accountTypeAria')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.key)}
            style={{
              textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: '12px 14px',
              background: active ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
              border: `1px solid ${active ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
              boxShadow: active ? '0 0 0 3px var(--surface-coral-soft)' : 'none',
              transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
            }}
          >
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }} aria-hidden>{opt.icon}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{opt.title}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{opt.sub}</div>
          </button>
        );
      })}
    </div>
  );
}

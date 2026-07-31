'use client';

import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';

/**
 * Consent moment shown before a host first enables (or re-enables after a
 * consent-version bump) the embedded integration. Agreeing records the
 * acknowledged version server-side (`tenants.settings.embed.consentVersion`) so
 * the opt-in is auditable — same legal posture as the host-side embed consent.
 *
 * Rendered as a slide-out panel (not a modal): per the app convention, modals are
 * reserved for terminal / destructive approvals — a consent/opt-in form is neither.
 */

const button: React.CSSProperties = {
  padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
};

interface Props {
  version: number;
  onAgree: () => void;
  onCancel: () => void;
}

export function EmbedConsentModal({ version, onAgree, onCancel }: Props) {
  const t = useTranslations('embedConsent');
  const tc = useTranslations('common');
  return (
    <SlideOutPanel open onClose={onCancel} title={t('title')} width="min(560px, 96vw)">
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            {t.rich('bodyOne', { code: (chunks) => <code>{chunks}</code> })}
          </p>
          <p style={{ marginBottom: 0 }}>
            {t('bodyTwo')}
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ ...button, background: 'none', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            {tc('cancel')}
          </button>
          <button
            type="button"
            onClick={onAgree}
            style={{ ...button, background: 'var(--accent, #2563eb)', color: '#fff', border: 'none' }}
          >
            {t('agreeAndEnable')}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
          {t('consentVersion', { version })}
        </div>
      </div>
    </SlideOutPanel>
  );
}

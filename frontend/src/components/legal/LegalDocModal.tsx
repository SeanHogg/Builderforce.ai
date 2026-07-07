'use client';

import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { LegalDocPreview } from '@/components/admin/LegalDocPreview';
import type { LegalCurrent } from './useLegalDocs';

export type LegalModalType = 'terms' | 'privacy';

interface LegalDocModalProps {
  /** Which document to show, or null to render nothing. */
  type: LegalModalType | null;
  legal: LegalCurrent | null;
  onClose: () => void;
}

/**
 * The Terms/Privacy reader — shows the document content served by the API (no
 * external URL). Shared by the auth-screen footer and the sidebar legal menu so
 * the markup lives in one place.
 *
 * Rendered as a SlideOutPanel (not a modal): per the app convention, centered
 * modals are reserved for terminal / destructive approvals — every other overlay,
 * including read-only detail views like this one, is a slide-out side panel.
 */
export default function LegalDocModal({ type, legal, onClose }: LegalDocModalProps) {
  const t = useTranslations('legal');

  const doc = type === 'terms' ? legal?.terms : legal?.privacy;
  const modalTitle = type === 'terms' ? t('termsTitle') : t('privacyTitle');

  return (
    <SlideOutPanel
      open={type !== null}
      onClose={onClose}
      width="min(920px, 96vw)"
      title={`${doc?.title ?? modalTitle}${doc?.version ? ` · v${doc.version}` : ''}`}
    >
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {doc?.publishedAt && (
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {t('published', { date: new Date(doc.publishedAt).toLocaleString() })}
          </p>
        )}

        {doc?.content ? (
          <LegalDocPreview content={doc.content} />
        ) : (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('loading')}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 20px',
              fontSize: '0.9rem',
              fontWeight: 600,
              color: '#fff',
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              border: 'none',
              borderRadius: 10,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
            }}
          >
            {t('close')}
          </button>
        </div>
      </div>
    </SlideOutPanel>
  );
}

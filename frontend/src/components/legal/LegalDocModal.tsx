'use client';

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
 * The Terms/Privacy reader modal — shows the document content served by the
 * API (no external URL). Shared by the auth-screen footer and the sidebar
 * legal menu so the markup lives in one place.
 */
export default function LegalDocModal({ type, legal, onClose }: LegalDocModalProps) {
  if (type === null) return null;

  const doc = type === 'terms' ? legal?.terms : legal?.privacy;
  const modalTitle = type === 'terms' ? 'Terms of Use' : 'Privacy Policy';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          maxWidth: 920,
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '1.25rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-display)',
            }}
          >
            {doc?.title ?? modalTitle}
            {doc?.version ? ` · v${doc.version}` : ''}
          </h2>
          {doc?.publishedAt && (
            <p
              style={{
                margin: '6px 0 0',
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
              }}
            >
              Published {new Date(doc.publishedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 24,
          }}
        >
          {doc?.content ? (
            <LegalDocPreview content={doc.content} />
          ) : (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Loading…</p>
          )}
        </div>
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border-subtle)',
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
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
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

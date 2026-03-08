'use client';

import { useState, useEffect } from 'react';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0';
const AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';

interface LegalDocument {
  version: string;
  title: string;
  content: string;
  publishedAt: string;
}

interface LegalCurrent {
  terms: LegalDocument;
  privacy: LegalDocument;
}

export default function AppFooter() {
  const [legal, setLegal] = useState<LegalCurrent | null>(null);
  const [modalType, setModalType] = useState<'terms' | 'privacy' | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${AUTH_API_URL}/api/auth/legal/current`, { credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: LegalCurrent | null) => {
        if (!cancelled && data?.terms && data?.privacy) setLegal(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const termsVersion = legal?.terms?.version ?? '—';
  const doc = modalType === 'terms' ? legal?.terms : legal?.privacy;
  const modalTitle = modalType === 'terms' ? 'Terms of Use' : 'Privacy Policy';

  return (
    <>
      <footer className="global-footer">
        <div className="global-footer-inner">
          <span>
            App v{APP_VERSION} · Terms v{termsVersion}
          </span>
          <div className="global-footer-links">
            <button
              type="button"
              onClick={() => setModalType('terms')}
              className="global-footer-link"
            >
              Terms of Use
            </button>
            <button
              type="button"
              onClick={() => setModalType('privacy')}
              className="global-footer-link"
            >
              Privacy Policy
            </button>
          </div>
        </div>
      </footer>

      {/* Legal document modal (CoderClawLink-style: show content from API, no external URL) */}
      {modalType !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={modalTitle}
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalType(null);
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
              <pre
                style={{
                  margin: 0,
                  fontSize: '0.875rem',
                  lineHeight: 1.6,
                  color: 'var(--text-secondary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'var(--font-body)',
                }}
              >
                {doc?.content ?? 'Loading…'}
              </pre>
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
                onClick={() => setModalType(null)}
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
      )}
    </>
  );
}

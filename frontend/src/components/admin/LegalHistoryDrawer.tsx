'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type LegalDocVersion } from '@/lib/adminApi';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { LegalDocPreview } from '@/components/admin/LegalDocPreview';
import { fmtDateTime } from '@/components/admin/adminShared';

export interface LegalHistoryContext {
  docType: 'terms' | 'privacy';
}

interface LegalHistoryDrawerProps {
  context: LegalHistoryContext | null;
  onClose: () => void;
}

/**
 * Read-only version-history viewer for a legal document. Lists every publish +
 * amend (newest first) from `GET /admin/legal/history` and lets the reviewer
 * expand any entry to read its full document-scale content.
 */
export function LegalHistoryDrawer({ context, onClose }: LegalHistoryDrawerProps) {
  const t = useTranslations('admin');
  const [versions, setVersions] = useState<LegalDocVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const label = context?.docType === 'privacy' ? t('legal.editor.privacyLabel') : t('legal.editor.termsLabel');

  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setExpanded(null);
    adminApi
      .legalHistory(context.docType)
      .then((rows) => {
        if (cancelled) return;
        setVersions(rows);
        setExpanded(rows.length ? rows[0].id : null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [context]);

  return (
    <SlideOutPanel
      open={!!context}
      onClose={onClose}
      title={`${t('legal.history.title')} · ${label}`}
      width="min(760px, 96vw)"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading && <div className="text-muted" style={{ fontSize: 13 }}>{t('legal.history.loading')}</div>}
        {error && <div className="admin-error">{error}</div>}
        {!loading && !error && versions.length === 0 && (
          <div className="text-muted" style={{ fontSize: 13 }}>{t('legal.history.empty')}</div>
        )}
        {versions.map((v) => {
          const isOpen = expanded === v.id;
          return (
            <div
              key={v.id}
              className="health-card"
              style={{ padding: 0, overflow: 'hidden' }}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : v.id)}
                aria-expanded={isOpen}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  padding: '12px 14px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--text-primary)',
                }}
              >
                <span aria-hidden style={{ color: 'var(--text-muted)' }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ fontWeight: 600 }}>v{v.version}</span>
                <span
                  className="health-label"
                  style={{
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                  }}
                >
                  {v.changeKind === 'amend' ? t('legal.history.amend') : t('legal.history.publish')}
                </span>
                <span className="text-muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
                  {fmtDateTime(v.createdAt)}
                </span>
              </button>
              {isOpen && (
                <div
                  style={{
                    borderTop: '1px solid var(--border-subtle)',
                    padding: 16,
                    maxHeight: 420,
                    overflowY: 'auto',
                    background: 'var(--bg-deep)',
                  }}
                >
                  <LegalDocPreview content={v.content} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SlideOutPanel>
  );
}

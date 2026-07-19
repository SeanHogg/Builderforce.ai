'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi } from '@/lib/adminApi';
import { fmtDateTime, useAdminData, AdminError, AdminLoading } from '@/components/admin/adminShared';
import { LegalDocPreview } from '@/components/admin/LegalDocPreview';
import { LegalEditorDrawer, type LegalEditorContext } from '@/components/admin/LegalEditorDrawer';
import { LegalHistoryDrawer, type LegalHistoryContext } from '@/components/admin/LegalHistoryDrawer';

export default function LegalPanel() {
  const t = useTranslations('admin');
  const { data: legalCurrent, loading, error, reload } = useAdminData(() => adminApi.legalCurrent(), []);
  const [legalEditor, setLegalEditor] = useState<LegalEditorContext | null>(null);
  const [legalHistory, setLegalHistory] = useState<LegalHistoryContext | null>(null);

  const openLegalEditor = (docType: 'terms' | 'privacy', mode: 'edit' | 'new') => {
    setLegalEditor({ docType, mode, current: legalCurrent ? legalCurrent[docType] : null });
  };

  if (loading && !legalCurrent) return <AdminLoading />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <AdminError message={error} />
      {legalCurrent && (
        <>
          <div className="health-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {(['terms', 'privacy'] as const).map((dt) => {
              const doc = legalCurrent[dt];
              return (
                <div key={dt} className="health-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="health-label">{dt === 'terms' ? t('legal.termsVersion') : t('legal.privacyVersion')}</div>
                  <div className="health-value" style={{ fontSize: 16 }}>v{doc.version}</div>
                  <div style={{ fontSize: 12 }}>{doc.title}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    {t('legal.published', { date: doc.publishedAt ? fmtDateTime(doc.publishedAt) : '—' })}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn-ghost" onClick={() => openLegalEditor(dt, 'edit')}>
                      ✎ {t('common.edit')}
                    </button>
                    <button type="button" className="admin-tab active" onClick={() => openLegalEditor(dt, 'new')}>
                      + {t('legal.newVersion')}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setLegalHistory({ docType: dt })}>
                      🕑 {t('legal.history.button')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {(['terms', 'privacy'] as const).map((dt) => (
            <div key={dt} className="health-card" style={{ padding: 16 }}>
              <div className="health-label" style={{ marginBottom: 8 }}>
                {dt === 'terms'
                  ? t('legal.currentTerms', { version: legalCurrent[dt].version })
                  : t('legal.currentPrivacy', { version: legalCurrent[dt].version })}
              </div>
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                <LegalDocPreview content={legalCurrent[dt].content} />
              </div>
            </div>
          ))}
        </>
      )}
      {/* Legal editor slide-out */}
      <LegalEditorDrawer
        context={legalEditor}
        onClose={() => setLegalEditor(null)}
        onPublished={reload}
      />
      {/* Version-history slide-out */}
      <LegalHistoryDrawer
        context={legalHistory}
        onClose={() => setLegalHistory(null)}
      />
    </div>
  );
}

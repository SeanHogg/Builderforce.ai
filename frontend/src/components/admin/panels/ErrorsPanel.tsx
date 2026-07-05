'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi } from '@/lib/adminApi';
import { AdminError, AdminLoading, fmtDateTime, useAdminData } from '../adminShared';

export default function ErrorsPanel() {
  const t = useTranslations('admin');
  const { data: errors, loading, error, reload } = useAdminData(() => adminApi.errors(), []);
  const [expandedErrorId, setExpandedErrorId] = useState<number | null>(null);

  if (loading && !errors) return <AdminLoading />;

  const rows = errors ?? [];

  return (
    <div>
      <AdminError message={error} />
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="text-muted" style={{ fontSize: 14 }}>{t('errors.lastN', { n: 200 })}</span>
        <button type="button" className="btn-ghost" onClick={() => reload()}>
          ↻ {t('common.refresh')}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted" style={{ padding: 24 }}>{t('errors.noErrorsRecorded')}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>{t('errors.time')}</th>
                <th>{t('errors.method')}</th>
                <th>{t('errors.path')}</th>
                <th>{t('errors.message')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <React.Fragment key={e.id}>
                  <tr
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedErrorId(expandedErrorId === e.id ? null : e.id)}
                    onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setExpandedErrorId(expandedErrorId === e.id ? null : e.id); } }}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ verticalAlign: 'middle' }}>
                      <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: expandedErrorId === e.id ? 'rotate(90deg)' : 'none' }}>▶</span>
                    </td>
                    <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.createdAt)}</td>
                    <td>{e.method ?? '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{e.path ?? '—'}</td>
                    <td style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.message ?? undefined}>
                      {e.message ?? '—'}
                    </td>
                  </tr>
                  {expandedErrorId === e.id && e.stack && (
                    <tr>
                      <td colSpan={5} style={{ padding: 0, verticalAlign: 'top' }}>
                        <pre style={{ margin: 0, padding: 12, fontSize: 11, fontFamily: 'var(--mono)', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {e.stack}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { knowledgeApi, type TrainingItem, type TenantCompliance } from '@/lib/knowledgeApi';
import { badge } from './KnowledgeClient';

function stateColor(state: string): React.CSSProperties {
  if (state === 'completed' || state === 'acknowledged')
    return { background: 'var(--success-bg, #0f3d2e)', color: 'var(--success-text, #4ade80)' };
  if (state === 'overdue') return { background: 'var(--error-bg, #3d0f0f)', color: 'var(--error-text, #f87171)' };
  return { background: 'var(--warning-bg, #3d320f)', color: 'var(--warning-text, #fbbf24)' };
}

/**
 * "My training" — the current user's assigned reading. Surfaced as a section of
 * the unified Knowledge home (it used to be its own tab).
 */
export function MyTrainingSection() {
  const t = useTranslations('knowledge');
  const [mine, setMine] = useState<TrainingItem[]>([]);
  const [loadedMine, setLoadedMine] = useState(false);

  useEffect(() => {
    knowledgeApi
      .myTraining()
      .then(setMine)
      .catch(() => setMine([]))
      .finally(() => setLoadedMine(true));
  }, []);

  // Nothing assigned and nothing to show → render nothing (keeps the home tidy).
  if (loadedMine && mine.length === 0) return null;

  return (
    <section>
      <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>{t('myTraining')}</h2>
      {!loadedMine && <div style={{ color: 'var(--text-muted, #9ca3af)' }}>{t('loading')}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {mine.map((item) => (
          <Link
            key={item.id}
            href={`/knowledge/${item.documentId}`}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              borderRadius: 10,
              border: '1px solid var(--border, #333)',
              background: 'var(--surface, #1a1a1a)',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{item.title}</div>
              {item.dueAt && (
                <div style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)' }}>
                  {t('due')}: {new Date(item.dueAt).toLocaleDateString()}
                </div>
              )}
            </div>
            <span style={{ ...badge, ...stateColor(item.state) }}>{t(`state_${item.state}`)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * Manager-only tenant-wide compliance audit: who has read & acknowledged the
 * documents that require it, with overdue tracking. Self-gates via RoleGate so
 * the consumer just drops it on the page.
 */
export function ComplianceAuditSection() {
  return (
    <RoleGate capability="knowledge.assignTraining" variant="block">
      <ComplianceAudit />
    </RoleGate>
  );
}

function ComplianceAudit() {
  const t = useTranslations('knowledge');
  const [data, setData] = useState<TenantCompliance | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    knowledgeApi
      .tenantCompliance()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <section>
      <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>{t('complianceAudit')}</h2>
      {!loaded && <div style={{ color: 'var(--text-muted, #9ca3af)' }}>{t('loading')}</div>}
      {loaded && data && (
        <>
          <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
            <Stat label={t('overallCompliance')} value={`${data.totals.percent}%`} />
            <Stat label={t('required')} value={String(data.totals.required)} />
            <Stat label={t('acknowledged')} value={String(data.totals.acknowledged)} />
            <Stat label={t('overdue')} value={String(data.totals.overdue)} danger={data.totals.overdue > 0} />
          </div>
          {data.documents.length === 0 ? (
            <div style={{ color: 'var(--text-muted, #9ca3af)' }}>{t('noComplianceDocs')}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted, #9ca3af)' }}>
                    <th style={th}>{t('document')}</th>
                    <th style={th}>{t('percentComplete')}</th>
                    <th style={th}>{t('acknowledged')}</th>
                    <th style={th}>{t('pending')}</th>
                    <th style={th}>{t('overdue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.documents.map((d) => (
                    <tr key={d.documentId} style={{ borderTop: '1px solid var(--border, #333)' }}>
                      <td style={td}>
                        <Link href={`/knowledge/${d.documentId}`} style={{ color: 'var(--accent, #60a5fa)' }}>
                          {d.title}
                        </Link>
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 80, height: 6, borderRadius: 3, background: 'var(--surface-2, #222)' }}>
                            <div
                              style={{
                                width: `${d.percent}%`,
                                height: '100%',
                                borderRadius: 3,
                                background: d.percent >= 100 ? 'var(--success-text, #4ade80)' : 'var(--accent, #2563eb)',
                              }}
                            />
                          </div>
                          <span>{d.percent}%</span>
                        </div>
                      </td>
                      <td style={td}>{d.acknowledged}</td>
                      <td style={td}>{d.pending}</td>
                      <td style={{ ...td, color: d.overdue > 0 ? 'var(--error-text, #f87171)' : undefined }}>{d.overdue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div
      style={{
        padding: '12px 18px',
        borderRadius: 10,
        border: '1px solid var(--border, #333)',
        background: 'var(--surface, #1a1a1a)',
        minWidth: 110,
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: danger ? 'var(--error-text, #f87171)' : undefined }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)' }}>{label}</div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '8px 12px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px 12px' };

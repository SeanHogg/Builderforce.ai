'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { knowledgeApi, type KnowledgeDoc } from '@/lib/knowledgeApi';
import { RoleGate } from '@/components/RoleGate';

const DOC_TYPE_COLOR: Record<KnowledgeDoc['docType'], string> = {
  sop: 'var(--cyan-bright, #00e5cc)',
  process: 'var(--coral-bright, #f4726e)',
  doc: 'var(--text-muted)',
  postmortem: 'var(--error-text, #ef4444)',
  known_error: 'var(--warning-text, #f59e0b)',
};

/**
 * Knowledge dashboard tab — a compact list of the tenant's knowledge base
 * (SOPs / processes / docs) that deep-links each row into the full document
 * page. Follows the global project scope and reuses the shared knowledgeApi, so
 * no new fetch surface is introduced.
 */
export function DashboardKnowledgeTab({ limit }: { limit?: number }) {
  const t = useTranslations('dashboard');
  const { currentProjectId } = useProjectScope();
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    knowledgeApi
      .list({ project: currentProjectId })
      .then((list) => { if (alive) setDocs(Array.isArray(list) ? list : []); })
      .catch(() => { if (alive) setDocs([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [currentProjectId]);

  if (loading) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '8px 0' }}>{t('knowledge.loading')}</div>;
  }

  if (docs.length === 0) {
    return (
      <div
        style={{
          border: '1px dashed var(--border-subtle)',
          borderRadius: 12,
          padding: '28px 16px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        <p style={{ margin: '0 0 12px', fontSize: 14 }}>{t('knowledge.empty')}</p>
        <RoleGate capability="knowledge.create">
          <Link
            href="/knowledge/new"
            style={{
              display: 'inline-block',
              padding: '8px 16px',
              borderRadius: 8,
              background: 'var(--coral-bright)',
              color: '#fff',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {t('knowledge.create')}
          </Link>
        </RoleGate>
      </div>
    );
  }

  const visible = limit != null ? docs.slice(0, limit) : docs;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12, gap: 12 }}>
        <RoleGate capability="knowledge.create">
          <Link href="/knowledge/new" style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
            {t('knowledge.create')}
          </Link>
        </RoleGate>
        <Link href="/knowledge" style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
          {t('knowledge.viewAll')} →
        </Link>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {visible.map((doc) => (
          <Link
            key={doc.id}
            href={`/knowledge/${doc.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              background: 'var(--bg-elevated)',
              textDecoration: 'none',
              color: 'var(--text-primary)',
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: DOC_TYPE_COLOR[doc.docType],
                whiteSpace: 'nowrap',
              }}
            >
              {t(`knowledge.type.${doc.docType}`)}
            </span>
            <span style={{ flex: 1, fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {doc.title}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>v{doc.versionNumber}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

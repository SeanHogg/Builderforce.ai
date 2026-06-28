'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { usePermission } from '@/lib/rbac';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import {
  knowledgeApi,
  type KnowledgeDoc,
  type DocType,
} from '@/lib/knowledgeApi';
import KnowledgeTraining from './KnowledgeTraining';

type Tab = '' | 'processes' | 'docs' | 'training';

const TAB_TO_TYPE: Record<Exclude<Tab, 'training'>, DocType> = {
  '': 'sop',
  processes: 'process',
  docs: 'doc',
};

function statusColor(status: string): { bg: string; fg: string } {
  if (status === 'published') return { bg: 'var(--success-bg, #0f3d2e)', fg: 'var(--success-text, #4ade80)' };
  if (status === 'archived') return { bg: 'var(--surface-2, #2a2a2a)', fg: 'var(--text-muted, #9ca3af)' };
  return { bg: 'var(--warning-bg, #3d320f)', fg: 'var(--warning-text, #fbbf24)' };
}

export default function KnowledgeClient() {
  const t = useTranslations('knowledge');
  const params = useSearchParams();
  const tab = (params.get('tab') ?? '') as Tab;
  const scope = useOptionalProjectScope();
  const projectId = scope?.currentProjectId ?? null;
  const canManage = usePermission('knowledge.create').allowed;

  if (tab === 'training') {
    return (
      <PageContainer>
        <KnowledgeTraining />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <DocList docType={TAB_TO_TYPE[tab]} projectId={projectId} canManage={canManage} t={t} />
    </PageContainer>
  );
}

function DocList({
  docType,
  projectId,
  canManage,
  t,
}: {
  docType: DocType;
  projectId: number | null;
  canManage: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoaded(false);
    knowledgeApi
      .list({ type: docType, project: projectId, tag: tagFilter || undefined, q: search || undefined })
      .then(setDocs)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  }, [docType, projectId, tagFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    knowledgeApi.tags().then(setAllTags).catch(() => setAllTags([]));
  }, [docType]);

  const heading = useMemo(() => {
    if (docType === 'sop') return t('headingSops');
    if (docType === 'process') return t('headingProcesses');
    return t('headingDocs');
  }, [docType, t]);

  const subtitle = useMemo(() => {
    if (docType === 'sop') return t('subtitleSops');
    if (docType === 'process') return t('subtitleProcesses');
    return t('subtitleDocs');
  }, [docType, t]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>{heading}</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted, #9ca3af)', maxWidth: 640 }}>{subtitle}</p>
        </div>
        <RoleGate capability="knowledge.create">
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!canManage}
            style={btnPrimary}
          >
            + {t('newDocument')}
          </button>
        </RoleGate>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '18px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          style={inputStyle}
        />
        {allTags.length > 0 && (
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} style={inputStyle}>
            <option value="">{t('allTags')}</option>
            {allTags.map((tg) => (
              <option key={tg} value={tg}>
                {tg}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <div style={{ color: 'var(--error-text, #f87171)' }}>{error}</div>}
      {!loaded && <div style={{ color: 'var(--text-muted, #9ca3af)' }}>{t('loading')}</div>}
      {loaded && docs.length === 0 && (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted, #9ca3af)' }}>{t('empty')}</div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {docs.map((doc) => (
          <Link
            key={doc.id}
            href={`/knowledge/${doc.id}`}
            style={{
              display: 'block',
              padding: 16,
              borderRadius: 10,
              border: '1px solid var(--border, #333)',
              background: 'var(--surface, #1a1a1a)',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 16 }}>{doc.title}</span>
              <span style={{ ...badge, ...statusColorStyle(doc.status) }}>{t(`status_${doc.status}`)}</span>
            </div>
            {doc.summary && (
              <p style={{ margin: '6px 0 0', color: 'var(--text-muted, #9ca3af)', fontSize: 14 }}>{doc.summary}</p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {doc.requiresAck && <span style={{ ...badge, ...statusColorStyle('warning') }}>{t('requiresAckBadge')}</span>}
              {doc.versionNumber > 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)' }}>v{doc.versionNumber}</span>
              )}
              {doc.tags.map((tg) => (
                <span key={tg} style={tagChip}>
                  {tg}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      {creating && (
        <CreateModal
          docType={docType}
          projectId={projectId}
          t={t}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
            knowledgeApi.tags().then(setAllTags).catch(() => {});
          }}
        />
      )}
    </div>
  );
}

function CreateModal({
  docType,
  projectId,
  t,
  onClose,
  onCreated,
}: {
  docType: DocType;
  projectId: number | null;
  t: ReturnType<typeof useTranslations>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [requiresAck, setRequiresAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await knowledgeApi.create({ title: title.trim(), summary: summary.trim() || undefined, docType, projectId, requiresAck });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setSaving(false);
    }
  }

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{t('createTitle')}</h2>
        <label style={label}>{t('fieldTitle')}</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} autoFocus />
        <label style={label}>{t('fieldSummary')}</label>
        <input value={summary} onChange={(e) => setSummary(e.target.value)} style={inputStyle} />
        <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} />
          {t('requiresAckLabel')}
        </label>
        {error && <div style={{ color: 'var(--error-text, #f87171)', marginTop: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={onClose} style={btnGhost}>
            {t('cancel')}
          </button>
          <button type="button" onClick={submit} disabled={saving || !title.trim()} style={btnPrimary}>
            {saving ? t('creating') : t('create')}
          </button>
        </div>
      </div>
    </div>
  );
}

function statusColorStyle(status: string): { background: string; color: string } {
  const c = statusColor(status);
  return { background: c.bg, color: c.fg };
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border, #333)',
  background: 'var(--surface-2, #111)',
  color: 'inherit',
  minWidth: 180,
  flex: '0 1 auto',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent, #2563eb)',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
};
const btnGhost: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid var(--border, #333)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};
const badge: React.CSSProperties = { fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 600 };
const tagChip: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 6,
  background: 'var(--surface-2, #222)',
  color: 'var(--text-muted, #9ca3af)',
};
const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, margin: '14px 0 6px' };
const modalOverlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 16,
};
const modalCard: React.CSSProperties = {
  width: '100%',
  maxWidth: 480,
  background: 'var(--surface, #1a1a1a)',
  border: '1px solid var(--border, #333)',
  borderRadius: 12,
  padding: 24,
};

export { inputStyle, btnPrimary, btnGhost, badge, tagChip, label, modalOverlay, modalCard, statusColorStyle };

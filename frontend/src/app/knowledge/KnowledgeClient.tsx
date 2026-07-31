'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { Select } from '@/components/Select';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { GaugeChart } from '@/components/charts/GaugeChart';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { colorAt } from '@/components/charts/chartColors';
import {
  knowledgeApi,
  type KnowledgeDoc,
  type KnowledgeOverview,
  type KnowledgeTemplate,
  type DocType,
} from '@/lib/knowledgeApi';
import { MyTrainingSection, ComplianceAuditSection } from './KnowledgeTraining';
import { useCreateKnowledge } from './useCreateKnowledge';

/**
 * Unified Knowledge home. SOPs, Processes and Documents are no longer separate
 * surfaces — they are one template-driven library. The home leads with a
 * coverage dashboard (how much knowledge exists, by type, how fresh, and which
 * STANDARD SOPs are still missing), surfaces the training + compliance lens, and
 * then lists the library itself filtered by template type. Creation is a Google-
 * Docs-style template gallery (/knowledge/new), never a modal.
 */

const DOC_TYPE_LABELS: Record<DocType, string> = { sop: 'type_sop', process: 'type_process', doc: 'type_doc', postmortem: 'type_postmortem', known_error: 'type_known_error' };

function statusColor(status: string): { bg: string; fg: string } {
  if (status === 'published') return { bg: 'var(--success-bg, #0f3d2e)', fg: 'var(--success-text, #4ade80)' };
  if (status === 'archived') return { bg: 'var(--surface-2, #2a2a2a)', fg: 'var(--text-muted, #9ca3af)' };
  return { bg: 'var(--warning-bg, #3d320f)', fg: 'var(--warning-text, #fbbf24)' };
}

export default function KnowledgeClient() {
  const t = useTranslations('knowledge');
  const scope = useOptionalProjectScope();
  const projectId = scope?.currentProjectId ?? null;

  return (
    <PageContainer>
      <div style={{ display: 'grid', gap: 32 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24 }}>{t('homeTitle')}</h1>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted, #9ca3af)', maxWidth: 680 }}>{t('homeSubtitle')}</p>
          </div>
          <RoleGate capability="knowledge.create">
            <Link href="/knowledge/new" style={{ ...btnPrimary, textDecoration: 'none' }}>
              + {t('newDocument')}
            </Link>
          </RoleGate>
        </header>

        <OverviewDashboard t={t} projectId={projectId} />

        <MyTrainingSection />
        <ComplianceAuditSection />

        <Library projectId={projectId} t={t} />
      </div>
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Overview dashboard — coverage gauge, counts, freshness, and gap analysis.
// ---------------------------------------------------------------------------

function OverviewDashboard({ t, projectId }: { t: ReturnType<typeof useTranslations>; projectId: number | null }) {
  const [data, setData] = useState<KnowledgeOverview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { create, creatingKey } = useCreateKnowledge(projectId);

  useEffect(() => {
    knowledgeApi
      .overview()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <div style={{ color: 'var(--text-muted, #9ca3af)' }}>{t('loading')}</div>;
  if (!data) return null;

  const { counts, coverage, stale, gaps } = data;
  const coverageColor =
    coverage.score >= 75 ? 'var(--success-text, #22c55e)' : coverage.score >= 40 ? '#f59e0b' : 'var(--error-text, #ef4444)';

  const typeBars: BarDatum[] = [
    { key: 'sop', label: t('type_sop'), value: counts.sop, color: colorAt(0) },
    { key: 'process', label: t('type_process'), value: counts.process, color: colorAt(1) },
    { key: 'doc', label: t('type_doc'), value: counts.doc, color: colorAt(2) },
  ];

  return (
    <section style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <Panel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <GaugeChart
              value={coverage.score}
              color={coverageColor}
              size={120}
              centerValue={`${coverage.score}%`}
              ariaLabel={t('coverageAria')}
            />
            <div>
              <div style={{ fontWeight: 600 }}>{t('coverageTitle')}</div>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted, #9ca3af)' }}>
                {t('coverageDetail', { present: coverage.present, total: coverage.total })}
              </p>
            </div>
          </div>
        </Panel>
        <Panel>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('byType')}</div>
          <BarChart data={typeBars} ariaLabel={t('byType')} formatValue={(v) => String(Math.round(v))} labelWidth={88} />
        </Panel>
        <Panel>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('library')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <MiniStat label={t('total')} value={counts.total} />
            <MiniStat label={t('status_published')} value={counts.published} />
            <MiniStat label={t('status_draft')} value={counts.draft} />
            <MiniStat label={t('stale')} value={stale} danger={stale > 0} />
          </div>
        </Panel>
      </div>

      {gaps.length > 0 && (
        <Panel>
          <div style={{ fontWeight: 600 }}>{t('gapsTitle')}</div>
          <p style={{ margin: '4px 0 14px', fontSize: 13, color: 'var(--text-muted, #9ca3af)' }}>{t('gapsSubtitle')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {gaps.map((g) => (
              <GapCard key={g.key} gap={g} t={t} busy={creatingKey === g.key} onCreate={() => create({ templateKey: g.key })} />
            ))}
          </div>
        </Panel>
      )}
    </section>
  );
}

function GapCard({
  gap,
  t,
  busy,
  onCreate,
}: {
  gap: KnowledgeTemplate;
  t: ReturnType<typeof useTranslations>;
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        border: '1px dashed var(--border, #444)',
        background: 'var(--surface-2, #161616)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{gap.title}</span>
        <span style={{ ...badge, ...statusColorStyle('warning') }}>{t(DOC_TYPE_LABELS[gap.docType])}</span>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #9ca3af)' }}>{gap.summary}</p>
      <button type="button" onClick={onCreate} disabled={busy} style={{ ...btnGhost, alignSelf: 'flex-start' }}>
        {busy ? t('creating') : t('createFromTemplate')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Library — the unified, type-filterable document list.
// ---------------------------------------------------------------------------

const TYPE_FILTERS: Array<{ id: '' | DocType; labelKey: string }> = [
  { id: '', labelKey: 'filterAll' },
  { id: 'sop', labelKey: 'type_sop' },
  { id: 'process', labelKey: 'type_process' },
  { id: 'doc', labelKey: 'type_doc' },
  { id: 'postmortem', labelKey: 'type_postmortem' },
  { id: 'known_error', labelKey: 'type_known_error' },
];

function Library({ projectId, t }: { projectId: number | null; t: ReturnType<typeof useTranslations> }) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<'' | DocType>('');
  const [tagFilter, setTagFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoaded(false);
    knowledgeApi
      .list({ type: typeFilter || undefined, project: projectId, tag: tagFilter || undefined, q: search || undefined })
      .then(setDocs)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  }, [typeFilter, projectId, tagFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    knowledgeApi.tags().then(setAllTags).catch(() => setAllTags([]));
  }, []);

  return (
    <section data-tour="demo-knowledge">
      <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>{t('allKnowledge')}</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.id || 'all'}
              type="button"
              onClick={() => setTypeFilter(f.id)}
              style={typeFilter === f.id ? chipActive : chip}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} style={inputStyle} />
        {allTags.length > 0 && (
          <Select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} style={inputStyle}>
            <option value="">{t('allTags')}</option>
            {allTags.map((tg) => (
              <option key={tg} value={tg}>
                {tg}
              </option>
            ))}
          </Select>
        )}
      </div>

      {error && <div style={{ color: 'var(--error-text, #f87171)' }}>{error}</div>}
      {!loaded && <div style={{ color: 'var(--text-muted, #9ca3af)' }}>{t('loading')}</div>}
      {loaded && docs.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted, #9ca3af)' }}>{t('empty')}</div>
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
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ ...badge, background: 'var(--surface-2, #222)', color: 'var(--text-muted, #9ca3af)' }}>
                  {t(DOC_TYPE_LABELS[doc.docType])}
                </span>
                <span style={{ ...badge, ...statusColorStyle(doc.status) }}>{t(`status_${doc.status}`)}</span>
              </span>
            </div>
            {doc.summary && <p style={{ margin: '6px 0 0', color: 'var(--text-muted, #9ca3af)', fontSize: 14 }}>{doc.summary}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {doc.requiresAck && <span style={{ ...badge, ...statusColorStyle('warning') }}>{t('requiresAckBadge')}</span>}
              {doc.versionNumber > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)' }}>v{doc.versionNumber}</span>}
              {doc.tags.map((tg) => (
                <span key={tg} style={tagChip}>
                  {tg}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 18, borderRadius: 12, border: '1px solid var(--border, #333)', background: 'var(--surface, #1a1a1a)' }}>
      {children}
    </div>
  );
}

function MiniStat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: danger ? 'var(--error-text, #f87171)' : undefined }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)' }}>{label}</div>
    </div>
  );
}

function statusColorStyle(status: string): { background: string; color: string } {
  const c = statusColor(status);
  return { background: c.bg, color: c.fg };
}

// ---------------------------------------------------------------------------
// Shared styles — also consumed by the doc editor + training sections. Keep the
// named exports stable (KnowledgeDocClient + KnowledgeTraining import them).
// ---------------------------------------------------------------------------

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
const chip: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid var(--border, #333)',
  background: 'transparent',
  color: 'var(--text-muted, #9ca3af)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
};
const chipActive: React.CSSProperties = {
  ...chip,
  background: 'var(--accent, #2563eb)',
  borderColor: 'var(--accent, #2563eb)',
  color: '#fff',
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

export { inputStyle, btnPrimary, btnGhost, badge, tagChip, label, statusColorStyle };

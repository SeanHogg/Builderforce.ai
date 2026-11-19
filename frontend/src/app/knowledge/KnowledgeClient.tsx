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
import { badge, btnGhost, btnPrimary, chip, chipActive, inputStyle, statusColorStyle, tagChip } from './knowledgeStyles';
import { useCreateKnowledge } from './useCreateKnowledge';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { Collection } from '@/components/collection/Collection';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import type { Page, PageQuery } from '@/components/collection/collectionTypes';
import { useServerSource } from '@/components/collection/sources';
import { useCollectionSort } from '@/components/collection/useCollectionSort';
import { useCollectionPaging } from '@/components/collection/useCollectionPaging';
import { useCollectionPreferences } from '@/components/collection/collectionPreferences';

/**
 * Unified Knowledge home. SOPs, Processes and Documents are no longer separate
 * surfaces — they are one template-driven library. The home leads with a
 * coverage dashboard (how much knowledge exists, by type, how fresh, and which
 * STANDARD SOPs are still missing), surfaces the training + compliance lens, and
 * then lists the library itself filtered by template type. Creation is a Google-
 * Docs-style template gallery (/knowledge/new), never a modal.
 */

const DOC_TYPE_LABELS: Record<DocType, string> = { sop: 'type_sop', process: 'type_process', doc: 'type_doc', postmortem: 'type_postmortem', known_error: 'type_known_error' };

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
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', maxWidth: 680 }}>{t('homeSubtitle')}</p>
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

  if (!loaded) return <div style={{ color: 'var(--text-muted)' }}>{t('loading')}</div>;
  if (!data) return null;

  const { counts, coverage, stale, gaps } = data;
  const coverageColor =
    coverage.score >= 75 ? 'var(--success-text, var(--success))' : coverage.score >= 40 ? 'var(--warning)' : 'var(--error-text)';

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
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
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
          <p style={{ margin: '4px 0 14px', fontSize: 13, color: 'var(--text-muted)' }}>{t('gapsSubtitle')}</p>
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
        borderRadius: 'var(--radius-lg)',
        border: '1px dashed var(--border)',
        background: 'var(--surface-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{gap.title}</span>
        <span style={{ ...badge, ...statusColorStyle('warning') }}>{t(DOC_TYPE_LABELS[gap.docType])}</span>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{gap.summary}</p>
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
  const errorMessage = useErrorMessage();
  const [allTags, setAllTags] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<'' | DocType>('');
  const [tagFilter, setTagFilter] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    knowledgeApi.tags().then(setAllTags).catch(() => setAllTags([]));
  }, []);

  // Knowledge documents have no bulk entity key, so the library is a READ-ONLY collection (entity null).
  const descriptor = useMemo<CollectionDescriptor<KnowledgeDoc>>(
    () => ({
      entity: null,
      surfaceKey: 'knowledge.library',
      rowId: (d) => d.id,
      label: (d) => d.title,
      defaultView: 'card',
      defaultSort: { key: 'title', dir: 'asc' },
      emptyKey: 'emptyKnowledge',
      columns: [
        {
          key: 'title',
          header: t('colTitle'),
          sortKey: 'title',
          compare: (a, b) => a.title.localeCompare(b.title),
          cell: (d) => (
            <Link href={`/knowledge/${d.id}`} style={{ fontWeight: 600, color: 'inherit', textDecoration: 'none' }}>
              {d.title}
            </Link>
          ),
        },
        {
          key: 'type',
          header: t('colType'),
          sortKey: 'type',
          compare: (a, b) => a.docType.localeCompare(b.docType),
          cell: (d) => (
            <span style={{ ...badge, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{t(DOC_TYPE_LABELS[d.docType])}</span>
          ),
        },
        {
          key: 'status',
          header: t('colStatus'),
          sortKey: 'status',
          compare: (a, b) => a.status.localeCompare(b.status),
          cell: (d) => <span style={{ ...badge, ...statusColorStyle(d.status) }}>{t(`status_${d.status}`)}</span>,
        },
        {
          key: 'version',
          header: t('colVersion'),
          sortKey: 'version',
          align: 'end',
          compare: (a, b) => a.versionNumber - b.versionNumber,
          cell: (d) => (d.versionNumber > 0 ? `v${d.versionNumber}` : '—'),
        },
        {
          key: 'tags',
          header: t('colTags'),
          cell: (d) => (
            <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
              {d.requiresAck && <span style={{ ...badge, ...statusColorStyle('warning') }}>{t('requiresAckBadge')}</span>}
              {d.tags.map((tg) => (
                <span key={tg} style={tagChip}>
                  {tg}
                </span>
              ))}
            </span>
          ),
        },
      ],
      card: (doc) => (
        <Link href={`/knowledge/${doc.id}`} style={{ display: 'block', padding: 16, textDecoration: 'none', color: 'inherit' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 16 }}>{doc.title}</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ ...badge, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{t(DOC_TYPE_LABELS[doc.docType])}</span>
              <span style={{ ...badge, ...statusColorStyle(doc.status) }}>{t(`status_${doc.status}`)}</span>
            </span>
          </div>
          {doc.summary && <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 14 }}>{doc.summary}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {doc.requiresAck && <span style={{ ...badge, ...statusColorStyle('warning') }}>{t('requiresAckBadge')}</span>}
            {doc.versionNumber > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>v{doc.versionNumber}</span>}
            {doc.tags.map((tg) => (
              <span key={tg} style={tagChip}>
                {tg}
              </span>
            ))}
          </div>
        </Link>
      ),
    }),
    [t],
  );

  // The list endpoint returns every matching document (type/tag/project/q are server filters);
  // sort + page are applied here so Collection's header sort and pager work as is.
  const fetchPage = useCallback(
    async (q: PageQuery): Promise<Page<KnowledgeDoc>> => {
      try {
        setError(null);
        const docs = await knowledgeApi.list({ type: typeFilter || undefined, project: projectId, tag: tagFilter || undefined, q: q.q?.split('\u0000')[0] || undefined });
        const cmp = descriptor.columns.find((c) => (c.sortKey ?? c.key) === q.sort)?.compare;
        const sorted = cmp ? [...docs].sort((x, y) => (q.dir === 'asc' ? cmp(x, y) : cmp(y, x))) : docs;
        const start = (q.page - 1) * q.pageSize;
        return { items: sorted.slice(start, start + q.pageSize), total: sorted.length, page: q.page, pageSize: q.pageSize, sort: q.sort, dir: q.dir };
      } catch (e) {
        setError(errorMessage(e));
        throw e;
      }
    },
    [typeFilter, projectId, tagFilter, descriptor, errorMessage],
  );

  // Collection owns the sort/paging chrome; mirror its state to key the server source.
  const prefs = useCollectionPreferences(descriptor.surfaceKey, descriptor.defaultView ?? 'table');
  const paging = useCollectionPaging(prefs.pageSize);
  const sort = useCollectionSort(descriptor, paging.reset);
  const source = useServerSource(fetchPage, {
    page: paging.page,
    pageSize: paging.pageSize,
    sort: sort.key,
    dir: sort.dir,
    archived: 'exclude',
    // The fetcher reads type/tag/project from its closure, so they must also key the
    // request or a filter change on page 1 would not refetch.
    q: `${search}\u0000${typeFilter}\u0000${tagFilter}\u0000${projectId ?? ''}`,
  });

  return (
    <section data-tour="demo-knowledge">
      <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>{t('allKnowledge')}</h2>
      {error && <div style={{ color: 'var(--error-text, var(--error))' }}>{error}</div>}
      <Collection
        descriptor={descriptor}
        source={source}
        sort={sort}
        paging={paging}
        search={search}
        onSearchChange={(q) => {
          setSearch(q);
          paging.reset();
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.id || 'all'}
              type="button"
              onClick={() => {
                setTypeFilter(f.id);
                paging.reset();
              }}
              style={typeFilter === f.id ? chipActive : chip}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
        {allTags.length > 0 && (
          <Select
            value={tagFilter}
            onChange={(e) => {
              setTagFilter(e.target.value);
              paging.reset();
            }}
            style={inputStyle}
          >
            <option value="">{t('allTags')}</option>
            {allTags.map((tg) => (
              <option key={tg} value={tg}>
                {tg}
              </option>
            ))}
          </Select>
        )}
      </Collection>
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 18, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--surface)' }}>
      {children}
    </div>
  );
}

function MiniStat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: danger ? 'var(--error-text, var(--error))' : undefined }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}


'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { Collection } from '@/components/collection/Collection';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import { useLocalSource } from '@/components/collection/sources';
import { useCollectionSort } from '@/components/collection/useCollectionSort';
import { useCollectionPaging } from '@/components/collection/useCollectionPaging';
import { useCollectionPreferences } from '@/components/collection/collectionPreferences';
import type { PromptSummary } from '@/lib/builderforceApi';
import { useFormat } from '@/i18n/useFormat';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

export interface PromptsListProps {
  prompts: PromptSummary[];
  /** 'mine' = the workspace's own prompts (bulk entity 'prompt'); 'public' = read-only catalog. */
  tab: 'public' | 'mine';
  search: string;
  onSearchChange: (q: string) => void;
  onOpen: (p: PromptSummary) => void;
  /** Re-fetch the active tab (after a bulk mutation). */
  onReload: () => void;
  children?: React.ReactNode;
}

export function PromptsList({ prompts, tab, search, onSearchChange, onOpen, onReload, children }: PromptsListProps) {
  const t = useTranslations('promptsPage');
  const tCommon = useTranslations('common');
  const fmt = useFormat();

  const descriptor = useMemo<CollectionDescriptor<PromptSummary>>(
    () => ({
      entity: tab === 'mine' ? 'prompt' : null,
      surfaceKey: tab === 'mine' ? 'prompts.mine' : 'prompts.public',
      rowId: (p) => p.id,
      label: (p) => p.title,
      defaultView: 'card',
      defaultSort: tab === 'mine' ? { key: 'title', dir: 'asc' } : { key: 'uses', dir: 'desc' },
      emptyKey: tab === 'mine' ? 'emptyPromptsMine' : 'emptyPromptsPublic',
      card: (p) => (
        <button
          type="button"
          onClick={() => onOpen(p)}
          style={{ ...cardStyle, textAlign: 'left', cursor: 'pointer', width: '100%' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 'var(--font-size-body)' }}>{p.title}</span>
            {p.isFeatured && <span title={t('featured')}><Icon source="⭐" size="1em" /></span>}
          </div>
          {p.description && (
            <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '0 0 10px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {p.description}
            </p>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {p.category && <span className="badge badge-gray">{p.category}</span>}
            {p.tags.slice(0, 3).map((tag) => <span key={tag} className="badge badge-gray">#{tag}</span>)}
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
            <span><Icon source="▶" size="1em" /> {t('usesCount', { n: p.usageCount })}</span>
            <span><Icon source="★" size="1em" /> {p.starCount}</span>
            {p.authorName && <span>{t('byAuthor', { name: p.authorName })}</span>}
          </div>
        </button>
      ),
      columns: [
        {
          key: 'title',
          header: t('colTitle'),
          sortKey: 'title',
          compare: (a, b) => a.title.localeCompare(b.title),
          cell: (p) => (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
              {p.title}
              {p.isFeatured && <span title={t('featured')}><Icon source="⭐" size="1em" /></span>}
            </span>
          ),
        },
        {
          key: 'category',
          header: t('colCategory'),
          sortKey: 'category',
          compare: (a, b) => (a.category ?? '').localeCompare(b.category ?? ''),
          cell: (p) => p.category ?? '—',
        },
        {
          key: 'uses',
          header: t('colUses'),
          sortKey: 'uses',
          compare: (a, b) => a.usageCount - b.usageCount,
          cell: (p) => fmt.number(p.usageCount),
        },
        {
          key: 'stars',
          header: t('colStars'),
          sortKey: 'stars',
          compare: (a, b) => a.starCount - b.starCount,
          cell: (p) => p.starCount,
        },
        { key: 'author', header: t('colAuthor'), cell: (p) => p.authorName ?? '—' },
        {
          key: 'actions',
          header: t('colActions'),
          cell: (p) => (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpen(p)}>{tCommon('view')}</button>
          ),
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, t, tCommon, fmt, onOpen],
  );

  const prefs = useCollectionPreferences(descriptor.surfaceKey, descriptor.defaultView ?? 'table');
  const paging = useCollectionPaging(prefs.pageSize);
  const sort = useCollectionSort(descriptor, paging.reset);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        (p.category ?? '').toLowerCase().includes(q) ||
        p.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [prompts, search]);

  const source = useLocalSource(
    filtered,
    descriptor,
    { key: sort.key, dir: sort.dir },
    { page: paging.page, pageSize: paging.pageSize },
  );
  // Bulk mutations on the owned tab refetch the real list through the page.
  const withReload = useMemo(() => ({ ...source, refetch: onReload }), [source, onReload]);

  return (
    <Collection
      descriptor={descriptor}
      source={withReload}
      search={search}
      onSearchChange={onSearchChange}
    >
      {children}
    </Collection>
  );
}

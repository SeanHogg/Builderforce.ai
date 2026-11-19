'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { contrastText } from '@/lib/contrastText';
import ArtifactAssigner from '@/components/ArtifactAssigner';
import { Collection } from '@/components/collection/Collection';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import { useLocalSource } from '@/components/collection/sources';
import { useCollectionSort } from '@/components/collection/useCollectionSort';
import { useCollectionPaging } from '@/components/collection/useCollectionPaging';
import { useCollectionPreferences } from '@/components/collection/collectionPreferences';
import type { ArtifactStats } from '@/lib/builderforceApi';
import type { Persona, UserPersona } from '@/lib/marketplaceData';

/** Shared local-source wiring: `Collection` owns its sort/paging chrome, so the
 *  page mirrors the same state to slice the rows (same pattern as LocalCollection). */
function useLocalList<Row>(descriptor: CollectionDescriptor<Row>, rows: Row[]) {
  const prefs = useCollectionPreferences(descriptor.surfaceKey, descriptor.defaultView ?? 'table');
  const paging = useCollectionPaging(prefs.pageSize);
  const sort = useCollectionSort(descriptor, paging.reset);
  const source = useLocalSource(rows, descriptor, { key: sort.key, dir: sort.dir }, {
    page: paging.page,
    pageSize: paging.pageSize,
  });
  return { source, paging, sort };
}

const imageStyle = (image: string): React.CSSProperties => ({
  width: '100%',
  height: 100,
  background: `url('${image}') center/cover`,
  borderBottom: '1px solid var(--border)',
});

const nameCell: React.CSSProperties = { fontWeight: 600, whiteSpace: 'nowrap' };

// ── My Personas (owned → bulk entity 'persona') ─────────────────────────────

export interface MyPersonasListProps {
  personas: UserPersona[];
  search: string;
  onSearchChange: (q: string) => void;
  publishingId: string | null;
  onPublish: (p: UserPersona) => void;
  onDelete: (id: string) => void;
  /** Re-fetch the owned list (after a bulk mutation). */
  onReload: () => void;
}

export function MyPersonasList({ personas, search, onSearchChange, publishingId, onPublish, onDelete, onReload }: MyPersonasListProps) {
  const t = useTranslations('personasPage');
  const tc = useTranslations('common');

  const descriptor = useMemo<CollectionDescriptor<UserPersona>>(() => {
    const actions = (p: UserPersona, publishLabel: string) => (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={publishingId === p.id} onClick={() => onPublish(p)}>
          {publishingId === p.id ? t('publishing') : p.shared ? t('rePublish') : publishLabel}
        </button>
        <button type="button" className="btn btn-danger btn-sm" onClick={() => onDelete(p.id)}>{tc('delete')}</button>
        <ArtifactAssigner artifactType="persona" artifactSlug={p.slug} artifactName={p.name} />
      </div>
    );
    return {
      entity: 'persona',
      surfaceKey: 'personas.mine',
      rowId: (p) => p.id,
      label: (p) => p.name,
      defaultView: 'card',
      defaultSort: { key: 'name', dir: 'asc' },
      emptyKey: 'emptyPersonasMine',
      card: (p) => (
        <div style={{ overflow: 'hidden' }}>
          {p.image && <div style={imageStyle(p.image)} />}
          <div style={{ padding: p.image ? 12 : 0 }}>
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}><Icon source="🎭" size="1em" /></span>
                <div>
                  <div className="card-title">{p.name}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {p.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="badge badge-gray">{tag}</span>
                    ))}
                    {p.shared && <span className="badge badge-green">{t('shared')}</span>}
                  </div>
                </div>
              </div>
            </div>
            {p.description && <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '8px 0' }}>{p.description}</div>}
            <div style={{ marginTop: 8 }}>{actions(p, t('publishToRegistry'))}</div>
          </div>
        </div>
      ),
      columns: [
        {
          key: 'name',
          header: t('colName'),
          sortKey: 'name',
          compare: (a, b) => a.name.localeCompare(b.name),
          cell: (p) => (
            <span style={nameCell}>
              <span style={{ marginRight: 6 }}><Icon source="🎭" size="1em" /></span>{p.name}
              {p.shared && <span className="badge badge-green" style={{ marginLeft: 6 }}>{t('shared')}</span>}
            </span>
          ),
        },
        { key: 'description', header: t('colDescription'), cell: (p) => p.description || '—' },
        {
          key: 'tags',
          header: t('colTags'),
          cell: (p) => (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {p.tags.length ? p.tags.map((tag) => <span key={tag} className="badge badge-gray">{tag}</span>) : '—'}
            </div>
          ),
        },
        { key: 'actions', header: t('colActions'), cell: (p) => actions(p, t('publishShort')) },
      ],
    };
  }, [t, tc, publishingId, onPublish, onDelete]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return personas;
    return personas.filter(
      (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [personas, search]);

  const { source, paging, sort } = useLocalList(descriptor, filtered);
  const withReload = useMemo(() => ({ ...source, refetch: onReload }), [source, onReload]);

  return (
    <Collection descriptor={descriptor} source={withReload} sort={sort} paging={paging} search={search} onSearchChange={onSearchChange} />
  );
}

// ── Marketplace (read-only catalog → entity null) ───────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  builtin: 'var(--accent)',
  agenthub: 'var(--success-text)',
  'project-local': 'var(--warning-text)',
  'user-global': 'var(--cyan-bright)',
  'agentlink-assigned': 'var(--pink-bright)',
};

export interface MarketplaceListProps {
  personas: Persona[];
  search: string;
  onSearchChange: (q: string) => void;
  stats: Record<string, ArtifactStats>;
  installedSlugs: Set<string>;
  expanded: string | null;
  onExpand: (name: string | null) => void;
  onInstall: (slug: string) => void;
  onUninstall: (slug: string) => void;
  onToggleLike: (slug: string) => void;
}

const ZERO_STAT: ArtifactStats = { likes: 0, installs: 0, liked: false };

export function MarketplaceList({
  personas, search, onSearchChange, stats, installedSlugs, expanded, onExpand, onInstall, onUninstall, onToggleLike,
}: MarketplaceListProps) {
  const t = useTranslations('personasPage');
  const tc = useTranslations('common');

  const descriptor = useMemo<CollectionDescriptor<Persona>>(() => {
    const statOf = (p: Persona) => stats[p.name] ?? ZERO_STAT;

    const sourceBadge = (source: Persona['source']) => {
      const labels: Record<string, string> = {
        builtin: t('sourceBuiltin'),
        agenthub: t('sourceAgenthub'),
        'project-local': t('sourceProject'),
        'user-global': t('sourceUser'),
        'agentlink-assigned': t('sourceAssigned'),
      };
      const color = SOURCE_COLORS[source] ?? 'var(--muted)';
      return (
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: color, color: contrastText(color), textTransform: 'uppercase' }}>
          {labels[source] ?? source}
        </span>
      );
    };

    const likeButton = (p: Persona, stopPropagation: boolean) => {
      const stat = statOf(p);
      return (
        <button
          type="button"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: stat.liked ? 'var(--error)' : 'var(--muted)' }}
          title={stat.liked ? t('unlike') : t('like')}
          onClick={(e) => { if (stopPropagation) e.stopPropagation(); onToggleLike(p.name); }}
        >
          {stat.liked ? <Icon source="❤️" size="1em" /> : <Icon source="🤍" size="1em" />} {stat.likes}
        </button>
      );
    };

    const actions = (p: Persona) => (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        {installedSlugs.has(p.name) ? (
          <>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => onUninstall(p.name)}>{t('uninstall')}</button>
            <ArtifactAssigner artifactType="persona" artifactSlug={p.name} artifactName={p.name} />
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onInstall(p.name)}>{t('install')}</button>
            <ArtifactAssigner artifactType="persona" artifactSlug={p.name} artifactName={p.name} />
            <Link href={`/personas/${encodeURIComponent(p.name)}`} className="btn btn-secondary btn-sm">{tc('view')}</Link>
          </>
        )}
      </div>
    );

    const detailBox: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 8 };
    const detailLabel: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 3 };

    return {
      entity: null,
      surfaceKey: 'personas.marketplace',
      rowId: (p) => p.name,
      label: (p) => p.name,
      defaultView: 'card',
      defaultSort: { key: 'name', dir: 'asc' },
      emptyKey: 'emptyPersonasMarketplace',
      card: (p) => {
        const stat = statOf(p);
        const isOpen = expanded === p.name;
        return (
          <div style={{ overflow: 'hidden', outline: isOpen ? '1px solid var(--accent)' : undefined }}>
            {p.image && <div style={imageStyle(p.image)} />}
            <div style={{ padding: p.image ? 12 : 0, cursor: 'pointer' }} onClick={() => onExpand(isOpen ? null : p.name)}>
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}><Icon source="🎭" size="1em" /></span>
                  <div>
                    <div className="card-title">{p.name}</div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                      {sourceBadge(p.source)}
                      {(p.tags ?? []).slice(0, 2).map((tag) => <span key={tag} className="badge badge-gray">{tag}</span>)}
                    </div>
                  </div>
                </div>
              </div>
              {p.description && <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '8px 0' }}>{p.description}</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--muted)', margin: '4px 0 8px' }}>
                {likeButton(p, true)}
                <span title={t('installsTitle')}><Icon source="⬇️" size="1em" /> {stat.installs}</span>
                {p.author && <span>{t('byAuthor', { author: p.author })}</span>}
              </div>
              {isOpen && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12, display: 'grid', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                    <div style={detailBox}><div style={detailLabel}>{t('voiceLabel')}</div><div style={{ fontSize: 12, color: 'var(--text)' }}>{p.voice}</div></div>
                    <div style={detailBox}><div style={detailLabel}>{t('perspectiveLabel')}</div><div style={{ fontSize: 12, color: 'var(--text)' }}>{p.perspective}</div></div>
                    <div style={detailBox}><div style={detailLabel}>{t('decisionStyleLabel')}</div><div style={{ fontSize: 12, color: 'var(--text)' }}>{p.decisionStyle}</div></div>
                  </div>
                  <div>
                    <div style={{ ...detailLabel, marginBottom: 4 }}>{t('capabilitiesLabel')}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{p.capabilities.map((c) => <span key={c} className="badge badge-gray">{c}</span>)}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('outputPrefixLabel')} <code style={{ background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', fontSize: 11 }}>{p.outputPrefix}</code></div>
                </div>
              )}
            </div>
            <div style={{ padding: '0 0 4px' }}>{actions(p)}</div>
          </div>
        );
      },
      columns: [
        {
          key: 'name',
          header: t('colName'),
          sortKey: 'name',
          compare: (a, b) => a.name.localeCompare(b.name),
          cell: (p) => (
            <span style={nameCell}><span style={{ marginRight: 6 }}><Icon source="🎭" size="1em" /></span>{p.name}</span>
          ),
        },
        { key: 'description', header: t('colDescription'), cell: (p) => p.description || '—' },
        {
          key: 'source',
          header: t('colSourceTags'),
          sortKey: 'source',
          compare: (a, b) => a.source.localeCompare(b.source),
          cell: (p) => (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              {sourceBadge(p.source)}
              {(p.tags ?? []).slice(0, 2).map((tag) => <span key={tag} className="badge badge-gray">{tag}</span>)}
            </div>
          ),
        },
        {
          key: 'stats',
          header: t('colStats'),
          sortKey: 'stats',
          compare: (a, b) => statOf(a).installs - statOf(b).installs,
          cell: (p) => (
            <span style={{ whiteSpace: 'nowrap' }}>
              {likeButton(p, false)}
              <span style={{ marginLeft: 10, fontSize: 11 }}><Icon source="⬇️" size="1em" /> {statOf(p).installs}</span>
            </span>
          ),
        },
        { key: 'actions', header: t('colActions'), cell: (p) => actions(p) },
      ],
    };
  }, [t, tc, stats, installedSlugs, expanded, onExpand, onInstall, onUninstall, onToggleLike]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return personas;
    return personas.filter(
      (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || (p.tags ?? []).some((tag) => tag.includes(q)),
    );
  }, [personas, search]);

  const { source, paging, sort } = useLocalList(descriptor, filtered);

  return (
    <Collection descriptor={descriptor} source={source} sort={sort} paging={paging} search={search} onSearchChange={onSearchChange} />
  );
}

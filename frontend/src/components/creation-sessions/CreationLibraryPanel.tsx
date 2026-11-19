'use client';

import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Collection } from '@/components/collection/Collection';
import { useLocalSource } from '@/components/collection/sources';
import { useCollectionPreferences } from '@/components/collection/collectionPreferences';
import { useCollectionPaging } from '@/components/collection/useCollectionPaging';
import { useCollectionSort } from '@/components/collection/useCollectionSort';
import { useFormat } from '@/i18n/useFormat';
import type { CreationLibraryItem } from '@/domains/canvas/domain/creationLibrary';
import { CreationFolderBar, UNFILED } from './CreationFolderBar';
import { CreationLibraryFacetBar } from './CreationLibraryFacetBar';
import { CreationSessionTile } from './CreationSessionTile';
import { SessionActionBar, type SessionMenuAction } from './SessionActionBar';
import { creationLibraryDescriptor } from './creationLibraryDescriptor';
import { useCreateCanvas } from './useCreateCanvas';
import { useCreationLibrary } from './useCreationLibrary';
import { useCreationLibraryActions } from './useCreationLibraryActions';
import styles from './CreationLibrary.module.css';

/**
 * THE CREATION LIBRARY — everything this workspace has made, in one list.
 *
 * Canvas sessions and the records that open as sessions (builds, workflows, Brain
 * conversations, projects, agents) are ONE list ordered by recency; the KIND is a
 * facet (`CreationLibraryFacetBar`) and the folder a filter (`CreationFolderBar`).
 * The mapping that produces the list — including the rule that a session already
 * holding a card for a record suppresses that record's own row — is pure and tested
 * in `domains/canvas/domain/creationLibrary.ts`.
 *
 * ── RENDERING ────────────────────────────────────────────────────────────────────
 * The list renders through the ONE shared `Collection` (PRD 47): header, Card | List
 * toggle, sort, paging, selection and the bulk bar (delete / archive / restore /
 * merge, one `creation-session` bulk request) all come from it. This component
 * supplies the descriptor, a local source over what the library hook has loaded, the
 * folder and facet bars as header children, and the per-tile `SessionActionBar`.
 *
 * Records that have never been opened have no session, so their row id is their list
 * key; the bulk endpoint reports such an id as `not_found` (skipped) rather than
 * acting on it, and the tile offers no per-row management for them.
 *
 * The library hook loads sessions incrementally (offset pages), so a "Load more"
 * control stays beneath the Collection and appends the next page into the source.
 */
export function CreationLibraryPanel() {
  const t = useTranslations('creationCanvas');
  const fmt = useFormat();
  const searchParams = useSearchParams();

  const library = useCreationLibrary();
  const create = useCreateCanvas();
  // Collection's bulk bar clears its own selection and refetches the source; the
  // library reload below is what makes that refetch real.
  const actions = useCreationLibraryActions({
    status: library.status,
    reload: library.reload,
    reloadFolders: library.reloadFolders,
    clearSelection: () => undefined,
  });

  // `?filter=<kind>` is how the canvas links back into the library at one object
  // kind. It narrows by the kinds ON a board, which is a different question from the
  // facet bar's ("what KIND of thing is this?"), so the two compose rather than
  // fight — the facet bar filters what this leaves.
  const kindFilter = searchParams.get('filter');
  const rows = useMemo(
    () => (kindFilter ? library.visible.filter((item) => item.kinds.includes(kindFilter)) : library.visible),
    [library.visible, kindFilter],
  );

  const projectLabel = useCallback(
    (id: number) => library.projects.find((project) => project.id === id)?.name ?? t('projectBadge', { id }),
    [library.projects, t],
  );

  const descriptor = useMemo(() => creationLibraryDescriptor({
    headers: { title: t('libraryColTitle'), kind: t('libraryColKind'), folder: t('libraryColFolder'), updated: t('libraryColUpdated') },
    facetLabel: (item: CreationLibraryItem) => t(`facet.${item.facet}` as never),
    formatDate: (iso: string) => fmt.date(iso),
    onOpen: (item: CreationLibraryItem) => { void actions.open(item); },
    renderCard: (item: CreationLibraryItem) => (
      <CreationSessionTile
        item={item}
        view="card"
        projectLabel={projectLabel}
        onOpen={() => void actions.open(item)}
        onFolderSelect={library.toggleFolderFilter}
        folderActive={library.folderFilter === (item.folderId ?? UNFILED)}
      >
        {/* Session-scoped management needs a session. A record that has never
            been opened has none, so the bar is absent rather than rendered with
            every action disabled — `item.managed` is the one question, asked once. */}
        {item.managed && item.sessionId && (
          <SessionActionBar
            session={{ id: item.sessionId, title: item.title, folder: item.folderName }}
            folders={library.folderOptions}
            projects={library.projects}
            linkedProjectIds={[...item.projectIds]}
            onLinkProject={(projectId) => actions.linkProject(item.sessionId!, projectId)}
            onUnlinkProject={(projectId) => actions.unlinkProject(item.sessionId!, projectId)}
            mergeCandidates={library.status === 'active'
              ? library.sessions.filter((candidate) => candidate.id !== item.sessionId && candidate.status === 'active')
                .map((candidate) => ({ id: candidate.id, title: candidate.title, folder: candidate.folderName }))
              : []}
            onRename={(title) => actions.rename(item.sessionId!, title)}
            onMove={(folder) => actions.move(item.sessionId!, folder)}
            onMerge={library.status === 'active' ? (sourceId) => actions.merge(item.sessionId!, [sourceId]) : undefined}
            onDelete={() => actions.remove([item.sessionId!])}
            extraActions={([
              { id: 'pin', label: item.pinned ? t('unpinSession') : t('pinSession'), icon: 'pin', run: () => actions.pin(item) },
              { id: 'duplicate', label: t('duplicateSession'), icon: 'copy', run: () => actions.duplicate(item.sessionId!) },
              { id: 'share', label: t('shareSession'), icon: 'link', run: () => actions.share(item.sessionId!) },
              { id: library.status === 'archived' ? 'restore' : 'archive', label: library.status === 'archived' ? t('restoreSession') : t('archiveSession'), icon: 'archive', run: () => actions.archive([item.sessionId!]) },
            ] satisfies SessionMenuAction[])}
          />
        )}
      </CreationSessionTile>
    ),
  }), [t, fmt, actions, projectLabel, library.toggleFolderFilter, library.folderFilter, library.folderOptions, library.projects, library.sessions, library.status]);

  // Sorting and paging are the Collection's; a local source applies them over the
  // rows the hook has loaded. The Collection owns the sort/paging state, so the
  // source is built by a thin adapter component that reads it back.
  return (
    <section className={styles.sessionsRoot}>
      <div className={styles.libraryHeader}>
        <div className={styles.libraryIntro}><h2>{t('dashboardTitle')}</h2><p>{t('dashboardSubtitle')}</p></div>
        <div className={styles.libraryControls}>
          <button
            onClick={() => void create.createBlank()}
            disabled={create.creating || create.limitReached}
            title={create.limitReached ? t('sessionLimitHint') : undefined}
            className="btn btn-primary"
          >
            {create.creating ? t('creatingSession') : create.limitReached ? t('sessionLimitShort') : `+ ${t('newSession')}`}
          </button>
        </div>
      </div>
      {create.limitReached && <p role="alert" className={styles.quotaNotice}>{t('sessionLimitPlan', { limit: create.limit ?? 0 })}</p>}

      <LibraryCollection
        descriptor={descriptor}
        rows={rows}
        loading={library.loading}
        archived={library.status === 'archived' ? 'only' : 'exclude'}
        onArchivedChange={(next) => library.setStatus(next === 'only' ? 'archived' : 'active')}
        search={library.query}
        onSearchChange={library.setQuery}
        reload={library.reload}
        fetchAllIds={() => Promise.resolve(rows.filter((item) => item.sessionId).map((item) => item.sessionId!))}
      >
        <CreationFolderBar
          folders={library.folders}
          projects={library.projects}
          totalCount={library.sessions.length}
          unfiledCount={library.sessions.filter((session) => !session.folderId).length}
          selected={library.folderFilter}
          onSelect={library.setFolderFilter}
          onChanged={() => { library.reloadFolders(); library.reload(); }}
        />
        {/* Counts against everything the narrowing left, not against what the facet
            filter has already hidden — a chip has to say what pressing it would reveal. */}
        <CreationLibraryFacetBar
          items={library.items}
          selected={library.facet}
          onSelect={library.setFacet}
        />
      </LibraryCollection>

      {!library.loading && library.hasMore && (
        <div className={styles.loadMore}>
          <button onClick={library.loadMore} disabled={library.loadingMore} className="btn btn-secondary">
            {library.loadingMore ? t('loadingMore') : t('loadMoreSessions')}
          </button>
        </div>
      )}
    </section>
  );
}

interface LibraryCollectionProps {
  descriptor: ReturnType<typeof creationLibraryDescriptor>;
  rows: CreationLibraryItem[];
  loading: boolean;
  archived: 'exclude' | 'only';
  onArchivedChange: (next: 'exclude' | 'only' | 'all') => void;
  search: string;
  onSearchChange: (q: string) => void;
  reload: () => void;
  fetchAllIds: () => Promise<string[]>;
  children: React.ReactNode;
}

/**
 * Binds the local source to the Collection's own sort + paging state.
 *
 * `Collection` owns sort and paging internally but a local source needs them as
 * inputs, so this mirrors them with the same hooks over the same preference key.
 * The source's `refetch` is the library reload, which is what a bulk mutation calls.
 */
function LibraryCollection({ descriptor, rows, loading, reload, ...rest }: LibraryCollectionProps) {
  const prefs = useCollectionPreferences(descriptor.surfaceKey, descriptor.defaultView ?? 'table');
  const paging = useCollectionPaging(prefs.pageSize);
  const sort = useCollectionSort(descriptor, paging.reset);
  const local = useLocalSource(rows, descriptor, { key: sort.key, dir: sort.dir }, {
    page: paging.page,
    pageSize: paging.pageSize,
  });
  const source = useMemo(
    () => ({ ...local, loading, refetch: reload }),
    [local, loading, reload],
  );
  return <Collection descriptor={descriptor} source={source} {...rest} />;
}

'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { ViewToggle } from '@/components/ViewToggle';
import { readCreationLibraryView, serverCreationLibraryView, subscribeCreationLibraryView, writeCreationLibraryView, type CreationLibraryView } from './libraryViewPreference';
import { CreationFolderBar, UNFILED } from './CreationFolderBar';
import { CreationLibraryFacetBar } from './CreationLibraryFacetBar';
import { CreationSessionTile } from './CreationSessionTile';
import { SessionActionBar, type SessionMenuAction } from './SessionActionBar';
import { SessionBulkBar } from './SessionBulkBar';
import { useCreateCanvas } from './useCreateCanvas';
import { useCreationLibrary } from './useCreationLibrary';
import { useCreationLibraryActions } from './useCreationLibraryActions';
import styles from './CreationLibrary.module.css';

/**
 * THE CREATION LIBRARY — everything this workspace has made, in one list.
 *
 * ── WHAT THIS FIXES ──────────────────────────────────────────────────────────────
 * There used to be two lists here, and then a third. Canvas sessions were tiles,
 * grouped under folder headings. Underneath them, builds, workflows, Brain
 * conversations, projects and agents were drawn as a flatter row shape with a chevron,
 * in a fixed order by source: every build, then every workflow, then every chat.
 *
 * Nothing about that division was real. Clicking any of those rows calls that record's
 * `…/open` endpoint, which MATERIALISES a creation session and lands on the same
 * `/create/<id>` board a tile opens. The only difference was whether the session row
 * existed yet — an implementation detail, given its own visual class.
 *
 * The cost was ordering. Sections come before recency, so a build touched an hour ago
 * sat below a canvas nobody had opened since March, and there was no arrangement of
 * the page that could say otherwise. One list ordered by recency can.
 *
 * So the KIND became a facet (`CreationLibraryFacetBar`) over one list, beside the
 * folder facet that was already there, and the mapping that produces that list —
 * including the rule that a session already holding a card for a record suppresses
 * that record's own row — is pure and tested in
 * `domains/canvas/domain/creationLibrary.ts`.
 *
 * ── WHY THE FOLDER HEADINGS WENT WITH THEM ───────────────────────────────────────
 * They were the same mistake in the other axis: a heading per folder re-sectioned the
 * list and re-imposed the ordering problem, and the folder bar above already filters
 * by folder in one press. Each tile still carries its folder as a chip, so the fact is
 * not lost — only the sectioning is.
 *
 * ── WHAT THIS COMPONENT DOES ─────────────────────────────────────────────────────
 * Renders. The reads are `useCreationLibrary`, the writes are
 * `useCreationLibraryActions`, and starting something new is `useCreateCanvas` —
 * shared with the starter panel, which used to fetch the same quota separately.
 */
export function CreationLibraryPanel() {
  const t = useTranslations('creationCanvas');
  const searchParams = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // The remembered layout, read through its own store: this component
  // server-renders, so the preference cannot be a lazy initializer, and an effect
  // that set it would be a cascading render plus a flash of the wrong layout.
  const libraryView = useSyncExternalStore(subscribeCreationLibraryView, readCreationLibraryView, serverCreationLibraryView);

  const library = useCreationLibrary();
  const create = useCreateCanvas();
  const actions = useCreationLibraryActions({
    status: library.status,
    reload: library.reload,
    reloadFolders: library.reloadFolders,
    clearSelection: () => setSelectedIds([]),
  });

  // `?filter=<kind>` is how the canvas links back into the library at one object
  // kind. It narrows by the kinds ON a board, which is a different question from the
  // facet bar's ("what KIND of thing is this?"), so the two compose rather than
  // fight — the facet bar filters what this leaves.
  const kindFilter = searchParams.get('filter');
  const visible = useMemo(
    () => kindFilter ? library.visible.filter((item) => item.kinds.includes(kindFilter)) : library.visible,
    [library.visible, kindFilter],
  );

  const selected = useMemo(
    () => visible.filter((item) => item.sessionId && selectedIds.includes(item.sessionId))
      .map((item) => ({ id: item.sessionId!, title: item.title, folder: item.folderName })),
    [visible, selectedIds],
  );

  const toggleSelected = (sessionId: string, checked: boolean) => setSelectedIds((current) =>
    checked ? [...new Set([...current, sessionId])] : current.filter((id) => id !== sessionId));

  return <section className={styles.sessionsRoot}>
    <div className={styles.libraryHeader}>
      <div className={styles.libraryIntro}><h2>{t('dashboardTitle')}</h2><p>{t('dashboardSubtitle')}</p></div>
      <div className={styles.libraryControls}>
        {/* The canonical control (`components/ViewToggle`), not a fourth inline copy
            of the same button pair — it owns the glyphs, the order and the pressed
            state, so this library reads exactly like Projects and Tasks. */}
        <ViewToggle<CreationLibraryView> value={libraryView} onChange={writeCreationLibraryView} />
        <select
          aria-label={t('creationStatusLabel')}
          value={library.status}
          onChange={(event) => library.setStatus(event.target.value as 'active' | 'archived')}
          className={styles.librarySelect}
        >
          <option value="active">{t('active')}</option>
          <option value="archived">{t('archived')}</option>
        </select>
        <input
          aria-label={t('searchCreationsLabel')}
          value={library.query}
          onChange={(event) => library.setQuery(event.target.value)}
          placeholder={t('searchSessions')}
          className={styles.librarySearch}
        />
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
    <SessionBulkBar
      selected={selected}
      archived={library.status === 'archived'}
      onMerge={actions.merge}
      onArchive={actions.archive}
      onDelete={actions.remove}
      onClear={() => setSelectedIds([])}
    />

    {library.loading ? <div className={styles.libraryState}>{t('loadingCreations')}</div> : visible.length === 0 ? (
      <button onClick={() => void create.createBlank()} className={styles.emptyLibrary}>
        <strong>{t('blankCanvas')}</strong>{t('blankCanvasHint')}
      </button>
    ) : (
      <div aria-label={t('libraryLabel')} data-view={libraryView} className={styles.libraryGrid}>
        {visible.map((item) => (
          <CreationSessionTile
            key={item.key}
            item={item}
            view={libraryView}
            selected={!!item.sessionId && selectedIds.includes(item.sessionId)}
            onSelectedChange={(checked) => item.sessionId && toggleSelected(item.sessionId, checked)}
            projectLabel={(id) => library.projects.find((project) => project.id === id)?.name ?? t('projectBadge', { id })}
            onOpen={() => void actions.open(item)}
            onFolderSelect={library.toggleFolderFilter}
            folderActive={library.folderFilter === (item.folderId ?? UNFILED)}
          >
            {/* Session-scoped management needs a session. A record that has never
                been opened has none, so the bar is absent rather than rendered
                with every action disabled — `item.managed` is the one question,
                asked once. */}
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
        ))}
      </div>
    )}

    {!library.loading && library.hasMore && (
      <div className={styles.loadMore}>
        <button onClick={library.loadMore} disabled={library.loadingMore} className="btn btn-secondary">
          {library.loadingMore ? t('loadingMore') : t('loadMoreSessions')}
        </button>
      </div>
    )}
  </section>;
}

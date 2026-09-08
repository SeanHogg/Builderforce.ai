'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui';
import { useFormat } from '@/i18n/useFormat';
import type { CreationLibraryItem } from '@/domains/canvas/domain/creationLibrary';
import styles from './CreationSessionTile.module.css';

/**
 * ONE tile for everything in the Create library.
 *
 * It used to take a `CreationSessionSummary`, which is why the builds, workflows,
 * chats, projects and agents underneath it were drawn by a second, flatter row shape
 * inlined in the dashboard panel — they had no session row, so they could not be this
 * component, so they became a lesser class of thing on screen. They are not: opening
 * one materialises a session and lands on the same `/create/<id>` board. So the tile
 * now takes a {@link CreationLibraryItem}, the shape both cases map onto, and the only
 * difference that survives is whether there is a board to PREVIEW yet.
 *
 * Colours come from the canvas tokens, not a copy of them: the board's minimap paints
 * the same objects the same way, so this is the board's identity list read back. The
 * copy that used to live here had already drifted (`website` was the brand blue here
 * and its own hue there), which is what a duplicated palette does.
 */
const KIND_COLOR: Record<string, string> = {
  workflow: 'var(--canvas-obj-workflow)', website: 'var(--canvas-obj-website)',
  chat: 'var(--canvas-obj-chat)', dashboard: 'var(--canvas-obj-dashboard)',
  project: 'var(--canvas-obj-staff)', agent: 'var(--canvas-obj-agent)',
  dataset: 'var(--canvas-obj-dataset)', mockup: 'var(--canvas-obj-mockup)',
};

const RUNNING_KINDS = ['agent', 'task', 'workflow'];
const RUNNING_STATUSES = ['running', 'in progress', 'in_progress', 'queued', 'assigned'];

interface Props {
  item: CreationLibraryItem;
  /** `card` is the gallery, `table` the row list — the same facts, one layout token. */
  view: 'card' | 'table';
  selected: boolean;
  /** Selection is session-scoped (the bulk bar archives, merges and deletes sessions),
   *  so the checkbox stands itself down for an item that has none. */
  onSelectedChange: (selected: boolean) => void;
  /** Reads a linked project's name; the tile never fetches one itself. */
  projectLabel: (projectId: number) => string;
  onOpen: () => void;
  /** Clicking the folder chip filters the library to that folder, and clears it
   *  again. The folder's ID, not its name — a rename must not drop the filter. */
  onFolderSelect: (folderId: string) => void;
  folderActive: boolean;
  /** The item's own actions, rendered at the foot of the tile. */
  children?: ReactNode;
}

export function CreationSessionTile({ item, view, selected, onSelectedChange, projectLabel, onOpen, onFolderSelect, folderActive, children }: Props) {
  const t = useTranslations('creationCanvas');
  const fmt = useFormat();
  const running = item.objects.filter((object) => RUNNING_KINDS.includes(object.kind) && RUNNING_STATUSES.includes(String(object.status || '').toLowerCase())).length;

  return (
    <article
      className={styles.tile}
      data-view={view}
      data-facet={item.facet}
      data-unread={item.unread ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter') onOpen(); }}
      tabIndex={0}
    >
      <div className={styles.preview}>
        {item.objects.slice(0, 8).map((object, index) => (
          <span key={object.id} title={object.title} className={styles.previewObject} style={{
            left: `${12 + ((Math.abs(object.x) + index * 31) % 68)}%`,
            top: `${14 + ((Math.abs(object.y) + index * 23) % 58)}%`,
            borderColor: KIND_COLOR[object.kind] ?? 'var(--canvas-obj-unknown)',
          }} />
        ))}
        {/* A record whose board does not exist yet has nothing to scatter. Its own
            mark says more about it than an empty rectangle does, so the glyph takes
            the preview's place rather than sitting beside an emptiness caption. */}
        {item.objects.length === 0 && (item.icon
          ? <span className={styles.previewIcon} aria-hidden><Icon source={item.icon} size={30} /></span>
          : <span className={styles.previewEmpty}>{t('blankCanvasEmpty')}</span>)}
        {item.managed && (
          <input
            type="checkbox"
            className={styles.select}
            checked={selected}
            aria-label={t('selectSession', { title: item.title })}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onSelectedChange(event.target.checked)}
          />
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.details}>
        <strong className={styles.title}>{item.pinned && <Icon name="pin" size={14} />} {item.title}{item.unread ? ` · ${t('unreadBadge')}` : ''}</strong>
        <div className={styles.badges}>
          {item.kinds.slice(0, 5).map((kind) => <small key={kind} className={styles.kind}>{kind}</small>)}
          {item.projectIds.map((id) => <small key={id} className={styles.project}>{projectLabel(id)}</small>)}
        </div>
        {/* The date sits with the rest of the facts about this item rather than
            pinned to the far edge of the row, where it read as a column of a table
            nobody had asked for and left the meta line half empty.

            A record reports its own line instead of the object/people counts, which
            would all read "0 objects · 1 person" for something whose board has not
            been opened — true, and useless. */}
        <div className={styles.meta}>
          {item.subtitle
            ? <span>{item.subtitle}</span>
            : <span>{t('sessionObjectsPeople', { objects: item.objectCount, people: item.collaboratorCount })}</span>}
          {running > 0 && <span>{t('sessionRunning', { count: running })}</span>}
          {item.lastActivityAt && <span>{fmt.date(item.lastActivityAt)}</span>}
        </div>
        {item.folderName && item.folderId && (
          <button
            type="button"
            className={styles.folder}
            aria-pressed={folderActive}
            onClick={(event) => { event.stopPropagation(); onFolderSelect(item.folderId!); }}
          >
            <Icon name="folder" size={13} /> {item.folderName}
          </button>
        )}
        </div>
        {/* A row puts its actions at the right end; a card puts them along the
            foot. Same markup, one layout token. */}
        <div className={styles.actions}>{children}</div>
      </div>
    </article>
  );
}
